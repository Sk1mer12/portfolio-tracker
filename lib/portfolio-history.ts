/**
 * Historical portfolio value reconstruction.
 *
 * Unlike the old approach (current balances × historical prices), this:
 *   1. Fetches all ERC-20 token transfers from Blockscout for the lookback window
 *   2. Reconstructs the end-of-day balance for each token on each day by walking
 *      backwards from the current balance and undoing each day's transfers
 *   3. Fetches 30-day price history from DeFiLlama and forward-fills gaps
 *   4. Sums balance × price per day to get actual historical portfolio value
 *
 * Native tokens (ETH etc.) and DeFi vault underlyings use current balance ×
 * historical price — a known approximation since full native tx reconstruction
 * is out of scope.
 */

import { BLOCKSCOUT_BASE } from "@/lib/blockscout";
import { DEFILLAMA_CHAIN } from "@/lib/defillama";
import type { PortfolioChartPoint } from "@/types/portfolio";

const DEFILLAMA_BASE = "https://coins.llama.fi";
const MAX_PAGES = 6; // ~300 transfers per chain; stops early once past the window
const CHART_BATCH = 100; // DeFiLlama /chart max keys per request

const NATIVE_COINGECKO_ID: Record<number, string> = {
  1:     "coingecko:ethereum",
  8453:  "coingecko:ethereum",
  42161: "coingecko:ethereum",
  10:    "coingecko:ethereum",
  56:    "coingecko:binancecoin",
  43114: "coingecko:avalanche-2",
  137:   "coingecko:matic-network",
};

function rawToFloat(raw: string, decimals: number): number {
  if (!raw || raw === "0") return 0;
  try {
    const big = BigInt(raw);
    if (big === BigInt(0)) return 0;
    const str = big.toString().padStart(decimals + 1, "0");
    return parseFloat(str.slice(0, -decimals) + "." + str.slice(-decimals));
  } catch {
    return 0;
  }
}

interface RawTransfer {
  chainId: number;
  tokenAddress: string;
  decimals: number;
  amount: number;
  direction: "in" | "out";
  timestamp: number; // unix seconds
}

async function fetchChainTransfers(
  chainId: number,
  address: string,
  sinceTs: number
): Promise<RawTransfer[]> {
  const base = BLOCKSCOUT_BASE[chainId];
  if (!base) return [];

  const addrLower = address.toLowerCase();
  const results: RawTransfer[] = [];
  let cursor: string | null = null;
  let page = 0;

  do {
    const qs: string = cursor ? `?type=ERC-20&${cursor}` : "?type=ERC-20";
    try {
      const res = await fetch(
        `${base}/api/v2/addresses/${address}/token-transfers${qs}`,
        { signal: AbortSignal.timeout(10_000) }
      );
      if (!res.ok) break;
      const data = await res.json();

      let reachedWindow = false;
      for (const item of data.items ?? []) {
        const ts = Math.floor(new Date(item.timestamp).getTime() / 1000);
        if (ts < sinceTs) { reachedWindow = true; break; }

        const tokenAddress = (item.token?.address ?? "").toLowerCase();
        if (!tokenAddress) continue;
        const decimals = parseInt(item.token?.decimals ?? "18", 10);
        const amount = rawToFloat(item.total?.value ?? "0", decimals);
        if (amount <= 0) continue;

        results.push({
          chainId,
          tokenAddress,
          decimals,
          amount,
          direction: (item.from?.hash ?? "").toLowerCase() === addrLower ? "out" : "in",
          timestamp: ts,
        });
      }

      if (reachedWindow) break;
      cursor = data.next_page_params
        ? new URLSearchParams(
            Object.entries(data.next_page_params as Record<string, unknown>).map(
              ([k, v]) => [k, String(v)]
            )
          ).toString()
        : null;
    } catch { break; }
    page++;
  } while (cursor && page < MAX_PAGES);

  return results;
}

