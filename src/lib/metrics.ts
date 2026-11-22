import type { AdSet, Creative, InsightRow, OrderRow, OwnerRow } from "./types";

export interface Totals {
  spendMinor: number;
  impressions: number;
  clicks: number;
  metaPurchases: number;
  metaRevenueMinor: number;
  shopifyOrders: number;
  shopifyRevenueMinor: number;
}

export interface Derived {
  ctr: number | null; // clicks / impressions
  metaRoas: number | null; // meta revenue / spend
  roas: number | null; // shopify-attributed revenue / spend  (the number we trust)
  cpa: number | null; // spend / shopify orders (minor units)
}

export type Row = Totals & Derived & { key: string; label: string };

export function emptyTotals(): Totals {
  return {
    spendMinor: 0,
    impressions: 0,
    clicks: 0,
    metaPurchases: 0,
    metaRevenueMinor: 0,
    shopifyOrders: 0,
    shopifyRevenueMinor: 0,
  };
}

export function addTotals(a: Totals, b: Totals): Totals {
  return {
    spendMinor: a.spendMinor + b.spendMinor,
    impressions: a.impressions + b.impressions,
    clicks: a.clicks + b.clicks,
    metaPurchases: a.metaPurchases + b.metaPurchases,
    metaRevenueMinor: a.metaRevenueMinor + b.metaRevenueMinor,
    shopifyOrders: a.shopifyOrders + b.shopifyOrders,
    shopifyRevenueMinor: a.shopifyRevenueMinor + b.shopifyRevenueMinor,
  };
}

const ratio = (n: number, d: number) => (d > 0 ? n / d : null);

/**
 * Ratios are always computed from summed totals (sum revenue / sum spend),
 * never by averaging per-row ratios. Averaging ROAS across creatives gives
 * a tiny-spend creative the same weight as the biggest one.
 */
export function derive(t: Totals): Derived {
  return {
    ctr: ratio(t.clicks, t.impressions),
    metaRoas: ratio(t.metaRevenueMinor, t.spendMinor),
    roas: ratio(t.shopifyRevenueMinor, t.spendMinor),
    cpa: t.shopifyOrders > 0 ? Math.round(t.spendMinor / t.shopifyOrders) : null,
  };
}

export function inWindow(date: string, start: string, end: string) {
  return date >= start && date <= end;
}

/** Totals per ad_id inside a date window. */
export function totalsByAd(
  insights: InsightRow[],
  orders: OrderRow[],
  start: string,
  end: string,
): Map<string, Totals> {
  const m = new Map<string, Totals>();
  const get = (id: string) => {
    let t = m.get(id);
    if (!t) m.set(id, (t = emptyTotals()));
    return t;
  };
  for (const r of insights) {
    if (!inWindow(r.date, start, end)) continue;
    const t = get(r.adId);
    t.spendMinor += r.spendMinor;
    t.impressions += r.impressions;
    t.clicks += r.clicks;
    t.metaPurchases += r.metaPurchases;
    t.metaRevenueMinor += r.metaPurchaseValueMinor;
  }
  for (const o of orders) {
    if (!o.attributedAdId || !inWindow(o.date, start, end)) continue;
    const t = get(o.attributedAdId);
    t.shopifyOrders += 1;
    t.shopifyRevenueMinor += o.totalMinor;
  }
  return m;
}

export function groupRows(
  byAd: Map<string, Totals>,
  keyOf: (adId: string) => { key: string; label: string } | null,
): Row[] {
  const g = new Map<string, { label: string; t: Totals }>();
  for (const [adId, t] of byAd) {
    const k = keyOf(adId);
    if (!k) continue;
    const cur = g.get(k.key) ?? { label: k.label, t: emptyTotals() };
    cur.t = addTotals(cur.t, t);
    g.set(k.key, cur);
  }
  return [...g.entries()]
    .map(([key, { label, t }]) => ({ key, label, ...t, ...derive(t) }))
    .sort((a, b) => b.spendMinor - a.spendMinor);
}

