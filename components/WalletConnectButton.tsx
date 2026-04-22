"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useEffect } from "react";
import { useAccount } from "wagmi";
import { useRouter } from "next/navigation";

export function WalletConnectButton() {
  const { address, isConnected } = useAccount();
  const router = useRouter();

  useEffect(() => {
    if (isConnected && address) {
      router.push(`/portfolio/${address}`);
    }
  }, [isConnected, address, router]);

  return (
    <ConnectButton
      label="Connect Wallet"
      showBalance={false}
      chainStatus="none"
    />
  );
}