export async function fetchPortfolioHistory(
  address: string,
  chainIds: number[],
  currentTokens: Array<{
    address: string;
    chainId: number;
    balanceFormatted: number;
    usdValue: number | null;
    isNative?: boolean;
  }>,
  days = 30
): Promise<PortfolioChartPoint[]> {
  const nowTs = Math.floor(Date.now() / 1000);
  const todayStartTs = Math.floor(nowTs / 86_400) * 86_400;
  // Fetch one extra day of buffer so we don't miss transfers near the boundary
  const sinceTs = todayStartTs - (days + 1) * 86_400;

  // ── 1. Fetch ERC-20 transfer history across all chains ──────────────────────
  const allTransfers = (
    await Promise.allSettled(
      chainIds.map((id) => fetchChainTransfers(id, address, sinceTs))
    )
  ).flatMap((r) => (r.status === "fulfilled" ? r.value : []));

  // Newest → oldest for backwards reconstruction
  allTransfers.sort((a, b) => b.timestamp - a.timestamp);

  // ── 2. Reconstruct end-of-day ERC-20 balances working backwards ─────────────
  // Start from current balances and undo each day's transfers going back in time.
  const workingBalance = new Map<string, number>();
  for (const t of currentTokens) {
    if (t.isNative || t.address === "native") continue;
    const key = `${t.chainId}:${t.address.toLowerCase()}`;
    workingBalance.set(key, (workingBalance.get(key) ?? 0) + t.balanceFormatted);
  }

  // daySnapshots[i] = end-of-day balances for (todayStartTs - i * 86400)
  const daySnapshots: Map<string, number>[] = [];
  let txIdx = 0;

  for (let i = 0; i <= days; i++) {
    const dayStart = todayStartTs - i * 86_400;
    // Upper bound for this day's transfers
    const dayEnd = i === 0 ? nowTs + 1 : todayStartTs - (i - 1) * 86_400;

    // Snapshot before undoing = end-of-day balance
    daySnapshots.push(new Map(workingBalance));

    // Undo all transfers that occurred during [dayStart, dayEnd)
    while (txIdx < allTransfers.length) {
      const tx = allTransfers[txIdx];
      if (tx.timestamp >= dayEnd) { txIdx++; continue; } // already consumed
      if (tx.timestamp < dayStart) break; // too old for this day
      const key = `${tx.chainId}:${tx.tokenAddress}`;
      const curr = workingBalance.get(key) ?? 0;
      workingBalance.set(
        key,
        tx.direction === "in"
          ? Math.max(0, curr - tx.amount) // we received it → had less before
          : curr + tx.amount              // we sent it → had more before
      );
      txIdx++;
    }
  }

  // ── 3. Collect all token keys ever held during the window ───────────────────
  const allTokenKeys = new Set<string>();
  for (const snap of daySnapshots) {
    for (const [key, bal] of snap) {
      if (bal > 0) allTokenKeys.add(key);
    }
  }

  // Build DeFiLlama coin keys and reverse map
  const coinKeyToTokenKeys = new Map<string, string[]>();
  for (const tokenKey of allTokenKeys) {
    const colonIdx = tokenKey.indexOf(":");
    const chainId = Number(tokenKey.slice(0, colonIdx));
    const tokenAddress = tokenKey.slice(colonIdx + 1);
    const chain = DEFILLAMA_CHAIN[chainId];
    if (!chain) continue;
    const coinKey = `${chain}:${tokenAddress}`;
    const list = coinKeyToTokenKeys.get(coinKey) ?? [];
    list.push(tokenKey);
    coinKeyToTokenKeys.set(coinKey, list);
  }

  // Native tokens (ETH, BNB, etc.) use current balance × historical price
  const nativeBalance = new Map<string, number>(); // coinKey → summed balance
  for (const t of currentTokens) {
    if (!t.isNative && t.address !== "native") continue;
    if ((t.usdValue ?? 0) < 1) continue;
    const coinKey = NATIVE_COINGECKO_ID[t.chainId];
    if (!coinKey) continue;
    nativeBalance.set(coinKey, (nativeBalance.get(coinKey) ?? 0) + t.balanceFormatted);
  }

  const allCoinKeys = [
    ...Array.from(coinKeyToTokenKeys.keys()),
    ...Array.from(nativeBalance.keys()),
  ];
  if (allCoinKeys.length === 0) return [];

  // ── 4. Fetch 30-day price history from DeFiLlama /chart ─────────────────────
  const priceSeriesByCoinKey = new Map<string, Map<number, number>>();
  const allDayTs = new Set<number>();

  for (let i = 0; i < allCoinKeys.length; i += CHART_BATCH) {
    const chunk = allCoinKeys.slice(i, i + CHART_BATCH);
    try {
      const url =
        `${DEFILLAMA_BASE}/chart/${chunk.join(",")}` +
        `?start=${sinceTs}&span=${days + 2}&period=1d&searchWidth=43200`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) continue;
      const data: {
        coins: Record<string, { prices: Array<{ timestamp: number; price: number }> }>;
      } = await res.json();
      for (const [coinKey, info] of Object.entries(data.coins ?? {})) {
        if (!info.prices?.length) continue;
        const series = new Map<number, number>();
        for (const { timestamp, price } of info.prices) {
          const dayTs = Math.floor(timestamp / 86_400) * 86_400;
          series.set(dayTs, price);
          allDayTs.add(dayTs);
        }
        priceSeriesByCoinKey.set(coinKey.toLowerCase(), series);
      }
    } catch { /* continue with next chunk */ }
  }

  const sortedDayTs = Array.from(allDayTs).sort((a, b) => a - b);
  if (sortedDayTs.length < 2) return [];

  // ── 5. Forward-fill prices and compute daily portfolio value ─────────────────
  const dailyValues = new Map<number, number>();

  // ERC-20: reconstructed balance per day × forward-filled price
  for (const [coinKey, series] of priceSeriesByCoinKey) {
    const tokenKeys = coinKeyToTokenKeys.get(coinKey);
    if (!tokenKeys?.length) continue;

    let lastPrice: number | null = null;
    for (const dayTs of sortedDayTs) {
      const price = series.get(dayTs);
      if (price != null) lastPrice = price;
      if (lastPrice == null) continue;

      const i = Math.round((todayStartTs - dayTs) / 86_400);
      if (i < 0 || i > days) continue;
      const snap = daySnapshots[i];

      for (const tokenKey of tokenKeys) {
        const balance = snap?.get(tokenKey) ?? 0;
        if (balance <= 0) continue;
        dailyValues.set(dayTs, (dailyValues.get(dayTs) ?? 0) + balance * lastPrice);
      }
    }
  }

  // Native: current balance × forward-filled price (approximation)
  for (const [coinKey, bal] of nativeBalance) {
    const series = priceSeriesByCoinKey.get(coinKey.toLowerCase());
    if (!series) continue;
    let lastPrice: number | null = null;
    for (const dayTs of sortedDayTs) {
      const price = series.get(dayTs);
      if (price != null) lastPrice = price;
      if (lastPrice == null) continue;
      dailyValues.set(dayTs, (dailyValues.get(dayTs) ?? 0) + bal * lastPrice);
    }
  }

  if (dailyValues.size < 2) return [];

  return Array.from(dailyValues.entries())
    .sort(([a], [b]) => a - b)
    .map(([ts, valueUSD]) => ({
      date: new Date(ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      valueUSD,
    }));
}
