export function money(minor: number | null, currency: string, digits = 0) {
  if (minor === null) return "—";
  return new Intl.NumberFormat("en-IE", { style: "currency", currency, maximumFractionDigits: digits, minimumFractionDigits: digits }).format(minor / 100);
}
export const ratio = (x: number | null, digits = 2) => (x === null ? "—" : x.toFixed(digits));
export const pct = (x: number | null, digits = 2) => (x === null ? "—" : `${(x * 100).toFixed(digits)}%`);
export const int = (n: number) => new Intl.NumberFormat("en-IE").format(n);
export function ago(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
export const isOlderThanHours = (iso: string, hours: number) => Date.now() - new Date(iso).getTime() > hours * 3600 * 1000;
