// Merkl (by Angle Labs) — incentive APR and user reward data
// Docs: https://api.merkl.xyz
import { fetchTokenPricesDefiLlama } from "./defillama";
import type { UnclaimedReward } from "@/types/portfolio";

const V3 = "https://api.merkl.xyz/v3";
const V4 = "https://api.merkl.xyz/v4";

/**
 * Fetch Merkl incentive APRs for a list of vault/pool addresses.
 * Uses the v4 opportunities endpoint keyed by vault contract address.
 *
 * Returns Map<"chainId:vaultAddress", incentiveApr%>
 */
export async function fetchMerklIncentiveAPRs(
  positions: { vaultAddress: string; chainId: number }[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (positions.length === 0) return result;

  // Group by chain to batch per-chain requests
  const byChain: Record<number, string[]> = {};
  for (const { vaultAddress, chainId } of positions) {
    (byChain[chainId] ??= []).push(vaultAddress.toLowerCase());
  }

  await Promise.allSettled(
    Object.entries(byChain).map(async ([chainIdStr, addrs]) => {
      const chainId = Number(chainIdStr);
      await Promise.allSettled(
        addrs.map(async (addr) => {
          try {
            const res = await fetch(
              `${V4}/opportunities?chainId=${chainId}&identifier=${addr}&items=10`,
              { signal: AbortSignal.timeout(8000), next: { revalidate: 300 } } as RequestInit
            );
            if (!res.ok) return;
            const items: any[] = await res.json();
            if (!Array.isArray(items) || items.length === 0) return;

            // Sum APRs from all active campaigns for this vault
            const totalApr = items
              .filter((o: any) => o.status === "LIVE" && o.apr > 0)
              .reduce((sum: number, o: any) => sum + (o.apr ?? 0), 0);

            if (totalApr > 0) {
              result.set(`${chainId}:${addr}`, totalApr);
            }
          } catch { /* skip */ }
        })
      );
    })
  );

  return result;
}

/**
 * Fetch user's unclaimed Merkl rewards, attributed to specific vault addresses.
 *
 * Merkl associates each reward "reason" with vault addresses embedded in the
 * reason key (e.g. "...~MorphoVaultV2_ERC20_0xBEeFF047..."). We extract all
 * 0x addresses from the reason key and, if any match one of the user's vault
 * positions, accumulate the unclaimed amount for that vault.
 *
 * Returns Map<"chainId:vaultAddress", UnclaimedReward[]>
 */
export async function fetchMerklUserRewards(
  userAddress: string,
  vaults: { vaultAddress: string; chainId: number }[]
): Promise<Map<string, UnclaimedReward[]>> {
  const result = new Map<string, UnclaimedReward[]>();
  if (vaults.length === 0) return result;

  const byChain: Record<number, string[]> = {};
  for (const { vaultAddress, chainId } of vaults) {
    (byChain[chainId] ??= []).push(vaultAddress.toLowerCase());
  }

  await Promise.allSettled(
    Object.entries(byChain).map(async ([chainIdStr, vaultAddrs]) => {
      const chainId = Number(chainIdStr);
      try {
        const res = await fetch(
          `${V3}/userRewards?user=${userAddress}&chainId=${chainId}&proof=false`,
          { signal: AbortSignal.timeout(8000), next: { revalidate: 120 } } as RequestInit
        );
        if (!res.ok) return;
        const data: Record<string, any> = await res.json();

        // tokenAddr (lowercased) → { symbol, decimals, byVault: Map<vaultAddr, bigint unclaimed> }
        const tokensByVault = new Map<string, Map<string, { symbol: string; decimals: number; raw: bigint }>>();

        for (const [rawTokenAddr, tokenInfo] of Object.entries(data)) {
          const tokenAddr = rawTokenAddr.toLowerCase();
          const symbol: string  = tokenInfo.symbol;
          const decimals: number = tokenInfo.decimals ?? 18;
          const reasons: Record<string, { unclaimed: string }> = tokenInfo.reasons ?? {};

          for (const [reasonKey, reasonData] of Object.entries(reasons)) {
            const unclaimed = BigInt(reasonData.unclaimed ?? "0");
            if (unclaimed <= BigInt(0)) continue;

            // Extract all 0x addresses from the reason key
            const addrMatches = reasonKey.match(/0x[A-Fa-f0-9]{40}/g) ?? [];
            const reasonAddrs = addrMatches.map((a) => a.toLowerCase());

            // Attribute to the first matching vault address found in this reason
            const matchedVault = vaultAddrs.find((v) => reasonAddrs.includes(v));
            if (!matchedVault) continue;

            if (!tokensByVault.has(matchedVault)) tokensByVault.set(matchedVault, new Map());
            const vaultMap = tokensByVault.get(matchedVault)!;

            if (!vaultMap.has(tokenAddr)) {
              vaultMap.set(tokenAddr, { symbol, decimals, raw: BigInt(0) });
            }
            vaultMap.get(tokenAddr)!.raw += unclaimed;
          }
        }

        // Fetch USD prices for reward tokens
        const rewardTokens = new Set<string>();
        for (const vaultMap of tokensByVault.values()) {
          for (const addr of vaultMap.keys()) rewardTokens.add(addr);
        }
        const prices = rewardTokens.size > 0
          ? await fetchTokenPricesDefiLlama([...rewardTokens].map((a) => ({ address: a, chainId })))
          : new Map<string, number>();

        // Build result
        for (const [vaultAddr, vaultMap] of tokensByVault) {
          const rewards: UnclaimedReward[] = [];
          for (const [tokenAddr, { symbol, decimals, raw }] of vaultMap) {
            const amount = Number(raw) / Math.pow(10, decimals);
            const price  = prices.get(`${chainId}:${tokenAddr.toLowerCase()}`) ?? null;
            rewards.push({
              tokenAddress: tokenAddr,
              symbol,
              decimals,
              amount,
              usdValue: price != null ? amount * price : null,
            });
          }
          if (rewards.length > 0) {
            result.set(`${chainId}:${vaultAddr}`, rewards);
          }
        }
      } catch { /* Merkl unavailable — skip */ }
    })
  );

  return result;
}
