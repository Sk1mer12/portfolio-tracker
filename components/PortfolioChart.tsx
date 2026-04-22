"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { PortfolioChartPoint } from "@/types/portfolio";
import { formatUSD } from "@/lib/format";

interface Props {
  data: PortfolioChartPoint[];
  title?: string;
}

function CustomTooltip({ active, payload, label }: any) {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-xs shadow-xl">
        <p className="text-gray-400">{label}</p>
        <p className="font-semibold text-white">{formatUSD(payload[0].value)}</p>
      </div>
    );
  }
  return null;
}

/** Scale-aware axis label: $123, $1.2k, $1.2M, $1.2B */
function formatAxisValue(v: number): string {
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000)     return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)         return `$${(v / 1_000).toFixed(1)}k`;
  return `$${v.toFixed(0)}`;
}

export function PortfolioChart({ data, title = "Portfolio Value" }: Props) {
  if (!data || data.length < 2) {
    return (
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-200">{title}</h2>
        <div className="rounded-xl border border-gray-800 bg-gray-900/30 px-4 py-10 text-center text-sm text-gray-500">
          Not enough historical data to display chart
        </div>
      </div>
    );
  }

  // Compute a focused Y domain: pad 5% above and below the actual data range
  // so small fluctuations aren't lost in a zero-based axis.
  const values = data.map((d) => d.valueUSD);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const padding = (maxVal - minVal) * 0.05 || maxVal * 0.05;
  const yMin = Math.max(0, minVal - padding);
  const yMax = maxVal + padding;

  // Show roughly 5 evenly spaced ticks on the Y axis
  const tickCount = 5;

  // Only show every Nth X label to avoid crowding (target ~6 labels)
  const xInterval = Math.max(1, Math.floor(data.length / 6)) - 1;

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-gray-200">{title}</h2>
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data} margin={{ top: 5, right: 16, left: 8, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis
              dataKey="date"
              tick={{ fill: "#6b7280", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              interval={xInterval}
            />
            <YAxis
              domain={[yMin, yMax]}
              tickCount={tickCount}
              tick={{ fill: "#6b7280", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={formatAxisValue}
              width={60}
            />
            <Tooltip content={<CustomTooltip />} />
            <Line
              type="monotone"
              dataKey="valueUSD"
              stroke="#6366f1"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: "#6366f1" }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
