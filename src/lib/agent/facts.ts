import type { AdSet, Creative, InsightRow, OrderRow, Settings } from "../types";
import { addTotals, derive, emptyTotals, totalsByAd, type Totals } from "../metrics";
import { addDays } from "../time";

export const LOOKBACK_DAYS = 7;

export interface AdFact {
  adId: string;
  adName: string;
  adsetId: string;
  status: string;
  spendMinor: number;
  orders: number;
  revenueMinor: number;
  roas: number | null;
  metaRoas: number | null;
  cpaMinor: number | null;
}
export interface AdsetFact {
  adsetId: string;
  name: string;
  status: string;
  dailyBudgetMinor: number;
  spendMinor: number;
  orders: number;
  revenueMinor: number;
  roas: number | null;
}
export interface Facts {
  start: string;
  end: string;
  targetRoas: number;
  /** Max spend per order that still hits target ROAS, from this account's own AOV. */
  targetCpaMinor: number;
  ads: AdFact[];
  adsets: AdsetFact[];
}

/** Deterministic numbers the agent reasons over. The LLM never computes these itself. */
export function buildFacts(a: {
  end: string;
  settings: Settings;
  creatives: Creative[];
  adsets: AdSet[];
  insights: InsightRow[];
  orders: OrderRow[];
}): Facts {
  const start = addDays(a.end, -(LOOKBACK_DAYS - 1));
  const byAd = totalsByAd(a.insights, a.orders, start, a.end);
  let all = emptyTotals();
  for (const t of byAd.values()) all = addTotals(all, t);
  const aov = all.shopifyOrders ? all.shopifyRevenueMinor / all.shopifyOrders : 3900;
  const targetCpaMinor = Math.round(aov / a.settings.targetRoas);

  const ads: AdFact[] = a.creatives.map((c) => {
    const t = byAd.get(c.adId) ?? emptyTotals();
    const d = derive(t);
    return {
      adId: c.adId, adName: c.adName, adsetId: c.adsetId, status: c.status,
      spendMinor: t.spendMinor, orders: t.shopifyOrders, revenueMinor: t.shopifyRevenueMinor,
      roas: d.roas, metaRoas: d.metaRoas, cpaMinor: d.cpa,
    };
  });

  const adsets: AdsetFact[] = a.adsets.map((s) => {
    let t: Totals = emptyTotals();
    for (const c of a.creatives) if (c.adsetId === s.adsetId) t = addTotals(t, byAd.get(c.adId) ?? emptyTotals());
    return {
      adsetId: s.adsetId, name: s.name, status: s.status, dailyBudgetMinor: s.dailyBudgetMinor,
      spendMinor: t.spendMinor, orders: t.shopifyOrders, revenueMinor: t.shopifyRevenueMinor, roas: derive(t).roas,
    };
  });

  return { start, end: a.end, targetRoas: a.settings.targetRoas, targetCpaMinor, ads, adsets };
}

/* ---------- Evidence rules (used both to suggest and to verify) ---------- */

export function pauseEvidence(ad: AdFact, f: Facts): string | null {
  if (ad.status !== "ACTIVE") return null;
  if (ad.orders === 0 && ad.spendMinor >= 2 * f.targetCpaMinor) return `No orders in ${LOOKBACK_DAYS} days of spend`;
  if (ad.spendMinor >= 3 * f.targetCpaMinor && ad.roas !== null && ad.roas < 0.5 * f.targetRoas)
    return `ROAS ${ad.roas.toFixed(2)} against a target of ${f.targetRoas}`;
  return null;
}
export function increaseEvidence(s: AdsetFact, f: Facts): string | null {
  if (s.status !== "ACTIVE") return null;
  if (s.roas !== null && s.roas >= 1.3 * f.targetRoas && s.orders >= 5)
    return `ROAS ${s.roas.toFixed(2)} on ${s.orders} orders, target ${f.targetRoas}`;
  return null;
}
export function decreaseEvidence(s: AdsetFact, f: Facts): string | null {
  if (s.status !== "ACTIVE") return null;
  if (s.roas !== null && s.roas < 0.8 * f.targetRoas && s.spendMinor >= 3 * f.targetCpaMinor)
    return `ROAS ${s.roas.toFixed(2)} against a target of ${f.targetRoas}`;
  return null;
}
