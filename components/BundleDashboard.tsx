"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, RefreshCw, Layers, Plus, X } from "lucide-react";
import { isAddress } from "viem";
import { Button } from "@/components/ui/button";
import { SummaryCards } from "@/components/SummaryCards";
import { TokenTable } from "@/components/TokenTable";
import { DefiPositionsTable } from "@/components/DefiPositionsTable";
import { PortfolioChart } from "@/components/PortfolioChart";
import { ChainSelector } from "@/components/ChainSelector";
import { SUPPORTED_CHAINS } from "@/lib/chains";
import { formatUSD, shortenAddress } from "@/lib/format";
import type { PortfolioData, PortfolioChartPoint } from "@/types/portfolio";

interface Props {
  addresses: string[];
}

const WALLET_COLORS = [
  { bg: "bg-violet-900/40", text: "text-violet-300", border: "border-violet-700/40", dot: "bg-violet-400" },
  { bg: "bg-cyan-900/40",   text: "text-cyan-300",   border: "border-cyan-700/40",   dot: "bg-cyan-400"   },
  { bg: "bg-rose-900/40",   text: "text-rose-300",   border: "border-rose-700/40",   dot: "bg-rose-400"   },
  { bg: "bg-amber-900/40",  text: "text-amber-300",  border: "border-amber-700/40",  dot: "bg-amber-400"  },
  { bg: "bg-emerald-900/40",text: "text-emerald-300",border: "border-emerald-700/40",dot: "bg-emerald-400"},
  { bg: "bg-sky-900/40",    text: "text-sky-300",    border: "border-sky-700/40",    dot: "bg-sky-400"    },
];

const PROGRESS_STEPS: [number, number][] = [
  [200,   15],
  [600,   35],
  [2000,  60],
  [5000,  75],
  [9000,  83],
  [15000, 89],
  [25000, 93],
];

function mergePortfolios(portfolios: PortfolioData[], selectedWallets: string[]) {
  const filtered = portfolios.filter((p) => selectedWallets.includes(p.address.toLowerCase()));
  if (filtered.length === 0) return null;

  const totalValueUSD   = filtered.reduce((s, p) => s + p.totalValueUSD, 0);
  const tokensValueUSD  = filtered.reduce((s, p) => s + p.tokensValueUSD, 0);
  const defiValueUSD    = filtered.reduce((s, p) => s + p.defiValueUSD, 0);
  const totalYieldUSD   = filtered.reduce((s, p) => s + p.totalYieldUSD, 0);
  const totalDeposited  = filtered.reduce(
    (s, p) => s + p.defiPositions.reduce((ds, d) => ds + (d.depositedValueUSD ?? 0), 0),
    0
  );
  const totalYieldPct = totalDeposited > 0 ? (totalYieldUSD / totalDeposited) * 100 : null;

  // Merge chart data by date (sum across wallets)
  const chartMap = new Map<string, number>();
  for (const p of filtered) {
    for (const pt of p.chartData) {
      chartMap.set(pt.date, (chartMap.get(pt.date) ?? 0) + pt.valueUSD);
    }
  }
  const chartData: PortfolioChartPoint[] = Array.from(chartMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, valueUSD]) => ({ date, valueUSD }));

  const chains = [...new Set(filtered.flatMap((p) => p.chains))];
  const tokens = filtered.flatMap((p) =>
    p.tokens.map((t) => ({ ...t, walletAddress: p.address }))
  );
  const defiPositions = filtered.flatMap((p) =>
    p.defiPositions.map((d) => ({ ...d, walletAddress: p.address }))
  );

  return {
    address:        "bundle",
    totalValueUSD,
    tokensValueUSD,
    defiValueUSD,
    totalYieldUSD,
    totalYieldPct,
    tokens,
    defiPositions,
    chains,
    chartData,
    fetchedAt: new Date().toISOString(),
    enriched: portfolios.every((p) => p.enriched),
  } satisfies PortfolioData;
}

