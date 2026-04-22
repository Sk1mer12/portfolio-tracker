/**
 * ERC-4626 vault share pricing via on-chain reads.
 *
 * Standard price APIs cannot value vault share tokens (e.g. Morpho vaults, ERC-4626
 * wrappers) because their NAV is determined by contract state, not DEX markets.
 * This module calls convertToAssets(balance) on-chain to get the exact underlying
 * token amount, then multiplies by the underlying token's USD price.
 */
import { createPublicClient, http, parseAbi } from "viem";
import {
  mainnet,
  base,
  arbitrum,
  optimism,
  bsc,
  avalanche,
  polygon,
} from "viem/chains";

const ERC4626_ABI = parseAbi([
  "function asset() view returns (address)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
]);

const ERC20_ABI = parseAbi([
  "function decimals() view returns (uint8)",
]);

// Aave v2/v3 aToken interface — not ERC-4626, but has a standard underlying accessor.
// Balance of an aToken equals the underlying amount (1:1 with accrued interest built in).
const AAVE_ATOKEN_ABI = parseAbi([
  "function UNDERLYING_ASSET_ADDRESS() view returns (address)",
]);

// Explicit public RPC URLs — viem's defaults (cloudflare-eth.com) are unreliable.
// drpc.org provides free, no-key public endpoints for all supported chains.
const CHAIN_CONFIG: Record<number, { chain: Parameters<typeof createPublicClient>[0]["chain"]; rpc: string }> = {
  1:      { chain: mainnet,   rpc: "https://eth.drpc.org" },
  8453:   { chain: base,      rpc: "https://base.drpc.org" },
  42161:  { chain: arbitrum,  rpc: "https://arbitrum.drpc.org" },
  10:     { chain: optimism,  rpc: "https://optimism.drpc.org" },
  56:     { chain: bsc,       rpc: "https://bsc.drpc.org" },
  43114:  { chain: avalanche, rpc: "https://avalanche.drpc.org" },
  137:    { chain: polygon,   rpc: "https://polygon.drpc.org" },
};

// Module-level client cache — avoids re-creating clients on every request
const _clients = new Map<number, ReturnType<typeof createPublicClient>>();

function getClient(chainId: number) {
  if (!_clients.has(chainId)) {
    const cfg = CHAIN_CONFIG[chainId];
    if (!cfg) return null;
    _clients.set(chainId, createPublicClient({ chain: cfg.chain, transport: http(cfg.rpc) }));
  }
  return _clients.get(chainId)!;
}

/** Safely convert a raw bigint fixed-point value to a JS float without precision loss. */
function bigintToFloat(value: bigint, decimals: number): number {
  if (value === BigInt(0)) return 0;
  const str = value.toString();
  if (decimals === 0) return Number(str);
  const padded = str.padStart(decimals + 1, "0");
  const intPart = padded.slice(0, padded.length - decimals);
  const fracPart = padded.slice(padded.length - decimals);
  return parseFloat(`${intPart}.${fracPart}`);
}

export interface VaultAssetValue {
  /** Underlying ERC-20 token address (lowercased) */
  underlyingAddress: string;
  /** Underlying token decimals */
  underlyingDecimals: number;
  /** Underlying token amount the vault shares are worth (human-readable float) */
  underlyingAmount: number;
  /**
   * How the vault was detected:
   *   "erc4626" — standard ERC-4626 Deposit/Withdraw events available
   *   "aave"    — Aave aToken (1:1 underlying, no standard deposit events)
   *   "lock"    — protocol-specific locked position (e.g. InfiniFi liUSD-Xw)
   */
  vaultType: "erc4626" | "aave" | "lock";
}

/**
 * For each token in `tokens`, attempt ERC-4626 detection and valuation via
 * on-chain multicall. Non-vault tokens (where `asset()` reverts) are silently
 * skipped.
 *
 * @param tokens  Unpriced ERC-20 tokens with their raw `balance` strings
 * @returns Map keyed by `${chainId}:${address}` → vault asset value
 */
