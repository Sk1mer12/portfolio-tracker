// CoinGecko free public API — no key required
// Rate limit: ~10-30 req/min on free tier
const BASE = "https://api.coingecko.com/api/v3";

// Max addresses per CoinGecko simple/token_price request — free tier truncates beyond this
const COINGECKO_BATCH_SIZE = 50;

const NATIVE_TOKEN_IDS: Record<string, string> = {
  ETH:   "ethereum",
  BNB:   "binancecoin",
  AVAX:  "avalanche-2",
  MATIC: "matic-network",
  POL:   "matic-network", // Polygon rebranded MATIC → POL
};

/**
 * Fetch with automatic retry on 429 (rate-limit) responses.
 * Hard 8 s timeout per attempt prevents any single call from hanging forever.
 */
async function cgFetch(url: string, init?: RequestInit, retries = 3): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 429 && retries > 0) {
    const retryAfter = Number(res.headers.get("Retry-After") ?? 0) * 1000 || 2000;
    await new Promise((r) => setTimeout(r, retryAfter));
    return cgFetch(url, init, retries - 1);
  }
  return res;
}

export async function fetchNativePrices(
  symbols: string[]
): Promise<Record<string, number>> {
  const ids = Array.from(new Set(symbols.map((s) => NATIVE_TOKEN_IDS[s]).filter(Boolean)));
  if (ids.length === 0) return {};

  try {
    const res = await cgFetch(
      `${BASE}/simple/price?ids=${ids.join(",")}&vs_currencies=usd`,
      { next: { revalidate: 60 } } as RequestInit
    );
    if (!res.ok) return {};
    const data: Record<string, { usd: number }> = await res.json();

    const result: Record<string, number> = {};
    for (const [symbol, id] of Object.entries(NATIVE_TOKEN_IDS)) {
      if (data[id]) result[symbol] = data[id].usd;
    }
    return result;
  } catch {
    return {};
  }
}

export async function fetchTokenPricesByAddress(
  platform: string,
  addresses: string[]
): Promise<Record<string, number>> {
  if (addresses.length === 0) return {};

  // Split into chunks to stay within CoinGecko's per-request address limit
  const chunks: string[][] = [];
  for (let i = 0; i < addresses.length; i += COINGECKO_BATCH_SIZE) {
    chunks.push(addresses.slice(i, i + COINGECKO_BATCH_SIZE));
  }

  const merged: Record<string, number> = {};

  for (const chunk of chunks) {
    try {
      const res = await cgFetch(
        `${BASE}/simple/token_price/${platform}?contract_addresses=${chunk.join(",")}&vs_currencies=usd`,
        { next: { revalidate: 60 } } as RequestInit
      );
      if (!res.ok) continue;
      const data: Record<string, { usd: number }> = await res.json();
      for (const [addr, val] of Object.entries(data)) {
        if (val?.usd != null) merged[addr.toLowerCase()] = val.usd;
      }
    } catch {
      // chunk failed — continue with remaining chunks
    }
  }

  return merged;
}

/**
 * Fetch logo URLs for tokens that Moralis left without one.
 * - ERC-20s:     GET /coins/{platform}/contract/{address}  → image.small
 * - Native tokens: GET /coins/{coinGeckoId}               → image.small
 *
 * Requests fire in parallel — logos are cosmetic so we skip rather than retry on
 * rate-limit errors. Each call has a 5 s hard timeout so a slow CoinGecko response
 * never blocks the API route.
 *
 * Returns a map keyed by `${chainId}:${address}` (native tokens use "native" as address).
 */
export async function fetchTokenLogos(
  tokens: { address: string; chainId: number; symbol: string; isNative?: boolean }[]
): Promise<Map<string, string>> {
  const logoMap = new Map<string, string>();
  if (tokens.length === 0) return logoMap;

  await Promise.allSettled(
    tokens.map(async (token) => {
      const key = `${token.chainId}:${token.isNative ? "native" : token.address.toLowerCase()}`;

      let url: string;
      if (token.isNative) {
        const coinId = NATIVE_TOKEN_IDS[token.symbol];
        if (!coinId) return;
        url = `${BASE}/coins/${coinId}`;
      } else {
        const platform = COINGECKO_PLATFORM[token.chainId];
        if (!platform) return;
        url = `${BASE}/coins/${platform}/contract/${token.address.toLowerCase()}`;
      }

      try {
        // No retry — logos are cosmetic; a 5 s timeout prevents hanging
        const res = await fetch(url, {
          signal: AbortSignal.timeout(5000),
          next: { revalidate: 3600 },
        } as RequestInit);
        if (!res.ok) return;

        const data = await res.json();
        const logoUrl: string | undefined = data?.image?.small ?? data?.image?.thumb;
        if (logoUrl) logoMap.set(key, logoUrl);
      } catch {
        // Not in CoinGecko, rate-limited, or timed out — skip silently
      }
    })
  );

  return logoMap;
}

// Map chainId → CoinGecko platform ID
export const COINGECKO_PLATFORM: Record<number, string> = {
  1:      "ethereum",
  8453:   "base",
  42161:  "arbitrum-one",
  10:     "optimistic-ethereum",
  56:     "binance-smart-chain",
  43114:  "avalanche",
  137:    "polygon-pos",
};
