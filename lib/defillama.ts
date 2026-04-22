// DeFiLlama coins API — free, no key required
// Docs: https://defillama.com/docs/api
import type { PortfolioChartPoint } from "@/types/portfolio";

const BASE = "https://coins.llama.fi";

// Max coin keys per request — DeFiLlama handles large batches but we stay safe
const DEFILLAMA_BATCH_SIZE = 100;

// Map chainId → DeFiLlama chain prefix
export const DEFILLAMA_CHAIN: Record<number, string> = {
  1:      "ethereum",
  8453:   "base",
  42161:  "arbitrum",
  10:     "optimism",
  56:     "bsc",
  43114:  "avax",
  137:    "polygon",
};

/**
 * Fetch USD prices for ERC-20 tokens via DeFiLlama's /prices/current endpoint.
 * All chains can be batched in a single request — key format: "{chain}:{address}".
 *
 * Returns a map keyed by `${chainId}:${address}` (address lowercased).
 */
export async function fetchTokenPricesDefiLlama(
  tokens: { address: string; chainId: number }[]
): Promise<Map<string, number>> {
  const priceMap = new Map<string, number>();
  if (tokens.length === 0) return priceMap;

  // Build coin keys and track which key maps back to which chainId
  const keyToChainId = new Map<string, number>();
  for (const { address, chainId } of tokens) {
    const chain = DEFILLAMA_CHAIN[chainId];
    if (!chain) continue;
    const key = `${chain}:${address.toLowerCase()}`;
    keyToChainId.set(key, chainId);
  }

  const allKeys = Array.from(keyToChainId.keys());
  if (allKeys.length === 0) return priceMap;

  for (let i = 0; i < allKeys.length; i += DEFILLAMA_BATCH_SIZE) {
    const chunk = allKeys.slice(i, i + DEFILLAMA_BATCH_SIZE);
    try {
      const res = await fetch(`${BASE}/prices/current/${chunk.join(",")}`, {
        next: { revalidate: 60 },
        signal: AbortSignal.timeout(8000),
      } as RequestInit);
      if (!res.ok) continue;

      const data: { coins: Record<string, { price?: number }> } = await res.json();

      for (const [key, info] of Object.entries(data.coins ?? {})) {
        if (info?.price == null) continue;
        const chainId = keyToChainId.get(key);
        if (chainId == null) continue;
        // key is "chain:address" — extract the address part
        const addr = key.slice(key.indexOf(":") + 1);
        priceMap.set(`${chainId}:${addr}`, info.price);
      }
    } catch {
      // chunk failed — continue with remaining chunks
    }
  }

  return priceMap;
}

// DeFiLlama coingecko IDs for native chain tokens — used for historical price lookup
const NATIVE_COINGECKO_ID: Record<number, string> = {
  1:      "coingecko:ethereum",
  8453:   "coingecko:ethereum",   // Base uses ETH
  42161:  "coingecko:ethereum",   // Arbitrum uses ETH
  10:     "coingecko:ethereum",   // Optimism uses ETH
  56:     "coingecko:binancecoin",
  43114:  "coingecko:avalanche-2",
  137:    "coingecko:matic-network",
};

/**
 * Fetch 30-day price history for a set of token holdings and return daily
 * portfolio value points. Uses DeFiLlama's /chart endpoint (free, no key).
 *
 * Assumes current balances are constant over the lookback window — this gives
 * a price-performance view rather than an exact historical balance chart.
 *
 * Only tokens with usdValue ≥ $1 are included to reduce noise and URL length.
 */
export async function fetchTokenPriceHistory(
  tokens: Array<{
    address: string;
    chainId: number;
    balanceFormatted: number;
    usdValue: number | null;
    isNative?: boolean;
  }>,
  days = 30
): Promise<PortfolioChartPoint[]> {
  const meaningful = tokens.filter((t) => (t.usdValue ?? 0) >= 1);
  if (meaningful.length === 0) return [];

  const startTimestamp = Math.floor(Date.now() / 1000) - days * 86400;

  // Build coin-key → accumulated balance map
  // Native tokens across chains that share the same asset (e.g., ETH on L2s) are summed.
  const keyBalanceMap = new Map<string, number>();
  for (const t of meaningful) {
    let key: string;
    if (t.isNative || t.address === "native") {
      const nativeKey = NATIVE_COINGECKO_ID[t.chainId];
      if (!nativeKey) continue;
      key = nativeKey;
    } else {
      const chain = DEFILLAMA_CHAIN[t.chainId];
      if (!chain) continue;
      key = `${chain}:${t.address.toLowerCase()}`;
    }
    keyBalanceMap.set(key, (keyBalanceMap.get(key) ?? 0) + t.balanceFormatted);
  }

  const allKeys = Array.from(keyBalanceMap.keys());
  if (allKeys.length === 0) return [];

  try {
    const url =
      `${BASE}/chart/${allKeys.join(",")}` +
      `?start=${startTimestamp}&span=${days}&period=1d&searchWidth=43200`;

    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      next: { revalidate: 0 },
    } as RequestInit);
    if (!res.ok) return [];

    const data: {
      coins: Record<string, { prices: Array<{ timestamp: number; price: number }> }>;
    } = await res.json();

    // Sum (balance × price) per calendar day across all tokens
    const dailyValues = new Map<number, number>();
    for (const [key, info] of Object.entries(data.coins ?? {})) {
      const balance = keyBalanceMap.get(key) ?? 0;
      if (balance === 0 || !info.prices?.length) continue;
      for (const { timestamp, price } of info.prices) {
        const dayTs = Math.floor(timestamp / 86400) * 86400;
        dailyValues.set(dayTs, (dailyValues.get(dayTs) ?? 0) + balance * price);
      }
    }

    if (dailyValues.size < 2) return [];

    return Array.from(dailyValues.entries())
      .sort(([a], [b]) => a - b)
      .map(([ts, valueUSD]) => ({
        date: new Date(ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        valueUSD,
      }));
  } catch {
    return [];
  }
}
