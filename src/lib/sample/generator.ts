/**
 * Sample data for a fictional DTC skincare brand ("Lumen Skin").
 * It is emitted in the *raw API shapes* Meta and Shopify return, so the
 * sync pipeline runs the exact same parsing/normalising code as in live mode.
 * Data is deterministic per (ad, date) so re-syncing gives identical history.
 */
import type { MetaSnapshotRaw, MetaAdsetRaw, MetaAdRaw, MetaInsightRaw } from "../sources/meta";
import type { ShopifySnapshotRaw, ShopifyOrderNode } from "../sources/shopify";
import { dateRange } from "../time";

export const SAMPLE_TZ = "Europe/Ljubljana";
export const SAMPLE_CURRENCY = "EUR";

export interface SampleOverrides {
  adStatus: Record<string, { status: "ACTIVE" | "PAUSED"; since: string }>;
  adsetBudget: Record<string, { budgetMinor: number; since: string }[]>;
}
export const emptyOverrides = (): SampleOverrides => ({ adStatus: {}, adsetBudget: {} });

const ADSETS = [
  { id: "120210000000000101", name: "Prospecting – Broad 25-44", campaign: "PROS | Acne Serum | ABO", budget: 15000 },
  { id: "120210000000000102", name: "Prospecting – LAL 3% Purchasers", campaign: "PROS | Acne Serum | ABO", budget: 10000 },
  { id: "120210000000000103", name: "Retargeting – 30d Engagers", campaign: "RT | All Products", budget: 6000 },
];

// quality = true Shopify ROAS-ish; share = fraction of its ad set's budget
const ADS = [
  { id: "120210000000001001", adset: 0, name: "UGC_Hook-BeforeAfter_Acne_v3", type: "VIDEO", q: 3.6, share: 0.3, s: "Ana", e: "Ben" },
  { id: "120210000000001002", adset: 0, name: "UGC_Derm-Explains_Niacinamide_v1", type: "VIDEO", q: 2.7, share: 0.25, s: "Ana", e: "Lea" },
  { id: "120210000000001003", adset: 0, name: "Static_Testimonial-Grid_v2", type: "PHOTO", q: 1.1, share: 0.2, s: "Marco", e: "Tom" },
  { id: "120210000000001004", adset: 0, name: "Carousel_3-Step-Routine_v1", type: "SHARE", q: 2.1, share: 0.15, s: "Marco", e: "Lea" },
  { id: "120210000000001005", adset: 0, name: "UGC_Unboxing_Founder_v2", type: "VIDEO", q: 0.0, share: 0.1, s: "Ana", e: "Tom" },
  { id: "120210000000001006", adset: 1, name: "UGC_Hook-BeforeAfter_Acne_v3 (LAL)", type: "VIDEO", q: 3.1, share: 0.4, s: "Ana", e: "Ben" },
  { id: "120210000000001007", adset: 1, name: "Static_Price-Anchor_BundleSave", type: "PHOTO", q: 2.4, share: 0.3, s: "Marco", e: "Ben" },
  { id: "120210000000001008", adset: 1, name: "Video_ASMR-Texture_v1", type: "VIDEO", q: 0.9, share: 0.3, s: "Marco", e: "Lea" },
  { id: "120210000000001009", adset: 2, name: "RT_Static_Reviews_v2", type: "PHOTO", q: 5.2, share: 0.45, s: "Ana", e: "Tom" },
  { id: "120210000000001010", adset: 2, name: "RT_UGC_Objection-Sensitive-Skin", type: "VIDEO", q: 4.1, share: 0.35, s: "Marco", e: "Ben" },
  { id: "120210000000001011", adset: 2, name: "RT_Carousel_Bestsellers", type: "SHARE", q: 2.0, share: 0.2, s: "Marco", e: "Tom" },
  // Live in Meta but missing from the owners sheet — the data check should flag it.
  { id: "120210000000001012", adset: 0, name: "TEST_Hook-Variant_Q", type: "VIDEO", q: 1.6, share: 0.0, s: "", e: "" },
];
const AOV_MINOR = 3900; // €39 average order value

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Local wall-clock time in `tz` → UTC ISO string. */
export function zonedToUtcIso(ymd: string, hour: number, minute: number, tz: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(new Date(guess))
      .map((p) => [p.type, p.value]),
  );
  const asLocal = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(guess - (asLocal - guess)).toISOString();
}

const minorToMajor = (n: number) => `${Math.floor(n / 100)}.${String(n % 100).padStart(2, "0")}`;

function budgetOn(adsetIdx: number, date: string, o: SampleOverrides): number {
  const a = ADSETS[adsetIdx];
  const changes = (o.adsetBudget[a.id] ?? []).filter((c) => c.since <= date).sort((x, y) => x.since.localeCompare(y.since));
  return changes.length ? changes[changes.length - 1].budgetMinor : a.budget;
}
function activeOn(adId: string, date: string, o: SampleOverrides): boolean {
  const s = o.adStatus[adId];
  if (!s || s.since > date) return true;
  return s.status === "ACTIVE";
}