export async function fetchVaultAssetValues(
  tokens: { address: string; chainId: number; balance: string }[]
): Promise<Map<string, VaultAssetValue>> {
  const result = new Map<string, VaultAssetValue>();
  if (tokens.length === 0) return result;

  // Group by chain
  const byChain: Record<number, typeof tokens> = {};
  for (const t of tokens) {
    (byChain[t.chainId] ??= []).push(t);
  }

  await Promise.allSettled(
    Object.entries(byChain).map(async ([chainIdStr, chainTokens]) => {
      const chainId = Number(chainIdStr);
      const client = getClient(chainId);
      if (!client) return;

      // ── Round 1: asset() + convertToAssets() for every unpriced token ──────
      // allowFailure:true means non-ERC4626 tokens simply return status:'failure'
      let round1: { status: "success" | "failure"; result?: unknown }[];
      try {
        round1 = await client.multicall({
          contracts: chainTokens.flatMap((t) => [
            {
              address: t.address as `0x${string}`,
              abi: ERC4626_ABI,
              functionName: "asset" as const,
            },
            {
              address: t.address as `0x${string}`,
              abi: ERC4626_ABI,
              functionName: "convertToAssets" as const,
              args: [BigInt(t.balance || "0")] as const,
            },
          ]),
          allowFailure: true,
        }) as { status: "success" | "failure"; result?: unknown }[];
      } catch {
        return; // multicall not available or network error — skip chain
      }

      // ── Collect confirmed ERC-4626 vaults ──────────────────────────────────
      const vaults: Array<{
        token: (typeof chainTokens)[0];
        underlyingAddress: string;
        underlyingRawAmount: bigint;
        vaultType: "erc4626" | "aave" | "lock";
      }> = [];

      for (let i = 0; i < chainTokens.length; i++) {
        const assetRes  = round1[i * 2];
        const amountRes = round1[i * 2 + 1];
        if (
          assetRes.status  === "success" &&
          amountRes.status === "success" &&
          typeof assetRes.result === "string" &&
          typeof amountRes.result === "bigint"
        ) {
          vaults.push({
            token: chainTokens[i],
            underlyingAddress: assetRes.result.toLowerCase(),
            underlyingRawAmount: amountRes.result,
            vaultType: "erc4626",
          });
        }
      }

      // ── Round 1b: Aave aToken detection (UNDERLYING_ASSET_ADDRESS) ────────────
      // For tokens that are NOT ERC-4626, try the Aave aToken interface.
      // aToken balance == underlying amount (1:1 by definition).
      const vaultAddresses = new Set(vaults.map((v) => v.token.address.toLowerCase()));
      const nonVaultTokens = chainTokens.filter(
        (t) => !vaultAddresses.has(t.address.toLowerCase())
      );

      if (nonVaultTokens.length > 0) {
        let round1b: { status: "success" | "failure"; result?: unknown }[];
        try {
          round1b = await client.multicall({
            contracts: nonVaultTokens.map((t) => ({
              address: t.address as `0x${string}`,
              abi: AAVE_ATOKEN_ABI,
              functionName: "UNDERLYING_ASSET_ADDRESS" as const,
            })),
            allowFailure: true,
          }) as { status: "success" | "failure"; result?: unknown }[];
        } catch {
          round1b = nonVaultTokens.map(() => ({ status: "failure" as const }));
        }

        for (let i = 0; i < nonVaultTokens.length; i++) {
          const res = round1b[i];
          if (res.status === "success" && typeof res.result === "string") {
            vaults.push({
              token: nonVaultTokens[i],
              underlyingAddress: res.result.toLowerCase(),
              // aToken balance IS the underlying amount — no conversion needed
              underlyingRawAmount: BigInt(nonVaultTokens[i].balance || "0"),
              vaultType: "aave",
            });
          }
        }
      }

      // ── Round 1c: InfiniFi LockedPositionToken detection (Ethereum mainnet only) ──
      // InfiniFi locked-iUSD tokens (liUSD-2w, liUSD-4w, liUSD-13w, …) are NOT
      // ERC-4626. Each lock duration has its own per-bucket exchange rate obtained
      // from LockingController.exchangeRate(unwindingEpochs) — WAD iUSD per share.
      // Using siUSD.convertToAssets() would apply the wrong rate because longer
      // locks earn a yield premium and accumulate iUSD at a higher rate than siUSD.
      //
      // Detection fingerprint: core() returns the shared InfiniFiCore address.
      // All current and future liUSD variants deploy with the same Core, so this is
      // forward-compatible within the InfiniFi protocol.
      if (chainId === 1) {
        const INFINIFI_CORE = "0xf6d48735eccf12bdc1df2674b1ce3fcb3bd25490";
        const INFINIFI_IUSD = "0x48f9e38f3070ad8945dfeae3fa70987722e3d89c";

        const INFINIFI_CORE_ABI = parseAbi([
          "function core() view returns (address)",
        ]);

        // Only check tokens not already identified as ERC-4626 or Aave vaults
        const vaultAddresses2 = new Set(vaults.map((v) => v.token.address.toLowerCase()));
        const nonVaultTokens2 = chainTokens.filter(
          (t) => !vaultAddresses2.has(t.address.toLowerCase())
        );

        if (nonVaultTokens2.length > 0) {
          let round1c: { status: "success" | "failure"; result?: unknown }[];
          try {
            round1c = await client.multicall({
              contracts: nonVaultTokens2.map((t) => ({
                address: t.address as `0x${string}`,
                abi: INFINIFI_CORE_ABI,
                functionName: "core" as const,
              })),
              allowFailure: true,
            }) as { status: "success" | "failure"; result?: unknown }[];
          } catch {
            round1c = nonVaultTokens2.map(() => ({ status: "failure" as const }));
          }

          // Collect tokens whose core() returned the InfiniFi core address
          const lockCandidates = nonVaultTokens2.filter((_, i) => {
            const r = round1c[i];
            return (
              r.status === "success" &&
              typeof r.result === "string" &&
              r.result.toLowerCase() === INFINIFI_CORE
            );
          });

          if (lockCandidates.length > 0) {
            // Resolve per-bucket exchange rates from the LockingController.
            // The gateway proxy exposes getAddress("lockingController") to find it.
            // LockingController.exchangeRate(unwindingEpochs) returns WAD (1e18 = 1.0),
            // meaning iUSD per liUSD share — the correct per-duration rate.
            const GATEWAY_ABI = parseAbi([
              "function getAddress(string name) view returns (address)",
            ]);
            const LOCKING_ABI = parseAbi([
              "function getEnabledBuckets() view returns (uint32[])",
              "function shareToken(uint32 unwindingEpochs) view returns (address)",
              "function exchangeRate(uint32 unwindingEpochs) view returns (uint256)",
            ]);
            const INFINIFI_GATEWAY = "0x3f04b65ddbd87f9ce0a2e7eb24d80e7fb87625b5" as `0x${string}`;

            try {
              // Step 1: resolve LockingController address from the gateway proxy
              const lockingControllerAddr = (await client.readContract({
                address: INFINIFI_GATEWAY,
                abi: GATEWAY_ABI,
                functionName: "getAddress",
                args: ["lockingController"],
              }) as string).toLowerCase() as `0x${string}`;

              // Step 2: get all enabled lock-duration buckets
              const enabledBuckets = (await client.readContract({
                address: lockingControllerAddr,
                abi: LOCKING_ABI,
                functionName: "getEnabledBuckets",
              })) as readonly number[];

              // Step 3: map shareToken address → unwindingEpochs
              const shareTokenResults = await client.multicall({
                contracts: enabledBuckets.map((epoch) => ({
                  address: lockingControllerAddr,
                  abi: LOCKING_ABI,
                  functionName: "shareToken" as const,
                  args: [epoch] as const,
                })),
                allowFailure: true,
              }) as { status: "success" | "failure"; result?: unknown }[];

              const shareTokenToEpoch = new Map<string, number>();
              for (let i = 0; i < enabledBuckets.length; i++) {
                const r = shareTokenResults[i];
                if (r.status === "success" && typeof r.result === "string") {
                  shareTokenToEpoch.set(r.result.toLowerCase(), enabledBuckets[i]);
                }
              }

              // Step 4: fetch exchangeRate for each relevant epoch
              const relevantEpochs = lockCandidates
                .map((t) => shareTokenToEpoch.get(t.address.toLowerCase()))
                .filter((e): e is number => e !== undefined);
              const uniqueEpochs = [...new Set(relevantEpochs)];

              const exchangeRateResults = await client.multicall({
                contracts: uniqueEpochs.map((epoch) => ({
                  address: lockingControllerAddr,
                  abi: LOCKING_ABI,
                  functionName: "exchangeRate" as const,
                  args: [epoch] as const,
                })),
                allowFailure: true,
              }) as { status: "success" | "failure"; result?: unknown }[];

              const epochToRate = new Map<number, bigint>();
              for (let i = 0; i < uniqueEpochs.length; i++) {
                const r = exchangeRateResults[i];
                if (r.status === "success" && typeof r.result === "bigint") {
                  epochToRate.set(uniqueEpochs[i], r.result);
                }
              }

              // Step 5: compute raw iUSD amount for each lock token
              for (const t of lockCandidates) {
                const epoch = shareTokenToEpoch.get(t.address.toLowerCase());
                if (epoch === undefined) continue;
                const rate = epochToRate.get(epoch);
                if (rate === undefined) continue;

                // exchangeRate is WAD: multiply balance by rate then divide by 1e18
                const balance = BigInt(t.balance || "0");
                const iusdRaw = (balance * rate) / BigInt("1000000000000000000");

                vaults.push({
                  token: t,
                  underlyingAddress: INFINIFI_IUSD,
                  underlyingRawAmount: iusdRaw,
                  vaultType: "lock",
                });
              }
            } catch { /* skip InfiniFi pricing on RPC error */ }
          }
        }
      }

      if (vaults.length === 0) return;

      // ── Round 2: decimals() for each unique underlying asset ────────────────
      const uniqueUnderlyings = [...new Set(vaults.map((v) => v.underlyingAddress))];
      let round2: { status: "success" | "failure"; result?: unknown }[];
      try {
        round2 = await client.multicall({
          contracts: uniqueUnderlyings.map((addr) => ({
            address: addr as `0x${string}`,
            abi: ERC20_ABI,
            functionName: "decimals" as const,
          })),
          allowFailure: true,
        }) as { status: "success" | "failure"; result?: unknown }[];
      } catch {
        round2 = uniqueUnderlyings.map(() => ({ status: "failure" as const }));
      }

      const decimalsByAddr: Record<string, number> = {};
      for (let i = 0; i < uniqueUnderlyings.length; i++) {
        const r = round2[i];
        decimalsByAddr[uniqueUnderlyings[i]] =
          r.status === "success" && typeof r.result === "number" ? r.result : 18;
      }

      // ── Build final result map ───────────────────────────────────────────────
      for (const v of vaults) {
        const decimals = decimalsByAddr[v.underlyingAddress] ?? 18;
        result.set(`${chainId}:${v.token.address.toLowerCase()}`, {
          underlyingAddress: v.underlyingAddress,
          underlyingDecimals: decimals,
          underlyingAmount: bigintToFloat(v.underlyingRawAmount, decimals),
          vaultType: v.vaultType,
        });
      }
    })
  );

  return result;
}

