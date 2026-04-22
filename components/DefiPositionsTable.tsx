"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CHAIN_BY_ID, getAddressExplorerUrl } from "@/lib/chains";
import { formatUSD, formatPct, formatDaysHeld, yieldColor, shortenAddress } from "@/lib/format";
import type { DefiPosition } from "@/types/portfolio";

interface Props {
  positions: DefiPosition[];
  totalValueUSD: number;
  walletColorMap?: Map<string, { text: string; dot: string }>;
  isLoading?: boolean;
  isEnriching?: boolean;
}

const SKELETON_ROWS = 4;

function DefiSkeletonRow() {
  return (
    <tr className="border-b border-gray-800/50">
      <td className="px-4 py-3 w-4">
        <div className="h-3 w-3 rounded bg-gray-800 animate-pulse" />
      </td>
      <td className="px-4 py-3">
        <div className="space-y-1.5">
          <div className="h-3 w-28 rounded bg-gray-800 animate-pulse" />
          <div className="h-2.5 w-16 rounded bg-gray-800 animate-pulse" />
        </div>
      </td>
      <td className="px-4 py-3 hidden md:table-cell">
        <div className="h-3 w-14 rounded bg-gray-800 animate-pulse ml-auto" />
      </td>
      <td className="px-4 py-3">
        <div className="h-3 w-14 rounded bg-gray-800 animate-pulse ml-auto" />
      </td>
      <td className="px-4 py-3">
        <div className="space-y-1.5 flex flex-col items-end">
          <div className="h-3 w-12 rounded bg-gray-800 animate-pulse" />
          <div className="h-2.5 w-10 rounded bg-gray-800 animate-pulse" />
        </div>
      </td>
      <td className="px-4 py-3 hidden lg:table-cell">
        <div className="h-3 w-10 rounded bg-gray-800 animate-pulse ml-auto" />
      </td>
      <td className="px-4 py-3 hidden xl:table-cell">
        <div className="h-3 w-8 rounded bg-gray-800 animate-pulse ml-auto" />
      </td>
      <td className="px-4 py-3 hidden xl:table-cell">
        <div className="h-3 w-10 rounded bg-gray-800 animate-pulse ml-auto" />
      </td>
    </tr>
  );
}

