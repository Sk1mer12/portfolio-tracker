import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { formatUSD, formatPct, yieldColor } from "@/lib/format";
import type { PortfolioData } from "@/types/portfolio";

interface Props {
  data: PortfolioData;
}

export function SummaryCards({ data }: Props) {
  const bestPosition = [...data.defiPositions]
    .filter((p) => p.yieldPct != null)
    .sort((a, b) => (b.yieldPct ?? 0) - (a.yieldPct ?? 0))[0];

  const cards = [
    {
      title: "Token Holdings",
      value: formatUSD(data.tokensValueUSD, true),
      sub: `${data.tokens.length} tokens`,
      color: "text-blue-400",
    },
    {
      title: "DeFi Positions",
      value: formatUSD(data.defiValueUSD, true),
      sub: `${data.defiPositions.length} open positions`,
      color: "text-purple-400",
    },
    {
      title: "Total Yield",
      value: formatUSD(data.totalYieldUSD),
      sub: data.totalYieldPct != null ? formatPct(data.totalYieldPct) : "—",
      color: yieldColor(data.totalYieldUSD),
    },
    {
      title: "Best Position",
      value: bestPosition ? `${bestPosition.protocol} · ${bestPosition.chain}` : "—",
      sub: bestPosition?.yieldPct != null ? formatPct(bestPosition.yieldPct) : "—",
      color: "text-green-400",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {cards.map((c) => (
        <Card key={c.title}>
          <CardHeader>
            <CardTitle>{c.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-xl font-bold truncate ${c.color}`}>{c.value}</p>
            <p className="mt-0.5 text-xs text-gray-500">{c.sub}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