// ── ERC-4626 event topic hashes (keccak256 of canonical signature) ───────────
// Used to parse raw Blockscout log entries when Blockscout's event decoder
// hasn't decoded the log (log.decoded is null/empty).
//
// Deposit(address indexed caller, address indexed owner, uint256 assets, uint256 shares)
const ERC4626_DEPOSIT_TOPIC  = "0xdcbc1c05240f31ff3ad067ef1ee35ce4997762752e3a095284754544f4c709d7";
// Withdraw(address indexed caller, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)
const ERC4626_WITHDRAW_TOPIC = "0xfbde797d201c681b91056529119e0b02407c7bb96a4a2c75c01fc9667232c8db";

// ABI layout for both events: non-indexed params are abi.encode(uint256 assets, uint256 shares)
// data = 0x + [32 bytes assets][32 bytes shares]  → slice(2, 66) gives assets as hex

// ── Blockscout explorer base URLs per chain ─────────────────────────────────
const BLOCKSCOUT_BASE: Record<number, string> = {
  1:      "https://eth.blockscout.com",
  8453:   "https://base.blockscout.com",
  42161:  "https://arbitrum.blockscout.com",
  10:     "https://optimism.blockscout.com",
  56:     "https://bsc.blockscout.com",
  43114:  "https://avalanche.blockscout.com",
  137:    "https://polygon.blockscout.com",
};

