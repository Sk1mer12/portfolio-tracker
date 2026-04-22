/**
 * Token cost basis tracking.
 *
 * Strategy: weighted-average cost method
 *   1. Fetch all incoming ERC-20 transfers via Blockscout (up to MAX_PAGES per token)
 *   2. Fetch all outgoing transfers (to compute remaining proportional cost)
 *   3. Resolve the token price at each transfer date via DeFiLlama /prices/historical
 *   4. Compute weighted avg buy price for the current holding
 *
 * Only ERC-20 tokens (non-native) with a known current price and USD value ≥ MIN_USD
 * are processed — native tokens require full transaction history parsing which is
 * out of scope here.
 */

import { BLOCKSCOUT_BASE } from "@/lib/blockscout";
import { DEFILLAMA_CHAIN } from "@/lib/defillama";

const DEFILLAMA_BASE  = "https://coins.llama.fi";
const MAX_PAGES       = 3;   // ≤ 150 transfers per token — sufficient for most holders
const MIN_USD         = 5;   // skip dust
const CONCURRENCY     = 5;   // max parallel Blockscout token-transfer fetches

export interface CostBasisResult {
  /** Weighted-average USD price paid per token unit */
  avgCostPerToken: number;
  /** Total USD cost basis of the current holding */
  totalCostUSD: number;
}

// ── Safe BigInt → float conversion (avoids JS Number precision loss) ─────────
function rawToFloat(raw: string, decimals: number): number {
  if (!raw || raw === "0") return 0;
  try {
    const big = BigInt(raw);
    if (big === BigInt(0)) return 0;
    const str = big.toString().padStart(decimals + 1, "0");
    const int  = str.slice(0, str.length - decimals);
    const frac = str.slice(str.length - decimals);
    return parseFloat(`${int}.${frac}`);
  } catch {
    return 0;
  }
}

// ── Blockscout paginated transfer fetch ───────────────────────────────────────
async function fetchTransfersPaged(baseUrl: string, maxPages = MAX_PAGES): Promise<any[]> {
  const all: any[] = [];
  let cursor: string | null = null;
  let page = 0;
  do {
    const url: string = cursor ? `${baseUrl}&${cursor}` : baseUrl;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) break;
      const data = await res.json();
      all.push(...(data.items ?? []));
      cursor = data.next_page_params
        ? new URLSearchParams(
            Object.entries(data.next_page_params).map(([k, v]) => [k, String(v)])
          ).toString()
        : null;
    } catch { break; }
    page++;
  } while (cursor && page < maxPages);
  return all;
}

