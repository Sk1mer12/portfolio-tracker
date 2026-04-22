export const dynamic = "force-dynamic";

import { PortfolioDashboard } from "@/components/PortfolioDashboard";
import { isAddress } from "viem";
import { notFound } from "next/navigation";

interface Props {
  params: { address: string };
}

export function generateMetadata({ params }: Props) {
  return {
    title: `Portfolio · ${params.address.slice(0, 6)}...${params.address.slice(-4)}`,
  };
}

export default function PortfolioPage({ params }: Props) {
  if (!isAddress(params.address)) {
    notFound();
  }
  return <PortfolioDashboard address={params.address} />;
}