export function DefiPositionsTable({ positions: allPositions, totalValueUSD, walletColorMap, isLoading, isEnriching }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const positions = allPositions.filter((p) => (p.currentValueUSD ?? 0) >= 0.1);

  if (!isLoading && positions.length === 0) {
    return (
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-200">DeFi Positions</h2>
        <div className="rounded-xl border border-gray-800 bg-gray-900/30 px-4 py-10 text-center text-sm text-gray-500">
          No DeFi positions found across selected chains
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-gray-200">
          DeFi Positions
          {!isLoading && <span className="text-gray-500 font-normal ml-1">({positions.length})</span>}
        </h2>
        {isEnriching && (
          <span className="text-xs text-gray-500 animate-pulse">computing yield…</span>
        )}
      </div>

      <div className="rounded-xl border border-gray-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 bg-gray-900/50">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-4" />
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Protocol</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 hidden md:table-cell">Deposited</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Current</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Yield</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 hidden lg:table-cell">APY</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 hidden xl:table-cell">Held</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 hidden xl:table-cell">Portfolio %</th>
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: SKELETON_ROWS }).map((_, i) => <DefiSkeletonRow key={i} />)
              : positions.map((pos, i) => {
              const key = `${pos.chainId}-${pos.protocol}-${i}`;
              const chainInfo = CHAIN_BY_ID[pos.chainId];
              const isOpen = expanded === key;
              const walletColor = pos.walletAddress
                ? walletColorMap?.get(pos.walletAddress.toLowerCase())
                : undefined;
              const totalApr = (pos.apy ?? 0) + (pos.incentiveApr ?? 0);
              const hasIncentive = pos.incentiveApr != null && pos.incentiveApr > 0;
              const hasUnclaimed = pos.unclaimedRewards?.length > 0;
              const totalUnclaimedUSD = pos.unclaimedRewards?.reduce(
                (s, r) => s + (r.usdValue ?? 0), 0
              ) ?? 0;
              const pct = totalValueUSD > 0 ? ((pos.currentValueUSD ?? 0) / totalValueUSD) * 100 : 0;
              const explorerUrl = getAddressExplorerUrl(pos.chainId, pos.protocolId);

              return (
                <>
                  <tr
                    key={key}
                    className="group border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors cursor-pointer"
                    onClick={() => setExpanded(isOpen ? null : key)}
                  >
                    <td className="px-4 py-3 text-gray-500">
                      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <p className="font-medium text-gray-100">{pos.protocol}</p>
                            {explorerUrl && (
                              <a
                                href={explorerUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-500 hover:text-blue-400"
                              >
                                <ExternalLink size={11} />
                              </a>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <p className="text-xs text-gray-500 capitalize">{pos.positionType}</p>
                            {hasUnclaimed && (
                              <span className="text-xs text-amber-400 font-medium">
                                +{formatUSD(totalUnclaimedUSD)} claimable
                              </span>
                            )}
                          </div>
                        </div>
                        <Badge color={chainInfo?.color} className="hidden sm:inline-flex">
                          {chainInfo?.name ?? pos.chain}
                        </Badge>
                        {walletColor && (
                          <span className={`hidden sm:inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-mono ${walletColor.text}`}>
                            <span className={`inline-block h-1.5 w-1.5 rounded-full ${walletColor.dot}`} />
                            {pos.walletAddress!.slice(-6)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-400 hidden md:table-cell">
                      {isEnriching && pos.depositedValueUSD == null ? (
                        <div className="h-3 w-14 rounded bg-gray-800 animate-pulse ml-auto" />
                      ) : (
                        formatUSD(pos.depositedValueUSD)
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-100">
                      {formatUSD(pos.currentValueUSD)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isEnriching && pos.yieldUSD == null ? (
                        <div className="space-y-1.5 flex flex-col items-end">
                          <div className="h-3 w-12 rounded bg-gray-800 animate-pulse" />
                          <div className="h-2.5 w-9 rounded bg-gray-800 animate-pulse" />
                        </div>
                      ) : (
                        <div>
                          <p className={`font-medium ${yieldColor(pos.yieldUSD)}`}>
                            {formatUSD(pos.yieldUSD)}
                          </p>
                          <p className={`text-xs ${yieldColor(pos.yieldPct)}`}>
                            {formatPct(pos.yieldPct)}
                          </p>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right hidden lg:table-cell">
                      {isEnriching && pos.apy == null && !hasIncentive ? (
                        <div className="h-3 w-14 rounded bg-gray-800 animate-pulse ml-auto" />
                      ) : pos.apy != null || hasIncentive ? (
                        <div>
                          <p className={`text-sm font-medium ${yieldColor(totalApr)}`}>
                            {formatPct(totalApr)} APY
                          </p>
                          <p className={`text-xs ${yieldColor(pos.yieldPct)}`}>
                            {formatPct(pos.yieldPct)} earned
                          </p>
                        </div>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-400 text-xs hidden xl:table-cell">
                      {formatDaysHeld(pos.daysHeld)}
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
                  {isOpen && (
                    <tr key={`${key}-detail`} className="bg-gray-900/50 border-b border-gray-800/50">
                      <td colSpan={8} className="px-6 py-4">
                        <div className="space-y-4">
                          {/* Stats grid */}
                          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-xs md:grid-cols-3 lg:grid-cols-5">
                            <div>
                              <p className="text-gray-500">Deposit Date</p>
                              <p className="text-gray-200">
                                {pos.depositDate
                                  ? new Date(pos.depositDate).toLocaleDateString()
                                  : "—"}
                              </p>
                            </div>
                            <div>
                              <p className="text-gray-500">Days Held</p>
                              <p className="text-gray-200">{formatDaysHeld(pos.daysHeld)}</p>
                            </div>
                            <div>
                              <p className="text-gray-500">Net Value</p>
                              <p className={yieldColor(pos.yieldUSD)}>{formatUSD(pos.yieldUSD)}</p>
                            </div>
                            <div>
                              <p className="text-gray-500">Base APY</p>
                              <p className={yieldColor(pos.apy)}>
                                {pos.apy != null ? formatPct(pos.apy) : "—"}
                              </p>
                            </div>
                            <div>
                              <p className="text-gray-500">Earned so far</p>
                              <p className={yieldColor(pos.yieldPct)}>
                                {pos.yieldPct != null ? formatPct(pos.yieldPct) : "—"}
                              </p>
                            </div>
                          </div>

                          {/* Merkl incentives */}
                          {hasIncentive && (
                            <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 px-4 py-3 text-xs space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-amber-400 font-medium">Merkl Incentives</span>
                                <span className="text-amber-300 font-semibold">
                                  +{formatPct(pos.incentiveApr)} incentive APR
                                </span>
                              </div>
                              <div className="flex items-center justify-between text-gray-400">
                                <span>Total APY (base + incentive)</span>
                                <span className={`font-semibold ${yieldColor(totalApr)}`}>
                                  {formatPct(totalApr)}
                                </span>
                              </div>
                            </div>
                          )}

                          {/* Unclaimed rewards */}
                          {hasUnclaimed && (
                            <div>
                              <p className="text-xs text-amber-400 font-medium mb-2">
                                Claimable Rewards
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {pos.unclaimedRewards.map((r, ri) => (
                                  <div
                                    key={ri}
                                    className="flex items-center gap-1.5 rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-1.5 text-xs"
                                  >
                                    <span className="text-amber-300 font-medium">{r.symbol}</span>
                                    <span className="text-gray-400">{formatNumber(r.amount, 4)}</span>
                                    {r.usdValue != null && (
                                      <span className="text-gray-500">{formatUSD(r.usdValue)}</span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Underlying tokens */}
                          {pos.tokens.length > 0 && (
                            <div>
                              <p className="text-xs text-gray-500 mb-2">Underlying Tokens</p>
                              <div className="flex flex-wrap gap-2">
                                {pos.tokens.map((t, ti) => (
                                  <div
                                    key={ti}
                                    className="flex items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs"
                                  >
                                    {t.logo && (
                                      <img src={t.logo} alt={t.symbol} className="h-4 w-4 rounded-full" />
                                    )}
                                    <span className="text-gray-300">{t.symbol}</span>
                                    <span className="text-gray-500">{formatNumber(t.amount, 4)}</span>
                                    {t.usdValue != null && (
                                      <span className="text-gray-400">{formatUSD(t.usdValue)}</span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatNumber(v: number, d: number) {
  if (!v) return "0";
  return v.toLocaleString("en-US", { maximumFractionDigits: d });
}