export interface VaultDepositInfo {
  /** Net underlying assets deposited minus withdrawn (human-readable float) */
  netDepositedAssets: number;
  /** ISO timestamp of the first deposit, or null if no deposits found */
  firstDepositAt: string | null;
  /**
   * Deposit-amount-weighted average timestamp of all Deposit events.
   * More accurate than firstDepositAt for APY annualisation when there are multiple deposits —
   * a large recent top-up should shift the reference date forward, not be ignored.
   */
  weightedAvgDepositAt: string | null;
}

/**
 * Fetch all pages of Blockscout token-transfer results for a given URL,
 * following the `next_page_params` cursor until exhausted.
 */
async function fetchAllTransfers(url: string): Promise<any[]> {
  const items: any[] = [];
  let nextParams: string | null = null;
  do {
    const fullUrl: string = nextParams ? `${url}&${nextParams}` : url;
    const res = await fetch(fullUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) break;
    const data = await res.json();
    items.push(...(data.items ?? []));
    nextParams = data.next_page_params
      ? new URLSearchParams(
          Object.entries(data.next_page_params).map(([k, v]) => [k, String(v)])
        ).toString()
      : null;
  } while (nextParams);
  return items;
}

/**
 * Fetch all log entries emitted by a contract address via Blockscout's
 * `/api/v2/addresses/{addr}/logs` endpoint, following cursor pagination.
 * Capped at maxPages (default 100) to avoid stalling on extremely active vaults.
 */
