import type { CheckResult, Creative, InsightRow, OrderRow, OwnerRow } from "./types";

const pct = (a: number, b: number) => (b === 0 ? (a === 0 ? 0 : 100) : (Math.abs(a - b) / Math.abs(b)) * 100);

/**
 * Data checks run after every sync. Numbers are shown as "verified" only when
 * every critical check passes. Each check compares what we stored against an
 * independent number from the source, not against itself.
 */
export function runChecks(a: {
  sourceAccountSpendMinor: number; // Meta account-level insights total
  storedInsights: InsightRow[]; // what we wrote (ad level)
  sourceOrderCount: number; // Shopify ordersCount
  fetchedOrderCount: number; // orders we paged through (before tz filtering)
  storedOrders: OrderRow[];
  creatives: Creative[];
  owners: OwnerRow[];
  ownerProblems: string[];
  currency: string;
}): CheckResult[] {
  const checks: CheckResult[] = [];
  const spend = a.storedInsights.reduce((s, r) => s + r.spendMinor, 0);
  const d1 = pct(spend, a.sourceAccountSpendMinor);
  checks.push({
    name: "Meta spend matches account total",
    critical: true,
    sourceValue: a.sourceAccountSpendMinor,
    dbValue: spend,
    diffPct: d1,
    passed: d1 <= 0.5,
    note: "Ad-level spend must match Meta's account total within 0.5%.",
  });

  checks.push({
    name: "Every Shopify order fetched",
    critical: true,
    sourceValue: a.sourceOrderCount,
    dbValue: a.fetchedOrderCount,
    diffPct: pct(a.fetchedOrderCount, a.sourceOrderCount),
    passed: a.fetchedOrderCount === a.sourceOrderCount,
    note: "Every order Shopify counts was fetched.",
  });

  const wrongCurrency = a.storedOrders.filter((o) => o.currency !== a.currency).length;
  checks.push({
    name: "One currency",
    critical: true,
    sourceValue: a.storedOrders.length,
    dbValue: a.storedOrders.length - wrongCurrency,
    diffPct: pct(a.storedOrders.length - wrongCurrency, a.storedOrders.length),
    passed: wrongCurrency === 0,
    note: `All orders are in ${a.currency}.`,
  });

  const known = new Set(a.creatives.map((c) => c.adId));
  const orphanOrders = a.storedOrders.filter((o) => o.attributedAdId && !known.has(o.attributedAdId)).length;
  checks.push({
    name: "Orders link to real ads",
    critical: false,
    sourceValue: a.storedOrders.filter((o) => o.attributedAdId).length,
    dbValue: orphanOrders,
    diffPct: 0,
    passed: orphanOrders === 0,
    note: "utm_content holds a real ad ID.",
  });

  const spendByAd = new Map<string, number>();
  for (const r of a.storedInsights) spendByAd.set(r.adId, (spendByAd.get(r.adId) ?? 0) + r.spendMinor);
  const owned = new Set(a.owners.map((o) => o.adId));
  const unowned = [...spendByAd.entries()].filter(([id, s]) => s > 0 && !owned.has(id));
  const unownedSpend = unowned.reduce((s, [, v]) => s + v, 0);
  checks.push({
    name: "Every ad has an owner",
    critical: false,
    sourceValue: spendByAd.size,
    dbValue: unowned.length,
    diffPct: pct(unownedSpend, spend) ,
    passed: unowned.length === 0,
    note: unowned.length
      ? `Not in the sheet: ${unowned.map(([id]) => a.creatives.find((c) => c.adId === id)?.adName ?? id).join(", ")}`
      : "Every ad has a strategist and an editor.",
  });

  checks.push({
    name: "Owners sheet is clean",
    critical: false,
    sourceValue: a.owners.length + a.ownerProblems.length,
    dbValue: a.owners.length,
    diffPct: 0,
    passed: a.ownerProblems.length === 0,
    note: a.ownerProblems.length ? a.ownerProblems.slice(0, 3).join(" · ") : "No malformed or duplicate rows.",
  });

  return checks;
}