export function BundleDashboard({ addresses }: Props) {
  const router = useRouter();
  const [selectedChains, setSelectedChains] = useState<number[]>(
    SUPPORTED_CHAINS.map((c) => c.id)
  );
  const [portfolios, setPortfolios] = useState<Map<string, PortfolioData>>(new Map());
  const [fetchErrors, setFetchErrors] = useState<Map<string, string>>(new Map());
  const [phase, setPhase] = useState<"loading" | "enriching" | "done">("loading");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [progress, setProgress] = useState(0);
  const [selectedWallets, setSelectedWallets] = useState<string[]>(
    addresses.map((a) => a.toLowerCase())
  );
  const [addingWallet, setAddingWallet] = useState(false);
  const [addInput, setAddInput] = useState("");
  const [addError, setAddError] = useState("");
  const addInputRef = useRef<HTMLInputElement>(null);

  // Stable color map: address → color palette entry
  const colorMap = new Map(
    addresses.map((addr, i) => [
      addr.toLowerCase(),
      WALLET_COLORS[i % WALLET_COLORS.length],
    ])
  );

  useEffect(() => {
    const steps: [number, number][] = phase === "loading"
      ? [[300, 8], [1200, 30], [2500, 45]]
      : phase === "enriching"
      ? [[0, 55], [2000, 70], [6000, 85]]
      : [[0, 100]];
    if (phase === "enriching") setProgress(50);
    const timers = steps.map(([delay, target]) => setTimeout(() => setProgress(target), delay));
    return () => timers.forEach(clearTimeout);
  }, [phase]);

  useEffect(() => {
    if (phase === "done") {
      const t = setTimeout(() => setProgress(0), 700);
      return () => clearTimeout(t);
    }
  }, [phase]);

  const fetchAll = useCallback(async () => {
    setPhase("loading");
    setFetchErrors(new Map());

    const chains = selectedChains.join(",");

    // Phase 1: fast responses across all wallets in parallel
    const fastResults = await Promise.allSettled(
      addresses.map((addr) =>
        fetch(`/api/portfolio/${addr}?chains=${chains}&fast=true`)
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json() as Promise<PortfolioData>;
          })
      )
    );

    const phase1Portfolios = new Map<string, PortfolioData>();
    const newErrors = new Map<string, string>();
    fastResults.forEach((result, i) => {
      const key = addresses[i].toLowerCase();
      if (result.status === "fulfilled") {
        phase1Portfolios.set(key, result.value);
      } else {
        newErrors.set(key, (result.reason as Error)?.message ?? "Unknown error");
      }
    });
    setPortfolios(phase1Portfolios);
    setFetchErrors(newErrors);
    setLastUpdated(new Date());
    setPhase("enriching");

    // Phase 2: full enrichment for all wallets in parallel
    const fullResults = await Promise.allSettled(
      addresses.map((addr) =>
        fetch(`/api/portfolio/${addr}?chains=${chains}`)
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json() as Promise<PortfolioData>;
          })
      )
    );
    fullResults.forEach((result, i) => {
      const key = addresses[i].toLowerCase();
      if (result.status === "fulfilled") {
        phase1Portfolios.set(key, result.value);
      }
    });
    setPortfolios(new Map(phase1Portfolios));
    setPhase("done");
  }, [addresses, selectedChains]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const loadedPortfolios = [...portfolios.values()];
  const merged = loadedPortfolios.length > 0
    ? mergePortfolios(loadedPortfolios, selectedWallets)
    : null;

  // Pass only text + dot to the tables (no bg/border needed there)
  const tableColorMap = new Map(
    [...colorMap.entries()].map(([addr, c]) => [addr, { text: c.text, dot: c.dot }])
  );

  function openAddWallet() {
    setAddingWallet(true);
    setAddInput("");
    setAddError("");
    setTimeout(() => addInputRef.current?.focus(), 50);
  }

  function cancelAddWallet() {
    setAddingWallet(false);
    setAddInput("");
    setAddError("");
  }

  function submitAddWallet(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = addInput.trim();
    if (!trimmed) { setAddError("Enter an address."); return; }
    if (!isAddress(trimmed)) { setAddError("Invalid address."); return; }
    if (addresses.map((a) => a.toLowerCase()).includes(trimmed.toLowerCase())) {
      setAddError("Already in bundle."); return;
    }
    router.push(`/portfolio/bundle?addresses=${[...addresses, trimmed].join(",")}`);
  }

  function toggleWallet(key: string) {
    setSelectedWallets((prev) => {
      if (prev.includes(key)) {
        return prev.length > 1 ? prev.filter((a) => a !== key) : prev;
      }
      return [...prev, key];
    });
  }

  return (
    <div className="min-h-screen">
      {/* Progress bar */}
      <div className="fixed top-0 left-0 right-0 z-50 h-0.5">
        <div
          className="h-full bg-blue-500"
          style={{
            width: `${progress}%`,
            opacity: progress === 0 ? 0 : 1,
            transition: "width 500ms ease-out, opacity 300ms ease-out",
          }}
        />
      </div>

      {/* Top nav */}
      <nav className="sticky top-0 z-10 border-b border-gray-800 bg-gray-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <button
            onClick={() => router.push("/")}
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            <ArrowLeft size={14} />
            Back
          </button>
          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="text-xs text-gray-600">
                Updated {lastUpdated.toLocaleTimeString()}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={fetchAll}
              disabled={phase !== "done"}
              className="gap-1.5"
            >
              <RefreshCw size={13} className={phase !== "done" ? "animate-spin" : ""} />
              Refresh
            </Button>
          </div>
        </div>
      </nav>

      <div className="mx-auto max-w-7xl px-4 py-8 space-y-8">
        {/* Page header */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Layers size={16} className="text-indigo-400" />
            <h1 className="text-lg font-semibold text-gray-100">Bundle Portfolio</h1>
          </div>
          <p className="text-xs text-gray-500">
            {addresses.length} wallets
            {merged ? ` · ${formatUSD(merged.totalValueUSD)} total` : ""}
          </p>
        </div>

        {/* Wallet selector */}
        <div className="space-y-2">
          <p className="text-xs text-gray-500">Wallets — click to toggle</p>
          <div className="flex flex-wrap items-center gap-2">
            {addresses.map((addr) => {
              const key = addr.toLowerCase();
              const color = colorMap.get(key)!;
              const isSelected = selectedWallets.includes(key);
              const portfolio = portfolios.get(key);
              const hasError = fetchErrors.has(key);

              return (
                <button
                  key={addr}
                  onClick={() => toggleWallet(key)}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-all ${
                    isSelected
                      ? `${color.bg} ${color.text} ${color.border}`
                      : "border-gray-700 bg-gray-900 text-gray-500 hover:text-gray-300 hover:border-gray-600"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${isSelected ? color.dot : "bg-gray-600"}`} />
                  <span className="font-mono">{shortenAddress(addr)}</span>
                  {portfolio && phase !== "loading" && (
                    <span className={isSelected ? "opacity-60" : "text-gray-600"}>
                      {formatUSD(portfolio.totalValueUSD)}
                    </span>
                  )}
                  {hasError && <span className="text-red-400 ml-0.5">!</span>}
                </button>
              );
            })}

            {/* Add wallet */}
            {!addingWallet ? (
              <button
                onClick={openAddWallet}
                className="flex items-center gap-1 rounded-lg border border-dashed border-gray-700 px-3 py-1.5 text-xs text-gray-500 hover:border-indigo-600 hover:text-indigo-400 transition-colors"
              >
                <Plus size={11} />
                Add
              </button>
            ) : (
              <form onSubmit={submitAddWallet} className="flex items-center gap-2">
                <input
                  ref={addInputRef}
                  type="text"
                  placeholder="0x…"
                  value={addInput}
                  onChange={(e) => { setAddInput(e.target.value); setAddError(""); }}
                  className="w-56 rounded-lg border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs text-gray-100 placeholder-gray-500 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
                <button
                  type="submit"
                  className="rounded-lg border border-indigo-600 bg-indigo-600/20 px-3 py-1.5 text-xs text-indigo-300 hover:bg-indigo-600/30 transition-colors"
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={cancelAddWallet}
                  className="text-gray-600 hover:text-gray-400 transition-colors"
                >
                  <X size={13} />
                </button>
                {addError && <p className="text-xs text-red-400">{addError}</p>}
              </form>
            )}
          </div>
        </div>

        {/* Chain selector */}
        <div className="space-y-2">
          <p className="text-xs text-gray-500">Filter chains</p>
          <ChainSelector selected={selectedChains} onChange={setSelectedChains} />
        </div>

        {/* Per-wallet errors */}
        {fetchErrors.size > 0 && (
          <div className="space-y-2">
            {[...fetchErrors.entries()].map(([addr, msg]) => (
              <div
                key={addr}
                className="rounded-xl border border-red-900/50 bg-red-950/20 px-4 py-3 text-sm text-red-400"
              >
                <span className="font-mono">{shortenAddress(addr)}</span>: {msg}
              </div>
            ))}
          </div>
        )}

        {merged ? (
          <>
            {/* Total value */}
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-widest">Total Portfolio Value</p>
              {phase === "loading" ? (
                <div className="mt-1 h-10 w-48 animate-pulse rounded-lg bg-gray-800" />
              ) : (
                <p className="text-4xl font-bold tracking-tight">{formatUSD(merged.totalValueUSD)}</p>
              )}
            </div>
            {phase !== "loading" && <SummaryCards data={merged} />}
            {phase !== "loading" && <PortfolioChart data={merged.chartData} title="Bundle Portfolio Value (30d)" />}
            <TokenTable
              tokens={merged.tokens}
              totalValueUSD={merged.totalValueUSD}
              walletColorMap={tableColorMap}
              isLoading={phase === "loading"}
              isEnriching={phase === "enriching"}
            />
            <DefiPositionsTable
              positions={merged.defiPositions}
              totalValueUSD={merged.totalValueUSD}
              walletColorMap={tableColorMap}
              isLoading={phase === "loading"}
              isEnriching={phase === "enriching"}
            />
          </>
        ) : phase === "loading" ? (
          <>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-widest">Total Portfolio Value</p>
              <div className="mt-1 h-10 w-48 animate-pulse rounded-lg bg-gray-800" />
            </div>
            <TokenTable tokens={[]} totalValueUSD={0} isLoading />
            <DefiPositionsTable positions={[]} totalValueUSD={0} isLoading />
          </>
        ) : fetchErrors.size === 0 ? (
          <div className="rounded-xl border border-gray-800 bg-gray-900/30 px-4 py-10 text-center text-sm text-gray-500">
            No data loaded
          </div>
        ) : null}
      </div>
    </div>
  );
}