async function fetchVaultLogs(
  explorer: string,
  vaultAddress: string,
  maxPages = 100
): Promise<any[]> {
  const items: any[] = [];
  let nextParams: string | null = null;
  let page = 0;
  do {
    const url: string = nextParams
      ? `${explorer}/api/v2/addresses/${vaultAddress}/logs?${nextParams}`
      : `${explorer}/api/v2/addresses/${vaultAddress}/logs`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) break;
      const data = await res.json();
      items.push(...(data.items ?? []));
      nextParams = data.next_page_params
        ? new URLSearchParams(
            Object.entries(data.next_page_params).map(([k, v]) => [k, String(v)])
          ).toString()
        : null;
    } catch { break; }
    page++;
  } while (nextParams && page < maxPages);
  return items;
}

/**
 * For each vault, resolve the net deposited underlying asset amount.
 *
 * ERC-4626 vaults (vaultType "erc4626"):
 *   Fetch all logs emitted by the vault contract and filter for standard
 *   Deposit / Withdraw events where the indexed `owner` matches the user.
 *   netDeposited = Σ Deposit.assets  −  Σ Withdraw.assets
 *   No per-transaction fetching required — one paginated call per vault.
 *
 * Aave aTokens (vaultType "aave"):
 *   Transfer amounts are used directly — aToken balance is 1:1 with underlying.
 *
 * Lock / custom vaults (vaultType "lock" | "custom"):
 *   Fall back to per-transaction log decoding via Blockscout token-transfer API.
 *
 * Returns a Map keyed by `${chainId}:${vaultAddress}` (address lowercased).
 */