export interface DashboardModel {
  window: { start: string; end: string };
  total: Totals & Derived;
  byCreative: (Row & { adsetName: string; format: string; status: string; strategist: string; editor: string })[];
  byEditor: Row[];
  byStrategist: Row[];
  shopifyTotalRevenueMinor: number; // all orders incl. unattributed
  shopifyTotalOrders: number;
  unattributedRevenueMinor: number;
  daily: { date: string; spendMinor: number; shopifyRevenueMinor: number; metaRevenueMinor: number }[];
}

export function buildDashboard(args: {
  creatives: Creative[];
  adsets: AdSet[];
  insights: InsightRow[];
  orders: OrderRow[];
  owners: OwnerRow[];
  start: string;
  end: string;
  includeUnattributed: boolean;
}): DashboardModel {
  const { creatives, adsets, insights, orders, owners, start, end } = args;
  const byAd = totalsByAd(insights, orders, start, end);
  const cMap = new Map(creatives.map((c) => [c.adId, c]));
  const aMap = new Map(adsets.map((a) => [a.adsetId, a]));
  const oMap = new Map(owners.map((o) => [o.adId, o]));

  // Only show ads the viewer can see (creatives list is already scoped).
  for (const id of [...byAd.keys()]) if (!cMap.has(id)) byAd.delete(id);

  const byCreative = groupRows(byAd, (id) => ({ key: id, label: cMap.get(id)?.adName ?? id })).map((r) => {
    const c = cMap.get(r.key)!;
    const o = oMap.get(r.key);
    return {
      ...r,
      adsetName: aMap.get(c.adsetId)?.name ?? c.adsetId,
      format: c.format,
      status: c.status,
      strategist: o?.strategist ?? "— unassigned",
      editor: o?.editor ?? "— unassigned",
    };
  });
  const byEditor = groupRows(byAd, (id) => {
    const e = oMap.get(id)?.editor ?? "— unassigned";
    return { key: e, label: e };
  });
  const byStrategist = groupRows(byAd, (id) => {
    const s = oMap.get(id)?.strategist ?? "— unassigned";
    return { key: s, label: s };
  });

  let total = emptyTotals();
  for (const t of byAd.values()) total = addTotals(total, t);

  const winOrders = orders.filter((o) => inWindow(o.date, start, end));
  const shopifyTotalRevenueMinor = args.includeUnattributed
    ? winOrders.reduce((s, o) => s + o.totalMinor, 0)
    : total.shopifyRevenueMinor;
  const shopifyTotalOrders = args.includeUnattributed ? winOrders.length : total.shopifyOrders;

  const dailyMap = new Map<string, { spendMinor: number; shopifyRevenueMinor: number; metaRevenueMinor: number }>();
  const day = (d: string) => {
    let v = dailyMap.get(d);
    if (!v) dailyMap.set(d, (v = { spendMinor: 0, shopifyRevenueMinor: 0, metaRevenueMinor: 0 }));
    return v;
  };
  for (const r of insights) {
    if (!inWindow(r.date, start, end) || !cMap.has(r.adId)) continue;
    const v = day(r.date);
    v.spendMinor += r.spendMinor;
    v.metaRevenueMinor += r.metaPurchaseValueMinor;
  }
  for (const o of winOrders) {
    if (!o.attributedAdId || !cMap.has(o.attributedAdId)) continue;
    day(o.date).shopifyRevenueMinor += o.totalMinor;
  }
  const daily = [...dailyMap.entries()].map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date));

  return {
    window: { start, end },
    total: { ...total, ...derive(total) },
    byCreative,
    byEditor,
    byStrategist,
    shopifyTotalRevenueMinor,
    shopifyTotalOrders,
    unattributedRevenueMinor: shopifyTotalRevenueMinor - total.shopifyRevenueMinor,
    daily,
  };
}
