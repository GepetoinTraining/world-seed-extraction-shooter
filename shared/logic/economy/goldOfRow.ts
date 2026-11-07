/**
 * WHAT ONE SIGNED ROW DOES TO A CHARACTER'S OWN GOLD. The one equation, read by the browser's audit
 * (GoldAudit) and by the hub's rerun (D134): genesis grant, plus every signed delta, less every tax
 * and upkeep, plus every trade's share. Pure, so both sides run the same arithmetic in the same
 * order, row by row, and land on the same reading.
 */
export function goldOfRow(type: string, data: Record<string, any> | undefined): number {
  const d = data ?? {};
  if (type === 'CHARACTER_GENESIS') return d.gold ?? 500;
  if (type === 'GOLD_DELTA') return d.amount ?? 0;
  if (type === 'TAX') return -(d.tax ?? 0);
  if (type === 'UPKEEP') return -(d.amount ?? 0);
  if (type === 'TRADE') return d.playerDelta ?? 0;
  return 0;
}

/**
 * Two readings of the same gold agree when they are this close. Both sides add the same rows in
 * the same order, but the game's own running total may have been added in another order, and
 * "math can skew ever so slightly" (Pedro, D134): a false challenge costs a person their standing.
 */
export function sameGold(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
}
