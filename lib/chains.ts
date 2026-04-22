import type { Chain } from "@/types/portfolio";

export const SUPPORTED_CHAINS: Chain[] = [
  { id: 1,      hexId: "0x1",      name: "Ethereum",  symbol: "ETH",  color: "#627EEA", explorerUrl: "https://etherscan.io" },
  { id: 8453,   hexId: "0x2105",   name: "Base",      symbol: "ETH",  color: "#0052FF", explorerUrl: "https://basescan.org" },
  { id: 42161,  hexId: "0xa4b1",   name: "Arbitrum",  symbol: "ETH",  color: "#28A0F0", explorerUrl: "https://arbiscan.io" },
  { id: 10,     hexId: "0xa",      name: "Optimism",  symbol: "ETH",  color: "#FF0420", explorerUrl: "https://optimistic.etherscan.io" },
  { id: 56,     hexId: "0x38",     name: "BSC",       symbol: "BNB",  color: "#F0B90B", explorerUrl: "https://bscscan.com" },
  { id: 43114,  hexId: "0xa86a",   name: "Avalanche", symbol: "AVAX", color: "#E84142", explorerUrl: "https://snowtrace.io" },
  { id: 137,    hexId: "0x89",     name: "Polygon",   symbol: "MATIC",color: "#8247E5", explorerUrl: "https://polygonscan.com" },
];

export const CHAIN_BY_ID: Record<number, Chain> = Object.fromEntries(
  SUPPORTED_CHAINS.map((c) => [c.id, c])
);

export const CHAIN_BY_HEX: Record<string, Chain> = Object.fromEntries(
  SUPPORTED_CHAINS.map((c) => [c.hexId, c])
);

export const MORALIS_CHAIN_MAP: Record<number, string> = {
  1:      "0x1",
  8453:   "0x2105",
  42161:  "0xa4b1",
  10:     "0xa",
  56:     "0x38",
  43114:  "0xa86a",
  137:    "0x89",
};

export function getChain(chainId: number): Chain | undefined {
  return CHAIN_BY_ID[chainId];
}

/**
 * Wrapped native token addresses — used to link to the explorer token page
 * for native assets (ETH, BNB, MATIC, etc.) which have no on-chain address.
 */
const WRAPPED_NATIVE: Record<number, string> = {
  1:     "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
  8453:  "0x4200000000000000000000000000000000000006", // WETH on Base
  42161: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", // WETH on Arbitrum
  10:    "0x4200000000000000000000000000000000000006", // WETH on Optimism
  56:    "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", // WBNB
  43114: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", // WAVAX
  137:   "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", // WPOL (ex-WMATIC)
};

/**
 * Returns the block explorer URL for a given address on a chain.
 * For native tokens (address === "native"), links to the wrapped token page
 * as a proxy for the native asset info.
 */
export function getAddressExplorerUrl(chainId: number, address: string): string | null {
  const chain = CHAIN_BY_ID[chainId];
  if (!chain || !address) return null;
  if (address === "native") {
    const wrapped = WRAPPED_NATIVE[chainId];
    return wrapped ? `${chain.explorerUrl}/token/${wrapped}` : chain.explorerUrl;
  }
  return `${chain.explorerUrl}/address/${address}`;
}
