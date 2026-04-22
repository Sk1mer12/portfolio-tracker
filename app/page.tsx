export const dynamic = "force-dynamic";

import { WalletConnectButton } from "@/components/WalletConnectButton";
import { AddressInput } from "@/components/AddressInput";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4">
      {/* Background glow */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute left-1/2 top-1/3 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-900/20 blur-[120px]" />
      </div>

      <div className="w-full max-w-md space-y-10">
        {/* Logo + title */}
        <div className="text-center space-y-3">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600/20 border border-indigo-500/30 text-2xl">
            ◈
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            Web3 Portfolio
          </h1>
          <p className="text-gray-400 text-sm leading-relaxed">
            Track your tokens and DeFi positions across Ethereum, Base,
            Arbitrum, Optimism, BSC, Avalanche, and Polygon.
          </p>
        </div>

        {/* Connect card */}
        <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-6 backdrop-blur space-y-5">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">
              Connect your wallet
            </p>
            <WalletConnectButton />
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1 border-t border-gray-800" />
            <span className="text-xs text-gray-600">or</span>
            <div className="flex-1 border-t border-gray-800" />
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">
              Paste wallet address
            </p>
            <AddressInput />
          </div>
        </div>

        {/* Supported chains */}
        <div className="text-center">
          <p className="text-xs text-gray-600">
            Supports Ethereum · Base · Arbitrum · Optimism · BSC · Avalanche · Polygon
          </p>
        </div>
      </div>
    </main>
  );
}
