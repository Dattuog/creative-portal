/** Round, even steps with the top tick above the maximum. */
export function niceScale(max: number, target = 4) {
  if (max <= 0) return { top: 1, ticks: [0, 1] };
  const raw = max / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  let top = Math.ceil(max / step) * step;
  if (top <= max) top += step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
  return { top, ticks };
}

/**
 * Revenue Shopify confirms (filled bar) against what Meta claims for the same
 * ad (thin tick), on one scale shared by every row.
 */
export function ClaimBar({ verified, claimed, scaleMax, width = 120 }: { verified: number; claimed: number; scaleMax: number; width?: number }) {
  const s = (v: number) => (scaleMax > 0 ? Math.min(width, (v / scaleMax) * width) : 0);
  return (
    <svg width={width + 2} height="14" aria-hidden="true" className="block">
      <rect x="0" y="5" width={width} height="4" rx="2" fill="var(--muted)" />
      {verified > 0 && <rect x="0" y="5" width={Math.max(2, s(verified))} height="4" rx="2" fill="var(--chart-1)" />}
      {claimed > 0 && <rect x={Math.min(width, s(claimed))} y="1" width="1.5" height="12" fill="var(--foreground)" />}
    </svg>
  );
}
