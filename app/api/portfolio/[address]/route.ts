import { NextRequest, NextResponse } from "next/server";
import { fetchTokenBalances, fetchDefiPositions } from "@/lib/ankr";
import { fetchNativePrices, fetchTokenLogos } from "@/lib/coingecko";
import { fetchTokenPricesDefiLlama, fetchTokenPriceHistory, fetchHistoricalTokenPrices } from "@/lib/defillama";
import { fetchVaultAssetValues, fetchVaultDepositInfo, fetchMintBasedVaults } from "@/lib/erc4626";
import { fetchTokenCostBasis } from "@/lib/cost-basis";
import { fetchMerklIncentiveAPRs, fetchMerklUserRewards } from "@/lib/merkl";
import { fetchMaliciousTokens } from "@/lib/goplus";
import { fetchUnverifiedContracts } from "@/lib/blockscout";
import { SUPPORTED_CHAINS } from "@/lib/chains";
import { aggregateYield } from "@/lib/yield";
import type { PortfolioData } from "@/types/portfolio";

export async function GET(
  request: NextRequest,
  { params }: { params: { address: string } }
) {
  const { address } = params;
  const searchParams = request.nextUrl.searchParams;
  const chainsParam = searchParams.get("chains");
  const chainIds = chainsParam
    ? chainsParam.split(",").map(Number).filter(Boolean)
    : SUPPORTED_CHAINS.map((c) => c.id);
  // fast=true: skip slow per-vault / per-token Blockscout enrichment so the
  // client can render basic data immediately, then re-fetch for full enrichment.
  const fast = searchParams.get("fast") === "true";

  try {
    let [tokens, defiPositions] = await Promise.all([
      fetchTokenBalances(address, chainIds),
      fetchDefiPositions(address, chainIds),
    ]);

    // Security filters — run in parallel (both fail open on error)
    //   1. GoPlus: removes honeypots and blacklisted tokens
    //   2. Blockscout: removes tokens whose contract source is not verified
    const erc20sToCheck = tokens.filter((t) => !t.isNative && t.address !== "native");
    if (erc20sToCheck.length > 0) {
      const checkList = erc20sToCheck.map((t) => ({ address: t.address, chainId: t.chainId }));
      const [malicious, unverified] = await Promise.all([
        fetchMaliciousTokens(checkList),
        fetchUnverifiedContracts(checkList),
      ]);
      const toRemove = new Set([...malicious, ...unverified]);
      if (toRemove.size > 0) {
        tokens = tokens.filter((t) => {
          if (t.isNative || t.address === "native") return true;
          return !toRemove.has(`${t.chainId}:${t.address.toLowerCase()}`);
        });
      }
    }

    // Enrich native token prices
    const nativeSymbols = Array.from(new Set(tokens.filter((t) => t.isNative).map((t) => t.symbol)));
    const nativePrices = await fetchNativePrices(nativeSymbols);

    for (const token of tokens) {
      if (token.isNative && token.usdPrice == null) {
        const price = nativePrices[token.symbol];
        if (price != null) {
          token.usdPrice = price;
          token.usdValue = token.balanceFormatted * price;
        }
      }
    }

    // Layer 3: DeFiLlama — primary ERC-20 pricing (all chains in one batched request)
    // CoinGecko's contract-address endpoint is limited to 1 address/request on the free tier,
    // making it unusable for batch pricing. DeFiLlama has no such restriction.
    const unpricedErc20sForLlama = tokens.filter(
      (t) => !t.isNative && t.usdPrice == null && t.address && t.address !== "native"
    );
    if (unpricedErc20sForLlama.length > 0) {
      const defiLlamaPrices = await fetchTokenPricesDefiLlama(
        unpricedErc20sForLlama.map((t) => ({ address: t.address, chainId: t.chainId }))
      );
      for (const token of unpricedErc20sForLlama) {
        const price = defiLlamaPrices.get(`${token.chainId}:${token.address.toLowerCase()}`);
        if (price != null) {
          token.usdPrice = price;
          token.usdValue = token.balanceFormatted * price;
        }
      }
    }

    // Layer 5: Vault detection + relocation to DeFi Positions
    // Three detection passes, in order:
    //   5a. ERC-4626 (asset() + convertToAssets())
    //   5b. Aave aTokens (UNDERLYING_ASSET_ADDRESS()) — handled inside fetchVaultAssetValues
    //   5c. Mint-based heuristic (any incoming Transfer from=0x0) for custom vaults
    //       like EtherFi BoringVaults, InfiniFi staked tokens, Ethena sENA, etc.
    //
    // We check ALL ERC-20s because DeFiLlama/Ankr may already price vault share tokens —
    // confirmed vaults are re-priced via on-chain data and moved to defiPositions[].

    // underlyingDecimals per vault key — populated in 5a/5b, used during enrichment
    const vaultUnderlyingDecimals = new Map<string, number>();
    // vaultValues retained at function scope so the enrichment step can read vaultType
    let vaultValues = new Map<string, import("@/lib/erc4626").VaultAssetValue>();

    const allErc20s = tokens.filter(
      (t) => !t.isNative && t.address && t.address !== "native"
    );
    if (allErc20s.length > 0) {
      vaultValues = await fetchVaultAssetValues(
        allErc20s.map((t) => ({
          address: t.address,
          chainId: t.chainId,
          balance: t.balance,
        }))
      );

      if (vaultValues.size > 0) {
        // Build a combined price map from all already-priced tokens
        const priceMap = new Map<string, number>();
        for (const t of tokens) {
          if (t.usdPrice != null) {
            priceMap.set(`${t.chainId}:${t.address.toLowerCase()}`, t.usdPrice);
          }
        }

        // Fetch prices for any underlying assets not already in the price map
        const needUnderlying: { address: string; chainId: number }[] = [];
        for (const [key, v] of vaultValues) {
          const chainId = Number(key.split(":")[0]);
          if (!priceMap.has(`${chainId}:${v.underlyingAddress}`)) {
            needUnderlying.push({ address: v.underlyingAddress, chainId });
          }
        }
        if (needUnderlying.length > 0) {
          const extraPrices = await fetchTokenPricesDefiLlama(needUnderlying);
          for (const [k, price] of extraPrices) priceMap.set(k, price);
        }

        // Price vault tokens and collect their keys for relocation
        const vaultKeys = new Set<string>();
        for (const token of allErc20s) {
          const tokenKey = `${token.chainId}:${token.address.toLowerCase()}`;
          const vault = vaultValues.get(tokenKey);
          if (!vault) continue;
          const underlyingPrice = priceMap.get(`${token.chainId}:${vault.underlyingAddress}`);
          if (underlyingPrice == null) continue;

          token.usdValue = vault.underlyingAmount * underlyingPrice;
          if (token.balanceFormatted > 0) {
            token.usdPrice = token.usdValue / token.balanceFormatted;
          }
          vaultKeys.add(tokenKey);
          vaultUnderlyingDecimals.set(tokenKey, vault.underlyingDecimals);
        }

        // Splice vault tokens out of tokens[] and push into defiPositions[]
        for (let i = tokens.length - 1; i >= 0; i--) {
          const t = tokens[i];
          const key = `${t.chainId}:${t.address.toLowerCase()}`;
          if (!vaultKeys.has(key)) continue;

          const vault = vaultValues.get(key)!;
          // Look up underlying token details from the already-fetched tokens list
          const underlying = tokens.find(
            (u) => u.chainId === t.chainId && u.address.toLowerCase() === vault.underlyingAddress
          );

          defiPositions.push({
            protocol: t.name,
            protocolId: t.address,
            chain: t.chain,
            chainId: t.chainId,
            positionType: "vault",
            label: "Vault",
            depositedValueUSD: t.usdValue,
            currentValueUSD: t.usdValue,
            yieldUSD: null,
            yieldPct: null,
            apy: null,
            tokens: [{
              symbol:   underlying?.symbol ?? vault.underlyingAddress.slice(0, 8),
              name:     underlying?.name   ?? vault.underlyingAddress,
              address:  vault.underlyingAddress,
              logo:     underlying?.logo   ?? null,
              amount:   vault.underlyingAmount,
              usdValue: t.usdValue,
              type:     "underlying",
            }],
            depositDate: null,
            daysHeld:    null,
            incentiveApr: null,
            unclaimedRewards: [],
          });

          tokens.splice(i, 1);
        }
      }
    }

    // Layer 5c: Mint-based vault detection for custom vault types not covered by
    // ERC-4626 or Aave detection (e.g. EtherFi BoringVaults, Ethena sENA, etc.).
    // A token that was ever minted directly to the user (Transfer from=0x0) is a
    // vault/staking receipt, not a regular token holding.
    const remainingErc20s = tokens.filter(
      (t) => !t.isNative && t.address !== "native"
    );
    if (remainingErc20s.length > 0) {
      const mintVaultKeys = await fetchMintBasedVaults(address, remainingErc20s);
      if (mintVaultKeys.size > 0) {
        for (let i = tokens.length - 1; i >= 0; i--) {
          const t = tokens[i];
          const key = `${t.chainId}:${t.address.toLowerCase()}`;
          if (!mintVaultKeys.has(key)) continue;

          defiPositions.push({
            protocol: t.name,
            protocolId: t.address,
            chain: t.chain,
            chainId: t.chainId,
            positionType: "vault",
            label: "Vault",
            depositedValueUSD: t.usdValue,
            currentValueUSD: t.usdValue,
            yieldUSD: null,
            yieldPct: null,
            apy: null,
            // Include the vault share token itself as the "underlying" so that
            // the deposit-info enrichment pass can compute yield:
            //   underlyingAmount  = balanceFormatted (current shares held)
            //   underlyingPrice   = currentValueUSD / balanceFormatted  (share price)
            //   depositedValueUSD = netShares * sharePrice  (approximate cost basis)
            tokens: [{
              symbol:   t.symbol,
              name:     t.name,
              address:  t.address,
              logo:     t.logo,
              amount:   t.balanceFormatted,
              usdValue: t.usdValue,
              type:     "underlying",
            }],
            depositDate: null,
            daysHeld:    null,
            incentiveApr: null,
            unclaimedRewards: [],
          });

          tokens.splice(i, 1);
        }
      }
    }

    // Enrich ALL vault positions with on-chain deposit history + Merkl incentives.
    // Skipped entirely in fast mode — deposit info requires many paginated Blockscout
    // requests per vault and is the main latency bottleneck.
    const vaultPositions = defiPositions.filter((p) => p.positionType === "vault");
    if (!fast && vaultPositions.length > 0) {
      const depositInfoMap = await fetchVaultDepositInfo(
        vaultPositions.map((p) => {
          const v = vaultValues.get(`${p.chainId}:${p.protocolId.toLowerCase()}`);
          return {
            vaultAddress:       p.protocolId,
            chainId:            p.chainId,
            userAddress:        address,
            underlyingDecimals: vaultUnderlyingDecimals.get(`${p.chainId}:${p.protocolId.toLowerCase()}`) ?? 18,
            underlyingAddress:      v?.underlyingAddress ?? "",
            vaultType:              v?.vaultType ?? "custom",
            lockEpoch:              v?.lockEpoch,
            lockControllerAddress:  v?.lockControllerAddress,
          };
        })
      );

      // ── Historical price lookup for 1:1 vaults ───────────────────────────────
      // Some vaults (e.g. InfiniFi lock) hold the underlying token at a 1:1 ratio;
      // the yield comes from the underlying token's own USD price appreciation over
      // time, not from an exchange-rate increase in the vault itself. When
      // deposited_underlying ≈ current_underlying (<1% diff), using the current
      // price for both sides gives deposited == current and hides all yield.
      // Fix: fetch the historical underlying price at deposit time and use it for
      // depositedValueUSD so the USD difference reflects the token's price change.
      const historicalPriceRequests: Array<{
        address: string; chainId: number; unixTimestamp: number; posKey: string;
      }> = [];
      for (const pos of vaultPositions) {
        const posKey = `${pos.chainId}:${pos.protocolId.toLowerCase()}`;
        const info  = depositInfoMap.get(posKey);
        const vault = vaultValues.get(posKey);
        if (!info || info.netDepositedAssets <= 0 || !vault?.underlyingAddress) continue;
        const currentUnderlyingAmt = vault.underlyingAmount ?? 0;
        if (currentUnderlyingAmt <= 0) continue;
        const ratio = Math.abs(info.netDepositedAssets - currentUnderlyingAmt) / currentUnderlyingAmt;
        if (ratio > 0.01) continue; // exchange-rate vault — current price approach already works
        const depositRef = info.weightedAvgDepositAt ?? info.firstDepositAt;
        if (!depositRef) continue;
        historicalPriceRequests.push({
          address: vault.underlyingAddress,
          chainId: pos.chainId,
          unixTimestamp: Math.floor(new Date(depositRef).getTime() / 1000),
          posKey,
        });
      }
      const historicalPriceMap = historicalPriceRequests.length > 0
        ? await fetchHistoricalTokenPrices(
            historicalPriceRequests.map(({ address, chainId, unixTimestamp }) => ({
              address, chainId, unixTimestamp,
            }))
          )
        : new Map<string, number>();
      const posHistoricalPrice = new Map<string, number>();
      for (const { address, chainId, unixTimestamp, posKey } of historicalPriceRequests) {
        const price = historicalPriceMap.get(`${chainId}:${address.toLowerCase()}:${unixTimestamp}`);
        if (price != null) posHistoricalPrice.set(posKey, price);
      }

      for (const pos of vaultPositions) {
        const posKey = `${pos.chainId}:${pos.protocolId.toLowerCase()}`;
        const info   = depositInfoMap.get(posKey);
        const vault  = vaultValues.get(posKey);   // has underlyingAddress + underlyingAmount
        if (!info || pos.currentValueUSD == null) continue;

        // ── Deposit date and days held (display — always from first deposit) ────
        pos.depositDate = info.firstDepositAt;
        if (info.firstDepositAt) {
          pos.daysHeld = Math.max(1, Math.floor(
            (Date.now() - new Date(info.firstDepositAt).getTime()) / 86_400_000
          ));
        }

        if (info.netDepositedAssets <= 0) continue;

        // ── Underlying price ──────────────────────────────────────────────────
        // For ERC-4626 / Aave vaults: vault.underlyingAmount = convertToAssets(balance).
        // currentValueUSD was set to underlyingAmount × underlyingTokenPrice, so we
        // can recover the exact underlying price without a separate map lookup.
        // For custom vaults without vault data, fall back to pos.tokens[0].
        const currentUnderlyingAmt =
          vault?.underlyingAmount ??
          pos.tokens[0]?.amount   ??
          0;

        if (currentUnderlyingAmt <= 0) continue;

        // Use historical deposit price for 1:1 vaults (posHistoricalPrice set above).
        // For exchange-rate vaults, historicalPrice is undefined and we fall through
        // to the current-price derivation, which correctly reflects the rate growth.
        const historicalDepositPrice = posHistoricalPrice.get(posKey);
        const underlyingPrice = historicalDepositPrice ?? (pos.currentValueUSD / currentUnderlyingAmt);
        pos.depositedValueUSD  = info.netDepositedAssets * underlyingPrice;
        if (pos.depositedValueUSD <= 0) continue;

        // ── Yield (net value + earned %) ──────────────────────────────────────
        pos.yieldUSD = pos.currentValueUSD - pos.depositedValueUSD;
        pos.yieldPct = (pos.yieldUSD / pos.depositedValueUSD) * 100;

        // ── APY (annualised) ──────────────────────────────────────────────────
        // Use the deposit-amount-weighted average timestamp so that a large recent
        // top-up shifts the reference date forward rather than being ignored.
        const apyRef = info.weightedAvgDepositAt ?? info.firstDepositAt;
        if (apyRef) {
          const daysForApy = Math.max(1, (Date.now() - new Date(apyRef).getTime()) / 86_400_000);
          const totalReturn = pos.yieldUSD / pos.depositedValueUSD;
          // Compound annualisation: (1 + r)^(365/d) − 1
          pos.apy = (Math.pow(1 + totalReturn, 365 / daysForApy) - 1) * 100;
        }
      }

      // Merkl incentive APRs + unclaimed rewards for vault positions
      const [merklAPRs, merklRewards] = await Promise.all([
        fetchMerklIncentiveAPRs(
          vaultPositions.map((p) => ({ vaultAddress: p.protocolId, chainId: p.chainId }))
        ),
        fetchMerklUserRewards(
          address,
          vaultPositions.map((p) => ({ vaultAddress: p.protocolId, chainId: p.chainId }))
        ),
      ]);

      for (const pos of vaultPositions) {
        const key = `${pos.chainId}:${pos.protocolId.toLowerCase()}`;
        pos.incentiveApr    = merklAPRs.get(key)    ?? null;
        pos.unclaimedRewards = merklRewards.get(key) ?? [];
      }
    }

    // Logo enrichment + 30-day price history + cost basis run in parallel.
    // Cost basis is skipped in fast mode (requires N batches of Blockscout requests).
    const noLogo = tokens.filter((t) => !t.logo);
    const [logoMap, chartData, costBasisMap] = await Promise.all([
      noLogo.length > 0
        ? fetchTokenLogos(
            noLogo.map((t) => ({
              address: t.address,
              chainId: t.chainId,
              symbol: t.symbol,
              isNative: t.isNative,
            }))
          )
        : Promise.resolve(new Map<string, string>()),
      fetchTokenPriceHistory([
        ...tokens,
        // Include underlying tokens from DeFi positions so their value is reflected in the chart
        ...defiPositions.flatMap((pos) =>
          pos.tokens
            .filter((t) => t.type === "underlying" || t.type === "deposit")
            .map((t) => ({
              address: t.address,
              chainId: pos.chainId,
              balanceFormatted: t.amount,
              usdValue: t.usdValue,
              isNative: false as const,
            }))
        ),
      ]),
      fast
        ? Promise.resolve(new Map<string, import("@/lib/cost-basis").CostBasisResult>())
        : fetchTokenCostBasis(
            tokens.map((t) => ({
              address:          t.address,
              chainId:          t.chainId,
              decimals:         t.decimals,
              balanceFormatted: t.balanceFormatted,
              usdPrice:         t.usdPrice,
              usdValue:         t.usdValue,
              isNative:         t.isNative,
            })),
            address
          ),
    ]);
    for (const token of noLogo) {
      const key = `${token.chainId}:${token.isNative ? "native" : token.address.toLowerCase()}`;
      const url = logoMap.get(key);
      if (url) token.logo = url;
    }

    // Merge cost basis + P&L into token objects
    for (const token of tokens) {
      const key = `${token.chainId}:${token.address.toLowerCase()}`;
      const cb  = costBasisMap.get(key);
      if (!cb || !token.usdPrice) continue;
      token.avgCostPerToken  = cb.avgCostPerToken;
      token.unrealizedPnlUSD = (token.usdValue ?? 0) - cb.totalCostUSD;
      token.unrealizedPnlPct = cb.avgCostPerToken > 0
        ? ((token.usdPrice - cb.avgCostPerToken) / cb.avgCostPerToken) * 100
        : null;
    }

    const tokensValueUSD = tokens.reduce((sum, t) => sum + (t.usdValue ?? 0), 0);
    const defiValueUSD = defiPositions.reduce((sum, p) => sum + (p.currentValueUSD ?? 0), 0);
    const totalValueUSD = tokensValueUSD + defiValueUSD;

    const { totalYieldUSD, totalDepositedUSD, overallYieldPct } = aggregateYield(defiPositions);

    const chains = Array.from(new Set([
      ...tokens.map((t) => t.chain),
      ...defiPositions.map((p) => p.chain),
    ]));

    const data: PortfolioData = {
      address,
      totalValueUSD,
      tokensValueUSD,
      defiValueUSD,
      totalYieldUSD,
      totalYieldPct: overallYieldPct,
      tokens,
      defiPositions,
      chains,
      chartData,
      fetchedAt: new Date().toISOString(),
      enriched: !fast,
    };

    return NextResponse.json(data);
  } catch (err) {
    console.error("[/api/portfolio]", err);
    return NextResponse.json({ error: "Failed to fetch portfolio" }, { status: 500 });
  }
}
