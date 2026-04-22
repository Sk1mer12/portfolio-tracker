"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, RefreshCw, Plus, X } from "lucide-react";
import { isAddress } from "viem";
import { Button } from "@/components/ui/button";
import { PortfolioHeader } from "@/components/PortfolioHeader";
import { SummaryCards } from "@/components/SummaryCards";
import { TokenTable } from "@/components/TokenTable";
import { DefiPositionsTable } from "@/components/DefiPositionsTable";
import { PortfolioChart } from "@/components/PortfolioChart";
import { ChainSelector } from "@/components/ChainSelector";
import { SUPPORTED_CHAINS } from "@/lib/chains";
import type { PortfolioData } from "@/types/portfolio";

interface Props {
  address: string;
}

type LoadPhase = "loading" | "enriching" | "done";

// Progress targets per phase — actual timers animate toward these within each phase
const PHASE_PROGRESS: Record<LoadPhase, number[]> = {
  loading:   [8, 30, 45],       // delays: 300ms, 1200ms, 2500ms
  enriching: [55, 70, 82, 90],  // delays: 0ms, 2000ms, 6000ms, 14000ms
  done:      [100],
};
const PHASE_DELAYS: Record<LoadPhase, number[]> = {
  loading:   [300, 1200, 2500],
  enriching: [0, 2000, 6000, 14000],
  done:      [0],
};

export function PortfolioDashboard({ address }: Props) {
  const router = useRouter();
  const [selectedChains, setSelectedChains] = useState<number[]>(
    SUPPORTED_CHAINS.map((c) => c.id)
  );
  const [data, setData] = useState<PortfolioData | null>(null);
  const [phase, setPhase] = useState<LoadPhase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [progress, setProgress] = useState(0);
  const [addingWallet, setAddingWallet] = useState(false);
  const [addInput, setAddInput] = useState("");
  const [addError, setAddError] = useState("");
  const addInputRef = useRef<HTMLInputElement>(null);

  // Drive progress bar off phase transitions, not arbitrary time guesses
  useEffect(() => {
    const targets = PHASE_PROGRESS[phase];
    const delays  = PHASE_DELAYS[phase];
    if (phase === "enriching") setProgress(50);
    const timers = targets.map((target, i) =>
      setTimeout(() => setProgress(target), delays[i])
    );
    return () => timers.forEach(clearTimeout);
  }, [phase]);

  // Fade out bar after done
  useEffect(() => {
    if (phase === "done") {
      const t = setTimeout(() => setProgress(0), 700);
      return () => clearTimeout(t);
    }
  }, [phase]);

  const fetchPortfolio = useCallback(async () => {
    setPhase("loading");
    setError(null);
    const chains = selectedChains.join(",");

    // ── Phase 1: fast response (~2–4s) ────────────────────────────────────────
    // Skips vault deposit history and token cost basis (the slow Blockscout calls).
    try {
      const res = await fetch(`/api/portfolio/${address}?chains=${chains}&fast=true`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setLastUpdated(new Date());
      setPhase("enriching");
    } catch (err: any) {
      setError(err.message ?? "Unknown error");
      setPhase("done");
      return;
    }

    // ── Phase 2: full enrichment (vault APY, deposit dates, token P&L) ────────
    // Failure is non-fatal — keep phase-1 data, just don't show enriched fields.
    try {
      const res = await fetch(`/api/portfolio/${address}?chains=${chains}`);
      if (res.ok) setData(await res.json());
    } catch { /* keep fast data */ }

    setPhase("done");
  }, [address, selectedChains]);

  useEffect(() => {
    fetchPortfolio();
  }, [fetchPortfolio]);

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
    if (trimmed.toLowerCase() === address.toLowerCase()) {
      setAddError("Same as current wallet."); return;
    }
    router.push(`/portfolio/bundle?addresses=${address},${trimmed}`);
  }

  const isLoading   = phase === "loading";
  const isEnriching = phase === "enriching";

  return (
    <div className="min-h-screen">
      {/* Progress bar */}
      <div className="fixed top-0 left-0 right-0 z-50 h-0.5">
        <div
          className="h-full bg-blue-500"
          style={{
            width: `${progress}%`,
            opacity: progress === 0 ? 0 : 1,
            transition: "width 600ms ease-out, opacity 300ms ease-out",
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
            {lastUpdated && !isLoading && (
              <span className="text-xs text-gray-600">
                {isEnriching
                  ? "Enriching…"
                  : `Updated ${lastUpdated.toLocaleTimeString()}`}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={fetchPortfolio}
              disabled={isLoading || isEnriching}
              className="gap-1.5"
            >
              <RefreshCw size={13} className={isLoading || isEnriching ? "animate-spin" : ""} />
              Refresh
            </Button>
          </div>
        </div>
      </nav>

      <div className="mx-auto max-w-7xl px-4 py-8 space-y-8">
        {/* Chain selector */}
        <div className="space-y-2">
          <p className="text-xs text-gray-500">Filter chains</p>
          <ChainSelector selected={selectedChains} onChange={setSelectedChains} />
        </div>

        {error && (
          <div className="rounded-xl border border-red-900/50 bg-red-950/20 px-4 py-4 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Tables always rendered — show skeleton rows when loading, real rows otherwise */}
        <PortfolioHeader
          address={address}
          totalValueUSD={data?.totalValueUSD ?? 0}
          chains={data?.chains ?? []}
          isLoading={isLoading}
          belowAddress={
            !addingWallet ? (
              <button
                onClick={openAddWallet}
                className="flex items-center gap-1.5 rounded-lg border border-dashed border-gray-700 px-3 py-1.5 text-xs text-gray-500 hover:border-indigo-600 hover:text-indigo-400 transition-colors w-fit"
              >
                <Plus size={12} />
                Add wallet to bundle
              </button>
            ) : (
              <form onSubmit={submitAddWallet} className="flex items-center gap-2">
                <input
                  ref={addInputRef}
                  type="text"
                  placeholder="0x… second wallet"
                  value={addInput}
                  onChange={(e) => { setAddInput(e.target.value); setAddError(""); }}
                  className="w-72 rounded-lg border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs text-gray-100 placeholder-gray-500 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
                <Button type="submit" variant="outline" size="sm" className="text-xs">
                  Bundle
                </Button>
                <button
                  type="button"
                  onClick={cancelAddWallet}
                  className="text-gray-600 hover:text-gray-400 transition-colors"
                >
                  <X size={14} />
                </button>
                {addError && <p className="text-xs text-red-400">{addError}</p>}
              </form>
            )
          }
        />

        {data && <SummaryCards data={data} />}

        {data && (
          <PortfolioChart
            data={data.chartData}
            title="Portfolio Value Over Time (30d)"
          />
        )}

        <TokenTable
          tokens={data?.tokens ?? []}
          totalValueUSD={data?.totalValueUSD ?? 0}
          isLoading={isLoading}
          isEnriching={isEnriching}
        />

        <DefiPositionsTable
          positions={data?.defiPositions ?? []}
          totalValueUSD={data?.totalValueUSD ?? 0}
          isLoading={isLoading}
          isEnriching={isEnriching}
        />
      </div>
    </div>
  );
}
