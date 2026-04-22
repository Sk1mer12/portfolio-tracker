export const dynamic = "force-dynamic";

import { BundleDashboard } from "@/components/BundleDashboard";
import { isAddress } from "viem";
import { notFound } from "next/navigation";

interface Props {
  searchParams: { addresses?: string };
}

export function generateMetadata({ searchParams }: Props) {
  const count = searchParams.addresses?.split(",").filter(Boolean).length ?? 0;
  return { title: `Bundle Portfolio · ${count} wallets` };
}

export default function BundlePage({ searchParams }: Props) {
  const raw = searchParams.addresses ?? "";
  const addresses = raw
    .split(",")
    .map((a) => a.trim())
    .filter((a) => isAddress(a));

  if (addresses.length < 2) {
    notFound();
  }

  return <BundleDashboard addresses={addresses} />;
}