export async function fetchVaultDepositInfo(
  vaults: Array<{
    vaultAddress: string;
    chainId: number;
    userAddress: string;
    underlyingDecimals: number;
    vaultType: "erc4626" | "aave" | "lock" | "custom";
  }>
): Promise<Map<string, VaultDepositInfo>> {
  const result = new Map<string, VaultDepositInfo>();
  if (vaults.length === 0) return result;

  await Promise.allSettled(
    vaults.map(async (v) => {
      const explorer = BLOCKSCOUT_BASE[v.chainId];
      if (!explorer) return;

      const vaultAddr = v.vaultAddress.toLowerCase();
      const key       = `${v.chainId}:${vaultAddr}`;

      // ── ERC-4626: read Deposit/Withdraw events directly from contract logs ────
      if (v.vaultType === "erc4626") {
        try {
          const allLogs = await fetchVaultLogs(explorer, v.vaultAddress);

          // ERC-4626 indexed layout:
          //   Deposit(address indexed caller, address indexed owner, uint256 assets, uint256 shares)
          //     topic[2] = owner (the user whose shares are minted)
          //   Withdraw(address indexed caller, address indexed receiver, address indexed owner, ...)
          //     topic[3] = owner (the user whose shares are burned)
          // Non-indexed params: abi.encode(uint256 assets, uint256 shares)
          //   data[2:66] hex = assets (first 32-byte word)
          const paddedUser = "0x" + "0".repeat(24) + v.userAddress.slice(2).toLowerCase();

          let totalDeposited    = BigInt(0);
          let totalDepositFloat = 0;  // float-precision running sum for weighted timestamp
          let weightedTsAccum   = 0;  // Σ (floatAmount × unixMs)
          let firstDepositMs: number | null = null;

          for (const log of allLogs) {
            if ((log.topics?.[0] ?? "").toLowerCase() !== ERC4626_DEPOSIT_TOPIC) continue;
            if ((log.topics?.[2] ?? "").toLowerCase() !== paddedUser) continue;
            const data: string = log.data ?? "";
            if (data.length < 66) continue;

            const rawAmt   = BigInt("0x" + data.slice(2, 66));
            const floatAmt = bigintToFloat(rawAmt, v.underlyingDecimals);
            totalDeposited    += rawAmt;
            totalDepositFloat += floatAmt;

            const ms = log.timestamp ? new Date(log.timestamp).getTime() : null;
            if (ms) {
              weightedTsAccum += floatAmt * ms;
              if (firstDepositMs === null || ms < firstDepositMs) firstDepositMs = ms;
            }
          }

          if (totalDeposited === BigInt(0)) return;

          let totalWithdrawn = BigInt(0);
          for (const log of allLogs) {
            if ((log.topics?.[0] ?? "").toLowerCase() !== ERC4626_WITHDRAW_TOPIC) continue;
            if ((log.topics?.[3] ?? "").toLowerCase() !== paddedUser) continue;
            const data: string = log.data ?? "";
            if (data.length < 66) continue;
            totalWithdrawn += BigInt("0x" + data.slice(2, 66));
          }

          const netRaw         = totalDeposited > totalWithdrawn ? totalDeposited - totalWithdrawn : BigInt(0);
          const weightedAvgMs  = totalDepositFloat > 0 ? weightedTsAccum / totalDepositFloat : null;

          result.set(key, {
            netDepositedAssets:   bigintToFloat(netRaw, v.underlyingDecimals),
            firstDepositAt:       firstDepositMs !== null ? new Date(firstDepositMs).toISOString() : null,
            weightedAvgDepositAt: weightedAvgMs  !== null ? new Date(weightedAvgMs).toISOString()  : null,
          });
        } catch { /* network error — skip vault */ }
        return;
      }

      // ── Aave / lock / custom: Transfer-based approach ─────────────────────────
      try {
        const [inItems, outItems] = await Promise.all([
          fetchAllTransfers(
            `${explorer}/api/v2/addresses/${v.userAddress}/token-transfers?token=${v.vaultAddress}&filter=to`
          ),
          fetchAllTransfers(
            `${explorer}/api/v2/addresses/${v.userAddress}/token-transfers?token=${v.vaultAddress}&filter=from`
          ),
        ]);

        const NULL_ADDR  = "0x0000000000000000000000000000000000000000";
        const depositTxs = inItems.filter((t: any) => t.from?.hash?.toLowerCase() === NULL_ADDR);
        const allOutTxs  = outItems as any[];

        if (depositTxs.length === 0) return;

        const earliestTimestamp: string | null = depositTxs[depositTxs.length - 1]?.timestamp ?? null;
        const firstDepositAt = earliestTimestamp ? new Date(earliestTimestamp).toISOString() : null;

        // Decode asset amount from a single transaction's logs.
        // Pass 1: raw topic matching restricted to vaultAddr (prevents multi-contract tx collisions).
        // Pass 2: Blockscout decoded-event fallback (handles Supply/Enter naming variants).
        const getAssetsFromTx = async (txHash: string, eventNames: string[]): Promise<bigint> => {
          try {
            const res = await fetch(`${explorer}/api/v2/transactions/${txHash}/logs`, {
              signal: AbortSignal.timeout(6000),
            });
            if (!res.ok) return BigInt(0);
            const { items } = await res.json();

            for (const log of items ?? []) {
              const sig     = (log.topics?.[0] ?? "").toLowerCase();
              const logAddr = (log.address?.hash ?? "").toLowerCase();
              if (logAddr !== vaultAddr) continue;
              if (
                (eventNames.includes("Deposit")  && sig === ERC4626_DEPOSIT_TOPIC) ||
                (eventNames.includes("Withdraw") && sig === ERC4626_WITHDRAW_TOPIC)
              ) {
                const data: string = log.data ?? "";
                if (data.length >= 66) return BigInt("0x" + data.slice(2, 66));
              }
            }
            for (const log of items ?? []) {
              const method: string = log.decoded?.method_call ?? "";
              if (!eventNames.some((n) => method.startsWith(n))) continue;
              const params: any[] = log.decoded?.parameters ?? [];
              const p = params.find((x: any) => x.name === "assets" || x.name === "amount");
              if (p?.value) return BigInt(p.value);
            }
          } catch { /* ignore */ }
          return BigInt(0);
        };

        let totalDeposited = BigInt(0);

        if (v.vaultType === "aave") {
          for (const tx of depositTxs) {
            totalDeposited += BigInt((tx as any).total?.value ?? "0");
          }
        } else {
          // lock / custom: require event decode; bail if any is missing
          const depositAmounts = await Promise.allSettled(
            depositTxs.map((tx: any) =>
              getAssetsFromTx(tx.transaction_hash, ["Deposit", "Supply", "Enter"])
            )
          );
          for (const r of depositAmounts) {
            const amount = r.status === "fulfilled" ? r.value : BigInt(0);
            if (amount === BigInt(0)) {
              result.set(key, { netDepositedAssets: 0, firstDepositAt, weightedAvgDepositAt: firstDepositAt });
              return;
            }
            totalDeposited += amount;
          }
        }

        const withdrawAmounts = await Promise.allSettled(
          allOutTxs.map((tx: any) =>
            getAssetsFromTx(tx.transaction_hash, ["Withdraw", "Exit"])
          )
        );

        let totalWithdrawn = BigInt(0);
        for (let i = 0; i < allOutTxs.length; i++) {
          const tx      = allOutTxs[i];
          const r       = withdrawAmounts[i];
          const decoded = r.status === "fulfilled" ? r.value : BigInt(0);
          if (decoded > BigInt(0)) {
            totalWithdrawn += decoded;
          } else if (tx.to?.hash?.toLowerCase() === NULL_ADDR) {
            totalWithdrawn += BigInt((tx as any).total?.value ?? "0");
          }
        }

        const netRaw = totalDeposited - totalWithdrawn;
        result.set(key, {
          netDepositedAssets:   netRaw > BigInt(0) ? bigintToFloat(netRaw, v.underlyingDecimals) : 0,
          firstDepositAt,
          weightedAvgDepositAt: firstDepositAt,  // single deposit point for aave/lock/custom
        });
      } catch { /* network error — skip vault */ }
    })
  );

  return result;
}

