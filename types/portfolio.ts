export interface Chain {
  id: number;
  hexId: string;
  name: string;
  symbol: string;
  color: string;
  explorerUrl: string;
}

export interface TokenBalance {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  balance: string;
  balanceFormatted: number;
  usdPrice: number | null;
  usdValue: number | null;
  logo: string | null;
  chain: string;
  chainId: number;
  isNative?: boolean;
  walletAddress?: string; // set when aggregating a bundle of wallets
  // Cost basis & unrealized P&L (populated server-side when transfer history is available)
  avgCostPerToken?: number | null;
  unrealizedPnlUSD?: number | null;
  unrealizedPnlPct?: number | null;
}

export interface UnclaimedReward {
  tokenAddress: string;
  symbol: string;
  decimals: number;
  amount: number;       // human-readable float
  usdValue: number | null;
}

export interface DefiPosition {
  protocol: string;
  protocolId: string;
  chain: string;
  chainId: number;
  positionType: string; // "liquidity-pool" | "lending" | "staking" | "farming" | etc.
  label: string;

  // Values
  depositedValueUSD: number | null;
  currentValueUSD: number | null;
  yieldUSD: number | null;
  yieldPct: number | null;
  apy: number | null;

  // Merkl incentives
  incentiveApr: number | null;
  unclaimedRewards: UnclaimedReward[];

  // Underlying tokens
  tokens: PositionToken[];

  // Dates
  depositDate: string | null; // ISO string
  daysHeld: number | null;

  // Raw data
  rawData?: unknown;

  walletAddress?: string; // set when aggregating a bundle of wallets
}

export interface PositionToken {
  symbol: string;
  name: string;
  address: string;
  logo: string | null;
  amount: number;
  usdValue: number | null;
  type: "deposit" | "borrow" | "reward" | "underlying";
}

export interface PortfolioData {
  address: string;
  totalValueUSD: number;
  tokensValueUSD: number;
  defiValueUSD: number;
  totalYieldUSD: number;
  totalYieldPct: number | null;
  tokens: TokenBalance[];
  defiPositions: DefiPosition[];
  chains: string[];
  chartData: PortfolioChartPoint[];
  fetchedAt: string;
  /**
   * false when the response was returned in "fast" mode — vault deposit info
   * (APY, deposit date, yield) and token cost basis (P&L) are not yet populated.
   * The client will fire a second request to fill them in.
   */
  enriched: boolean;
}

export interface PortfolioChartPoint {
  date: string;
  valueUSD: number;
}
