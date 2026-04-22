"use client";

import { useState } from "react";
import { Copy, Check, ExternalLink } from "lucide-react";
import { shortenAddress, formatUSD } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { CHAIN_BY_ID } from "@/lib/chains";

interface Props {
  address: string;
  totalValueUSD: number;
  chains: string[];
  isLoading?: boolean;
  belowAddress?: React.ReactNode;
}

export function PortfolioHeader({ address, totalValueUSD, chains, isLoading, belowAddress }: Props) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const chainColors = Object.values(CHAIN_BY_ID);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Address */}
        <div className="flex items-center gap-1.5 rounded-lg border border-gray-800 bg-gray-900 px-3 py-1.5">
          <span className="font-mono text-sm text-gray-300">{shortenAddress(address)}</span>
          <button onClick={copy} className="text-gray-500 hover:text-gray-300 transition-colors">
            {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
          </button>
          <a
            href={`https://etherscan.io/address/${address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-500 hover:text-gray-300 transition-colors"
          >
            <ExternalLink size={13} />
          </a>
        </div>

        {/* Chain badges */}
        {chains.map((chain) => {
          const info = chainColors.find((c) => c.name === chain);
          return (
            <Badge key={chain} color={info?.color ?? "#6366f1"}>
              {chain}
            </Badge>
          );
        })}
      </div>

      {belowAddress}

      <div>
        <p className="text-xs text-gray-500 uppercase tracking-widest">Total Portfolio Value</p>
        {isLoading ? (
          <div className="mt-1 h-10 w-48 animate-pulse rounded-lg bg-gray-800" />
        ) : (
          <p className="text-4xl font-bold tracking-tight">{formatUSD(totalValueUSD)}</p>
        )}
      </div>
    </div>
  );
}