// ── DeFiLlama historical price lookups ────────────────────────────────────────
// Group by day and fire one /prices/historical/{ts}/{coins} request per unique day.
// Returns map keyed by `${coinKey}::${dayTimestamp}` → price
async function fetchHistoricalByDay(
  requests: { coinKey: string; dayTs: number }[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (requests.length === 0) return result;

  // Group coin keys by day timestamp
  const byDay = new Map<number, Set<string>>();
  for (const { coinKey, dayTs } of requests) {
    const s = byDay.get(dayTs) ?? new Set<string>();
    s.add(coinKey);
    byDay.set(dayTs, s);
  }

  await Promise.allSettled(
    Array.from(byDay.entries()).map(async ([dayTs, coinKeySet]) => {
      const keys = Array.from(coinKeySet).join(",");
      try {
        const res = await fetch(
          `${DEFILLAMA_BASE}/prices/historical/${dayTs}/${keys}?searchWidth=600`,
          { signal: AbortSignal.timeout(10000) }
        );
        if (!res.ok) return;
        const data: { coins: Record<string, { price?: number }> } = await res.json();
        for (const [key, info] of Object.entries(data.coins ?? {})) {
          // Normalize key to lowercase — DeFiLlama may return checksummed addresses
          if (info?.price != null) result.set(`${key.toLowerCase()}::${dayTs}`, info.price);
        }
      } catch { /* ignore */ }
    })
  );

  return result;
}

/**
 * Compute weighted-average cost basis for a set of token holdings.
 *
 * Returns a map keyed by `${chainId}:${address}` (address lowercased).
 */
export async function fetchTokenCostBasis(
  tokens: Array<{
    address: string;
    chainId: number;
    decimals: number;
    balanceFormatted: number;
    usdPrice: number | null;
    usdValue: number | null;
    isNative?: boolean;
  }>,
  userAddress: string
): Promise<Map<string, CostBasisResult>> {
  const result = new Map<string, CostBasisResult>();

  const candidates = tokens.filter(
    (t) =>
      !t.isNative &&
      t.address !== "native" &&
      t.usdPrice != null &&
      t.usdPrice > 0 &&
      (t.usdValue ?? 0) >= MIN_USD &&
      BLOCKSCOUT_BASE[t.chainId] &&
      DEFILLAMA_CHAIN[t.chainId]
  );
  if (candidates.length === 0) return result;

  // ── Fetch transfer histories with concurrency limit (avoid rate limiting) ──
  const transferResults: PromiseSettledResult<{ token: typeof candidates[0]; inItems: any[]; outItems: any[] }>[] = [];
  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const batch = candidates.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map(async (t) => {
        const explorer = BLOCKSCOUT_BASE[t.chainId];
        const [inItems, outItems] = await Promise.all([
          fetchTransfersPaged(
            `${explorer}/api/v2/addresses/${userAddress}/token-transfers?token=${t.address}&filter=to`
          ),
          fetchTransfersPaged(
            `${explorer}/api/v2/addresses/${userAddress}/token-transfers?token=${t.address}&filter=from`
          ),
        ]);
        return { token: t, inItems, outItems };
      })
    );
    transferResults.push(...batchResults);
  }

  // ── Collect (coinKey, dayTimestamp) pairs for price lookup ────────────────
  const priceReqs: { coinKey: string; dayTs: number }[] = [];
  const fetched: { token: typeof candidates[0]; inItems: any[]; outItems: any[] }[] = [];

  for (const r of transferResults) {
    if (r.status !== "fulfilled") continue;
    const { token, inItems, outItems } = r.value;
    if (inItems.length === 0) continue; // no history at all → skip

    fetched.push({ token, inItems, outItems });

    const chain   = DEFILLAMA_CHAIN[token.chainId];
    const coinKey = `${chain}:${token.address.toLowerCase()}`;

    for (const tx of [...inItems, ...outItems]) {
      const ts = Math.floor(new Date(tx.timestamp).getTime() / 1000);
      if (ts > 0) {
        priceReqs.push({ coinKey, dayTs: Math.floor(ts / 86400) * 86400 });
      }
    }
  }

  // Deduplicate
  const uniqueReqs = Array.from(
    new Map(priceReqs.map((r) => [`${r.coinKey}::${r.dayTs}`, r])).values()
  );

  // ── Batch historical price lookup ─────────────────────────────────────────
  const histPrices = await fetchHistoricalByDay(uniqueReqs);

  // ── Compute weighted-average cost basis per token ─────────────────────────
  for (const { token, inItems, outItems } of fetched) {
    const chain   = DEFILLAMA_CHAIN[token.chainId];
    const coinKey = `${chain}:${token.address.toLowerCase()}`;

    const parseAmt = (tx: any): number => {
      const dec = parseInt((tx.total?.decimals ?? String(token.decimals)) || "18", 10);
      return rawToFloat(tx.total?.value ?? "0", dec);
    };

    // Sum cost of all incoming transfers
    let totalCostUSD  = 0;
    let totalReceived = 0;

    for (const tx of inItems) {
      const amount = parseAmt(tx);
      if (amount <= 0) continue;
      const dayTs = Math.floor(new Date(tx.timestamp).getTime() / 1000 / 86400) * 86400;
      const price = histPrices.get(`${coinKey}::${dayTs}`);
      if (price == null) continue; // no price data → skip this transfer
      totalCostUSD  += amount * price;
      totalReceived += amount;
    }

    if (totalReceived === 0) continue; // no priced transfers found

    // Proportion of received tokens still held (reduce cost basis for amounts sent out)
    let totalSent = 0;
    for (const tx of outItems) totalSent += parseAmt(tx);

    const propHeld       = Math.min(1, Math.max(0, (totalReceived - totalSent) / totalReceived));
    const adjCostUSD     = totalCostUSD * propHeld;
    const adjReceived    = totalReceived * propHeld;
    if (adjReceived <= 0) continue;

    const key = `${token.chainId}:${token.address.toLowerCase()}`;
    result.set(key, {
      avgCostPerToken: adjCostUSD / adjReceived,
      totalCostUSD:    adjCostUSD,
    });
  }

  return result;
}
