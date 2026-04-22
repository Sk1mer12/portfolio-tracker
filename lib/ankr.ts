// Ankr Advanced API — free, no key required
// Docs: https://www.ankr.com/docs/advanced-api/token-methods/#ankr_getaccountbalance
import { SUPPORTED_CHAINS } from "./chains";
import type { TokenBalance, DefiPosition } from "@/types/portfolio";

// Free key: sign up at https://app.ankr.com → Projects → Create project → copy token
function ankrEndpoint() {
  const key = process.env.ANKR_API_KEY;
  return key ? `https://rpc.ankr.com/multichain/${key}` : "https://rpc.ankr.com/multichain";
}

// Map chainId → Ankr blockchain name
const ANKR_CHAIN: Record<number, string> = {
  1:      "eth",
  8453:   "base",
  42161:  "arbitrum",
  10:     "optimism",
  56:     "bsc",
  43114:  "avalanche",
  137:    "polygon",
};

interface AnkrAsset {
  blockchain: string;
  tokenName: string;
  tokenSymbol: string;
  tokenDecimals: string;
  tokenType: "NATIVE" | "ERC20";
  contractAddress: string;
  holderAddress: string;
  balance: string;           // human-readable (e.g. "1.5")
  balanceRawInteger: string; // raw integer string
  balanceUsd: string;
  tokenPrice: string;
  thumbnail: string;
}

interface AnkrResponse {
  result?: {
    assets: AnkrAsset[];
    nextPageToken?: string;
    totalBalanceUsd?: string;
  };
  error?: { message: string };
}

// Reverse map: Ankr chain name → chainId
const ANKR_CHAIN_TO_ID: Record<string, number> = Object.fromEntries(
  Object.entries(ANKR_CHAIN).map(([id, name]) => [name, Number(id)])
);

export async function fetchTokenBalances(
  address: string,
  chainIds: number[] = SUPPORTED_CHAINS.map((c) => c.id)
): Promise<TokenBalance[]> {
  const blockchains = chainIds
    .map((id) => ANKR_CHAIN[id])
    .filter(Boolean);

  if (blockchains.length === 0) return [];

  const results: TokenBalance[] = [];
  let pageToken: string | undefined;

  try {
    do {
      const body = {
        jsonrpc: "2.0",
        method: "ankr_getAccountBalance",
        params: {
          walletAddress: address,
          blockchain: blockchains,
          onlyWhitelisted: false,
          pageSize: 50,
          ...(pageToken ? { pageToken } : {}),
        },
        id: 1,
      };

      const res = await fetch(ankrEndpoint(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
        next: { revalidate: 0 },
      } as RequestInit);

      if (!res.ok) break;

      const data: AnkrResponse = await res.json();
      if (data.error || !data.result) break;

      const chainInfo = SUPPORTED_CHAINS.reduce<Record<string, (typeof SUPPORTED_CHAINS)[0]>>(
        (acc, c) => { acc[c.id] = c; return acc; },
        {}
      );

      for (const asset of data.result.assets) {
        const chainId = ANKR_CHAIN_TO_ID[asset.blockchain];
        if (!chainId) continue;

        const balanceFormatted = parseFloat(asset.balance);
        if (!balanceFormatted || balanceFormatted <= 0) continue;

        const isNative = asset.tokenType === "NATIVE";
        const rawPrice = parseFloat(asset.tokenPrice);
        const rawValue = parseFloat(asset.balanceUsd);

        const chain = chainInfo[chainId];

        results.push({
          address: isNative ? "native" : asset.contractAddress.toLowerCase(),
          name: asset.tokenName || (isNative ? chain?.name ?? asset.blockchain : "Unknown"),
          symbol: asset.tokenSymbol || "?",
          decimals: parseInt(asset.tokenDecimals) || 18,
          balance: asset.balanceRawInteger || "0",
          balanceFormatted,
          usdPrice: rawPrice > 0 ? rawPrice : null,
          usdValue: rawValue > 0 ? rawValue : null,
          logo: asset.thumbnail || null,
          chain: chain?.name ?? asset.blockchain,
          chainId,
          isNative,
        });
      }

      pageToken = data.result.nextPageToken || undefined;
    } while (pageToken);
  } catch {
    // Network error or timeout — return whatever we collected so far
  }

  return results;
}

// Non-vault DeFi positions are not available from Ankr.
// ERC-4626 vault positions are detected on-chain in the main route (Layer 5)
// and pushed into defiPositions[] there.
export async function fetchDefiPositions(
  _address: string,
  _chainIds: number[]
): Promise<DefiPosition[]> {
  return [];
}
