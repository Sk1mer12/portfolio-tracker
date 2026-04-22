export function formatUSD(value: number | null | undefined, compact = false): string {
  if (value == null) return "—";
  const opts: Intl.NumberFormatOptions = {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    ...(compact && Math.abs(value) >= 1_000_000 ? { notation: "compact" } : {}),
  };
  return new Intl.NumberFormat("en-US", opts).format(value);
}

export function formatPct(value: number | null | undefined, decimals = 2): string {
  if (value == null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)}%`;
}

export function formatNumber(value: number | null | undefined, decimals = 4): string {
  if (value == null) return "—";
  if (Math.abs(value) < 0.0001 && value !== 0) return "< 0.0001";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

export function shortenAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatDaysHeld(days: number | null): string {
  if (days == null) return "—";
  if (days < 1) return "< 1 day";
  if (days === 1) return "1 day";
  if (days < 30) return `${Math.floor(days)}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}yr`;
}

export function yieldColor(value: number | null): string {
  if (value == null) return "text-gray-400";
  if (value > 0) return "text-green-400";
  if (value < 0) return "text-red-400";
  return "text-gray-400";
}
