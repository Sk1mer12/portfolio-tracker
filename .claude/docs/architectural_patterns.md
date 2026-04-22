# Architectural Patterns

## 1. Container / Presentational Split
`PortfolioDashboard` (container) owns all state and data fetching; `TokenTable`,
`DefiPositionsTable`, `ChainSelector`, `PortfolioHeader`, and `SummaryCards` are
pure presentational components that receive typed props and emit callbacks.

- Container: `components/PortfolioDashboard.tsx:21`
- Presentational examples: `components/TokenTable.tsx`, `components/DefiPositionsTable.tsx`

## 2. Parallel Fetch with Per-Chain Error Isolation
Both `fetchTokenBalances` and `fetchDefiPositions` iterate over all requested
chains inside `Promise.allSettled()`. A failure on one chain (e.g. Moralis has no
data for that chain) is caught silently and does not block the other chains.

- `lib/moralis.ts:28` — token balances per chain
- `lib/moralis.ts:102` — DeFi positions per chain

## 3. Multi-Layer Price Enrichment
Prices are filled in three sequential passes, each filling gaps left by the previous:

1. **Moralis** — returns `usd_price` inline for ERC-20 tokens when available
2. **CoinGecko native prices** — fills `usdPrice` for native tokens (ETH, BNB, AVAX, MATIC)
   via `fetchNativePrices()` (`lib/coingecko.ts:12`)
3. **CoinGecko ERC-20 prices** — groups un-priced ERC-20s by chain, fetches by
   contract address via `fetchTokenPricesByAddress()` (`lib/coingecko.ts:36`);
   run in parallel across chains with `Promise.allSettled()`

Enrichment orchestrated in: `app/api/portfolio/[address]/route.ts:26–63`

## 4. API Route Orchestration
The main `/api/portfolio/[address]` route composes the three smaller concerns
(Moralis fetch, price enrichment, yield aggregation) rather than doing them inline
in the component. Smaller isolated routes (`/api/tokens`, `/api/defi`) exist for
direct access to sub-data.

- `app/api/portfolio/[address]/route.ts`
- `app/api/tokens/[address]/route.ts`
- `app/api/defi/[address]/route.ts`

## 5. Provider Composition
All global providers (Wagmi, RainbowKit, TanStack Query) are composed into a single
`AppProviders` wrapper with SSR-safe hydration handling. Pages and components never
import provider config directly.

- `providers/AppProviders.tsx`
- Consumed in: `app/layout.tsx`

## 6. Centralized Type Definitions
All domain interfaces (`Chain`, `TokenBalance`, `DefiPosition`, `PortfolioData`,
`PositionToken`, `PortfolioChartPoint`) live in a single file. No inline type
definitions in component or lib files.

- `types/portfolio.ts`

## 7. Fail-Safe Data Fetching
External API calls (`fetchNativePrices`, `fetchTokenPricesByAddress`) catch all
errors and return empty objects rather than throwing, so a CoinGecko outage
degrades gracefully (prices show as null, values show as "—") without crashing
the route.

- `lib/coingecko.ts:31` (native prices catch)
- `lib/coingecko.ts:52` (ERC-20 prices catch)
- Same pattern in `lib/moralis.ts:85`, `lib/moralis.ts:165`
