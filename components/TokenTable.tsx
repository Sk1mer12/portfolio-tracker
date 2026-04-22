"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CHAIN_BY_ID, getAddressExplorerUrl } from "@/lib/chains";
import { formatUSD, formatNumber, yieldColor } from "@/lib/format";
import type { TokenBalance } from "@/types/portfolio";

interface Props {
  tokens: TokenBalance[];
  totalValueUSD: number;
  walletColorMap?: Map<string, { text: string; dot: string }>;
  isLoading?: boolean;
  isEnriching?: boolean;
}

const DUST_THRESHOLD = 0.0001;
const SKELETON_ROWS = 6;

function TokenSkeletonRow() {
  return (
    <tr className="border-b border-gray-800/50">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 shrink-0 rounded-full bg-gray-800 animate-pulse" />
          <div className="space-y-1.5">
            <div className="h-3 w-14 rounded bg-gray-800 animate-pulse" />
            <div className="h-2.5 w-20 rounded bg-gray-800 animate-pulse" />
          </div>
        </div>
      </td>
      <td className="px-4 py-3 hidden sm:table-cell">
        <div className="h-3 w-16 rounded bg-gray-800 animate-pulse ml-auto" />
      </td>
      <td className="px-4 py-3 hidden md:table-cell">
        <div className="h-3 w-12 rounded bg-gray-800 animate-pulse ml-auto" />
      </td>
      <td className="px-4 py-3">
        <div className="h-3 w-14 rounded bg-gray-800 animate-pulse ml-auto" />
      </td>
      <td className="px-4 py-3 hidden lg:table-cell">
        <div className="space-y-1.5 flex flex-col items-end">
          <div className="h-2.5 w-16 rounded bg-gray-800 animate-pulse" />
          <div className="h-2.5 w-12 rounded bg-gray-800 animate-pulse" />
        </div>
      </td>
      <td className="px-4 py-3 hidden xl:table-cell">
        <div className="h-3 w-10 rounded bg-gray-800 animate-pulse ml-auto" />
      </td>
    </tr>
  );
}

export function TokenTable({ tokens, totalValueUSD, walletColorMap, isLoading, isEnriching }: Props) {
  const [sortBy, setSortBy] = useState<"value" | "balance">("value");
  const [hideDust, setHideDust] = useState(true);
  const dustCount = tokens.filter((t) => (t.usdValue ?? 0) < DUST_THRESHOLD).length;

  const sorted = [...tokens]
    .filter((t) => !hideDust || (t.usdValue ?? 0) >= DUST_THRESHOLD)
    .sort((a, b) =>
      sortBy === "value"
        ? (b.usdValue ?? 0) - (a.usdValue ?? 0)
        : b.balanceFormatted - a.balanceFormatted
    );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-200">Token Holdings</h2>
          {isEnriching && (
            <span className="text-xs text-gray-500 animate-pulse">computing P&amp;L…</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {dustCount > 0 && (
            <button
              onClick={() => setHideDust((v) => !v)}
              className={`rounded px-2 py-0.5 text-xs transition-colors ${
                hideDust
                  ? "bg-red-900/60 text-red-300 hover:bg-red-900/40"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {hideDust ? `Showing ${dustCount} hidden` : `Hide ${dustCount} dust`}
            </button>
          )}
          <div className="flex gap-1">
            {(["value", "balance"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSortBy(s)}
                className={`rounded px-2 py-0.5 text-xs transition-colors ${
                  sortBy === s ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {s === "value" ? "By Value" : "By Balance"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 bg-gray-900/50">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Token</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 hidden sm:table-cell">Balance</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 hidden md:table-cell">Price</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Value</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 hidden lg:table-cell">P&amp;L</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 hidden xl:table-cell">Portfolio %</th>
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: SKELETON_ROWS }).map((_, i) => <TokenSkeletonRow key={i} />)
              : sorted.length === 0
              ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500 text-sm">
                    No tokens found
                  </td>
                </tr>
              )
              : sorted.map((token, i) => {
                  const chainInfo   = CHAIN_BY_ID[token.chainId];
                  const pct         = totalValueUSD > 0 ? ((token.usdValue ?? 0) / totalValueUSD) * 100 : 0;
                  const explorerUrl = getAddressExplorerUrl(token.chainId, token.address);
                  const walletColor = token.walletAddress
                    ? walletColorMap?.get(token.walletAddress.toLowerCase())
                    : undefined;

                  return (
                    <tr
                      key={`${token.chainId}-${token.address}-${i}`}
                      className="group border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          {token.logo ? (
                            <img src={token.logo} alt={token.symbol} className="h-7 w-7 rounded-full" />
                          ) : (
                            <div className="h-7 w-7 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-400">
                              {token.symbol.slice(0, 2)}
                            </div>
                          )}
                          <div>
                            <div className="flex items-center gap-1.5">
                              <p className="font-medium text-gray-100">{token.symbol}</p>
                              {explorerUrl && (
                                <a
                                  href={explorerUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-500 hover:text-blue-400"
                                >
                                  <ExternalLink size={11} />
                                </a>
                              )}
                            </div>
                            <p className="text-xs text-gray-500">{token.name}</p>
                          </div>
                          <Badge color={chainInfo?.color} className="ml-1 hidden sm:inline-flex">
                            {chainInfo?.name ?? token.chain}
                          </Badge>
                          {walletColor && (
                            <span className={`hidden sm:inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-mono ${walletColor.text}`}>
                              <span className={`inline-block h-1.5 w-1.5 rounded-full ${walletColor.dot}`} />
                              {token.walletAddress!.slice(-6)}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-300 hidden sm:table-cell font-mono text-xs">
                        {formatNumber(token.balanceFormatted, 4)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-400 hidden md:table-cell text-xs">
                        {token.usdPrice != null ? formatUSD(token.usdPrice) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-gray-100">
                        {formatUSD(token.usdValue)}
                      </td>
                      <td className="px-4 py-3 text-right hidden lg:table-cell">
                        {token.avgCostPerToken != null && token.unrealizedPnlUSD != null ? (
                          <div>
                            <p className="text-xs text-gray-500">avg {formatUSD(token.avgCostPerToken)}</p>
                            <p className={`text-xs font-medium ${yieldColor(token.unrealizedPnlUSD)}`}>
                              {token.unrealizedPnlUSD >= 0 ? "+" : ""}
                              {formatUSD(token.unrealizedPnlUSD)}
                              {token.unrealizedPnlPct != null && (
                                <span className="ml-1 opacity-75">
                                  ({token.unrealizedPnlPct >= 0 ? "+" : ""}
                                  {token.unrealizedPnlPct.toFixed(1)}%)
                                </span>
                              )}
                            </p>
                          </div>
                        ) : isEnriching ? (
                          <div className="flex justify-end">
                            <div className="h-2 w-12 rounded bg-gray-800 animate-pulse" />
                          </div>
                        ) : (
                          <span className="text-xs text-gray-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-400 hidden xl:table-cell text-xs">
                        <div className="flex items-center justify-end gap-2">
                          <div className="h-1.5 w-16 rounded-full bg-gray-800 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-indigo-500"
                              style={{ width: `${Math.min(pct, 100)}%` }}
                            />
                          </div>
                          {pct.toFixed(1)}%
                        </div>
                      </td>
                    </tr>
                  );
                })
            }
          </tbody>
        </table>
      </div>
    </div>
  );
}