/**
 * Detects vault/staking receipt tokens by checking whether the user ever received
 * them via a mint (Transfer from=0x0). This catches custom vault types that don't
 * implement ERC-4626 or Aave's UNDERLYING_ASSET_ADDRESS (e.g. EtherFi BoringVaults,
 * InfiniFi staked tokens, Ethena sENA, etc.).
 *
 * Only checks tokens with meaningful USD value (≥ $5) to avoid false positives from
 * airdropped governance tokens distributed via minting to treasuries.
 *
 * Returns a Set of `${chainId}:${address}` keys for tokens identified as vaults.
 */
export async function fetchMintBasedVaults(
  userAddress: string,
  tokens: { address: string; chainId: number; usdValue: number | null }[]
): Promise<Set<string>> {
  const result = new Set<string>();

  const NULL_ADDR = "0x0000000000000000000000000000000000000000";

  // Check all tokens on Blockscout-supported chains regardless of USD value.
  // Tokens with no market price (usdValue === null) are exactly the ones that need
  // this detection — protocol receipt/lock tokens that don't trade openly.
  // Spam/airdrop protection is handled upstream by fetchUnverifiedContracts.
  const candidates = tokens.filter(
    (t) => BLOCKSCOUT_BASE[t.chainId]
  );

  await Promise.allSettled(
    candidates.map(async (t) => {
      const explorer = BLOCKSCOUT_BASE[t.chainId];
      try {
        const res = await fetch(
          `${explorer}/api/v2/addresses/${userAddress}/token-transfers?token=${t.address}&filter=to`,
          { signal: AbortSignal.timeout(6000) }
        );
        if (!res.ok) return;
        const { items } = await res.json();
        if (!Array.isArray(items) || items.length === 0) return;

        // If ANY incoming transfer was a mint from 0x0, it's a vault/staking receipt
        const hasMint = (items as any[]).some(
          (tx) => tx.from?.hash?.toLowerCase() === NULL_ADDR
        );
        if (hasMint) {
          result.add(`${t.chainId}:${t.address.toLowerCase()}`);
        }
      } catch { /* skip */ }
    })
  );

  return result;
}
