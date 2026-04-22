export interface YieldMetrics {
  yieldUSD: number | null;
  yieldPct: number | null;
  apy: number | null;
  daysHeld: number | null;
}

/**
 * Calculate yield metrics for a DeFi position.
 * @param currentValueUSD  Current USD value of the position
 * @param depositedValueUSD USD value at time of deposit
 * @param depositDate  ISO date string of when position was opened
 */
export function calcYield(
  currentValueUSD: number | null,
  depositedValueUSD: number | null,
  depositDate: string | null
): YieldMetrics {
  if (currentValueUSD == null || depositedValueUSD == null || depositedValueUSD === 0) {
    return { yieldUSD: null, yieldPct: null, apy: null, daysHeld: null };
  }

  const yieldUSD = currentValueUSD - depositedValueUSD;
  const yieldPct = (yieldUSD / depositedValueUSD) * 100;

  let daysHeld: number | null = null;
  let apy: number | null = null;

  if (depositDate) {
    const depositMs = new Date(depositDate).getTime();
    const nowMs = Date.now();
    daysHeld = Math.max((nowMs - depositMs) / (1000 * 60 * 60 * 24), 0.01);

    if (daysHeld > 0) {
      // Compound APY formula: ((1 + r)^(365/days) - 1) * 100
      const r = yieldPct / 100;
      apy = (Math.pow(1 + r, 365 / daysHeld) - 1) * 100;
    }
  }

  return { yieldUSD, yieldPct, apy, daysHeld };
}

/**
 * Aggregate yield across all positions.
 */
export function aggregateYield(
  positions: Array<{ depositedValueUSD: number | null; currentValueUSD: number | null }>
): { totalYieldUSD: number; totalDepositedUSD: number; overallYieldPct: number | null } {
  let totalYieldUSD = 0;
  let totalDepositedUSD = 0;

  for (const pos of positions) {
    if (pos.currentValueUSD != null && pos.depositedValueUSD != null) {
      totalYieldUSD += pos.currentValueUSD - pos.depositedValueUSD;
      totalDepositedUSD += pos.depositedValueUSD;
    }
  }

  const overallYieldPct =
    totalDepositedUSD > 0 ? (totalYieldUSD / totalDepositedUSD) * 100 : null;

  return { totalYieldUSD, totalDepositedUSD, overallYieldPct };
}