export function generateSample(start: string, end: string, overrides: SampleOverrides, today: string) {
  const insights: MetaInsightRaw[] = [];
  const orders: ShopifyOrderNode[] = [];
  let orderSeq = 5000;
  let accountSpendMinor = 0;

  for (const date of dateRange(start, end)) {
    for (const ad of ADS) {
      if (!activeOn(ad.id, date, overrides)) continue;
      const r = rng(hash(ad.id + date));
      const share = ad.share || 0.04;
      const spend = Math.round(budgetOn(ad.adset, date, overrides) * share * (0.85 + r() * 0.3));
      if (spend <= 0) continue;
      accountSpendMinor += spend;
      const impressions = Math.round((spend / 100) * (90 + r() * 40));
      const clicks = Math.round(impressions * (0.008 + r() * 0.012) * (0.6 + ad.q / 6));
      // Shopify-attributed orders driven by creative quality
      const expRevenue = spend * ad.q * (0.7 + r() * 0.6);
      const n = Math.max(0, Math.round(expRevenue / AOV_MINOR + (r() - 0.5)));
      let shopRevenue = 0;
      for (let i = 0; i < n; i++) {
        const total = Math.round(AOV_MINOR * (0.6 + r() * 0.9));
        shopRevenue += total;
        // Bias some orders to late evening local time to exercise the timezone logic
        const hour = r() < 0.25 ? 22 + Math.floor(r() * 2) : 8 + Math.floor(r() * 14);
        orders.push(order(++orderSeq, zonedToUtcIso(date, hour, Math.floor(r() * 60), SAMPLE_TZ), total, "facebook", ad.id));
      }
      // Meta's pixel over-reports vs Shopify (view-through, modelled conversions)
      const metaPurch = Math.round(n * (1.1 + r() * 0.35));
      const metaValue = Math.round(shopRevenue * (1.15 + r() * 0.35));
      insights.push({
        ad_id: ad.id,
        date_start: date,
        date_stop: date,
        spend: minorToMajor(spend),
        impressions: String(impressions),
        clicks: String(clicks),
        actions: [
          { action_type: "link_click", value: String(clicks) },
          { action_type: "omni_purchase", value: String(metaPurch) },
          // Same purchases reported under other names — must not be summed.
          { action_type: "purchase", value: String(metaPurch) },
          { action_type: "offsite_conversion.fb_pixel_purchase", value: String(metaPurch) },
        ],
        action_values: [
          { action_type: "omni_purchase", value: minorToMajor(metaValue) },
          { action_type: "purchase", value: minorToMajor(metaValue) },
        ],
      });
    }
    // Unattributed orders: email, organic, Google
    const r = rng(hash("organic" + date));
    const k = 4 + Math.floor(r() * 5);
    for (let i = 0; i < k; i++) {
      const src = ["klaviyo", "google", null][Math.floor(r() * 3)];
      orders.push(order(++orderSeq, zonedToUtcIso(date, 7 + Math.floor(r() * 16), Math.floor(r() * 60), SAMPLE_TZ), Math.round(AOV_MINOR * (0.6 + r())), src, null));
    }
  }

  const adsets: MetaAdsetRaw[] = ADSETS.map((a, i) => ({
    id: a.id,
    name: a.name,
    status: "ACTIVE",
    daily_budget: String(budgetOn(i, today, overrides)),
    campaign: { name: a.campaign },
  }));
  const ads: MetaAdRaw[] = ADS.map((a) => ({
    id: a.id,
    name: a.name,
    adset_id: ADSETS[a.adset].id,
    status: activeOn(a.id, today, overrides) ? "ACTIVE" : "PAUSED",
    creative: { object_type: a.type },
  }));

  const meta: MetaSnapshotRaw = {
    account: { timezone_name: SAMPLE_TZ, currency: SAMPLE_CURRENCY },
    adsets,
    ads,
    insights,
    accountSpend: minorToMajor(accountSpendMinor),
  };
  const shopify: ShopifySnapshotRaw = { orders, sourceCount: orders.length };
  return { meta, shopify };
}

function order(seq: number, createdAt: string, totalMinor: number, source: string | null, adId: string | null): ShopifyOrderNode {
  return {
    id: `gid://shopify/Order/${seq}`,
    name: `#${seq}`,
    createdAt,
    test: false,
    cancelledAt: null,
    currentTotalPriceSet: { shopMoney: { amount: minorToMajor(totalMinor), currencyCode: SAMPLE_CURRENCY } },
    customAttributes: [
      ...(source ? [{ key: "utm_source", value: source }] : []),
      ...(adId ? [{ key: "utm_content", value: adId }] : []),
    ],
    customerJourneySummary: null,
  };
}

export function sampleOwnersCsv(): string {
  const lines = ["ad_id,ad_name,strategist,editor"];
  for (const a of ADS) if (a.s) lines.push(`${a.id},"${a.name.replace(/"/g, '""')}",${a.s},${a.e}`);
  return lines.join("\n") + "\n";
}

export const SAMPLE_PEOPLE = { strategists: ["Ana", "Marco"], editors: ["Ben", "Lea", "Tom"] };
