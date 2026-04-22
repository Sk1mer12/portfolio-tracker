# Portfolio Tracker

## Purpose
Web3 portfolio tracker that aggregates crypto token holdings and DeFi positions
across 7 EVM chains, enriches them with live USD prices, and displays yield metrics.

## Tech Stack
- **Framework**: Next.js 14 (App Router), React 18, TypeScript 5
- **Web3**: wagmi 2, viem 2, RainbowKit 2 (wallet connection)
- **Data**: Moralis API (balances + DeFi positions), CoinGecko free API (prices)
- **State**: TanStack Query 5 (server state), React `useState`/`useCallback` (local)
- **UI**: Tailwind CSS 3, Radix UI primitives, Recharts, lucide-react

## Project Structure
```
app/
  api/portfolio/[address]/   # Main orchestration route — fetches + enriches data
  api/tokens/[address]/      # Token balances only
  api/defi/[address]/        # DeFi positions only
  portfolio/[address]/       # Dashboard page (server shell → client component)
  page.tsx                   # Landing: wallet connect + manual address input
components/
  PortfolioDashboard.tsx     # Container: state, fetch, layout
  TokenTable.tsx             # Presentational: sortable token holdings
  DefiPositionsTable.tsx     # Presentational: expandable DeFi positions
  PortfolioChart.tsx         # Recharts line chart (historical value — placeholder)
  ChainSelector.tsx          # Chain filter toggle buttons
  ui/                        # Primitives: Button, Card, Badge, Skeleton
lib/
  moralis.ts                 # fetchTokenBalances(), fetchDefiPositions()
  coingecko.ts               # fetchNativePrices(), fetchTokenPricesByAddress()
  chains.ts                  # SUPPORTED_CHAINS, MORALIS_CHAIN_MAP config
  yield.ts                   # calcYield(), aggregateYield()
  format.ts                  # formatUSD(), formatPct(), shortenAddress(), yieldColor()
providers/
  AppProviders.tsx           # Wagmi + RainbowKit + TanStack Query setup (SSR-safe)
types/
  portfolio.ts               # All core interfaces: Chain, TokenBalance, DefiPosition, PortfolioData
```

## Commands
```bash
npm run dev      # Dev server at localhost:3000
npm run build    # Production build
npm start        # Run production server
npm run lint     # ESLint via next lint
```

## Environment Variables
| Variable | Purpose |
|---|---|
| `MORALIS_API_KEY` | Moralis API auth (server-only) |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | RainbowKit WalletConnect (public) |

## Key Entry Points
- Data flow starts at `app/api/portfolio/[address]/route.ts:8`
- UI entry point: `components/PortfolioDashboard.tsx:21`
- Chain config: `lib/chains.ts`
- All TypeScript types: `types/portfolio.ts`

## Additional Documentation
- [Architectural Patterns](.claude/docs/architectural_patterns.md) — data flow,
  parallel fetching, price enrichment layers, container/presentational split,
  per-chain error isolation
