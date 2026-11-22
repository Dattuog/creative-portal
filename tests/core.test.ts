import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { dateInTimezone } from "@/lib/time";
import { buildDashboard, derive, emptyTotals } from "@/lib/metrics";
import { majorStringToMinor, parseInsights } from "@/lib/sources/meta";
import { attributionOf, parseOrders, type ShopifyOrderNode } from "@/lib/sources/shopify";
import { parseCsv, parseOwners } from "@/lib/sources/sheet";
import { checkProposals } from "@/lib/agent/guardrails";
import type { Facts } from "@/lib/agent/facts";
import { extractJson } from "@/lib/agent/llm";
import { visibleAdIds } from "@/lib/store/scope";
import { zonedToUtcIso } from "@/lib/sample/generator";
import type { Settings } from "@/lib/types";

describe("time", () => {
  it("puts a late-evening Ljubljana order on the local day, not the UTC day", () => {
    // 23:30 local on Nov 20 (UTC+1) is 22:30 UTC Nov 20; 00:30 local Nov 21 is 23:30 UTC Nov 20
    expect(dateInTimezone("2026-11-20T23:30:00Z", "Europe/Ljubljana")).toBe("2026-11-21");
    expect(dateInTimezone("2026-11-20T22:30:00Z", "Europe/Ljubljana")).toBe("2026-11-20");
  });
  it("converts local wall time to UTC across DST", () => {
    expect(zonedToUtcIso("2026-07-01", 10, 0, "Europe/Ljubljana")).toBe("2026-07-01T08:00:00.000Z");
    expect(zonedToUtcIso("2026-12-01", 10, 0, "Europe/Ljubljana")).toBe("2026-12-01T09:00:00.000Z");
  });
});

describe("money + Meta parsing", () => {
  it("parses decimal strings without float drift", () => {
    expect(majorStringToMinor("0.1")).toBe(10);
    expect(majorStringToMinor("1234.56")).toBe(123456);
    expect(majorStringToMinor("19.9")).toBe(1990);
  });
  it("counts purchases once even when Meta reports several purchase action types", () => {
    const [r] = parseInsights([
      {
        ad_id: "1", date_start: "2026-11-01", date_stop: "2026-11-01", spend: "10.00", impressions: "1000", clicks: "20",
        actions: [
          { action_type: "omni_purchase", value: "3" },
          { action_type: "purchase", value: "3" },
          { action_type: "offsite_conversion.fb_pixel_purchase", value: "3" },
        ],
        action_values: [{ action_type: "omni_purchase", value: "90.00" }, { action_type: "purchase", value: "90.00" }],
      },
    ]);
    expect(r.metaPurchases).toBe(3);
    expect(r.metaPurchaseValueMinor).toBe(9000);
  });
});

describe("metrics", () => {
  it("ROAS is total revenue / total spend, not the average of per-ad ROAS", () => {
    const d = buildDashboard({
      creatives: [
        { adId: "1", adName: "big", adsetId: "s", format: "video", status: "ACTIVE" },
        { adId: "2", adName: "tiny", adsetId: "s", format: "video", status: "ACTIVE" },
      ],
      adsets: [{ adsetId: "s", name: "S", campaignName: "C", status: "ACTIVE", dailyBudgetMinor: 1000 }],
      insights: [
        { adId: "1", date: "2026-11-01", spendMinor: 100000, impressions: 1, clicks: 1, metaPurchases: 0, metaPurchaseValueMinor: 0 },
        { adId: "2", date: "2026-11-01", spendMinor: 100, impressions: 1, clicks: 1, metaPurchases: 0, metaPurchaseValueMinor: 0 },
      ],
      orders: [
        { orderId: "a", createdAt: "", date: "2026-11-01", totalMinor: 100000, currency: "EUR", utmSource: "facebook", attributedAdId: "1" },
        { orderId: "b", createdAt: "", date: "2026-11-01", totalMinor: 1000, currency: "EUR", utmSource: "facebook", attributedAdId: "2" },
      ],
      owners: [],
      start: "2026-11-01",
      end: "2026-11-01",
      includeUnattributed: true,
    });
    // per-ad ROAS: 1.0 and 10.0 → naive average 5.5; correct blended = 101000/100100
    expect(d.total.roas).toBeCloseTo(101000 / 100100, 6);
  });
  it("returns null ratios instead of dividing by zero", () => {
    expect(derive(emptyTotals())).toEqual({ ctr: null, metaRoas: null, roas: null, cpa: null });
  });
});

describe("Shopify attribution", () => {
  const node = (attrs: { key: string; value: string }[], journey: ShopifyOrderNode["customerJourneySummary"] = null): ShopifyOrderNode => ({
    id: "gid://shopify/Order/9", name: "#9", createdAt: "2026-11-20T23:30:00Z", test: false, cancelledAt: null,
    currentTotalPriceSet: { shopMoney: { amount: "39.90", currencyCode: "EUR" } }, customAttributes: attrs, customerJourneySummary: journey,
  });
  it("attributes facebook utm_content ad IDs", () => {
    expect(attributionOf(node([{ key: "utm_source", value: "facebook" }, { key: "utm_content", value: "120210000000001001" }])).adId).toBe("120210000000001001");
  });
  it("ignores non-Meta sources and non-numeric utm_content", () => {
    expect(attributionOf(node([{ key: "utm_source", value: "klaviyo" }, { key: "utm_content", value: "123" }])).adId).toBeNull();
    expect(attributionOf(node([{ key: "utm_source", value: "facebook" }, { key: "utm_content", value: "{{ad.id}}" }])).adId).toBeNull();
  });
  it("prefers the storefront customer journey, and dates in account tz", () => {
    const [o] = parseOrders([node([], { lastVisit: { utmParameters: { source: "ig", content: "555" } } })], "Europe/Ljubljana");
    expect(o.attributedAdId).toBe("555");
    expect(o.date).toBe("2026-11-21");
    expect(o.totalMinor).toBe(3990);
  });
  it("drops test and cancelled orders", () => {
    const n = node([]);
    expect(parseOrders([{ ...n, test: true }, { ...n, cancelledAt: "x" }], "UTC")).toHaveLength(0);
  });
});

describe("owners sheet", () => {
  it("parses quoted CSV", () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\r\n')).toEqual([["a", "b"], ["x, y", 'say "hi"']]);
  });
  it("rejects scientific-notation IDs and duplicates", () => {
    const { owners, problems } = parseOwners("ad_id,strategist,editor\n1.20215E+17,Ana,Ben\n111,Ana,Ben\n111,Marco,Lea\n");
    expect(owners).toHaveLength(1);
    expect(problems).toHaveLength(2);
  });
});

describe("access scoping", () => {
  const owners = [
    { adId: "1", strategist: "Ana", editor: "Ben" },
    { adId: "2", strategist: "Marco", editor: "Ben" },
  ];
  it("editor sees only their ads, admin sees all, blank person sees nothing", () => {
    expect(visibleAdIds({ id: "x", name: "", role: "admin", personName: null }, owners)).toBe("all");
    expect([...(visibleAdIds({ id: "x", name: "", role: "strategist", personName: "ana" }, owners) as Set<string>)]).toEqual(["1"]);
    expect([...(visibleAdIds({ id: "x", name: "", role: "editor", personName: "Ben" }, owners) as Set<string>)]).toEqual(["1", "2"]);
    expect((visibleAdIds({ id: "x", name: "", role: "editor", personName: "" }, owners) as Set<string>).size).toBe(0);
  });
});

describe("agent guardrails", () => {
  const settings: Settings = { accountTimezone: "UTC", currency: "EUR", targetRoas: 2.5, dailyBudgetIncreaseCapMinor: 5000, maxBudgetChangePct: 20 };
  const facts: Facts = {
    start: "2026-11-15", end: "2026-11-21", targetRoas: 2.5, targetCpaMinor: 1560,
    ads: [
      { adId: "10", adName: "loser", adsetId: "1", status: "ACTIVE", spendMinor: 10000, orders: 0, revenueMinor: 0, roas: 0, metaRoas: 1.2, cpaMinor: null },
      { adId: "11", adName: "winner", adsetId: "1", status: "ACTIVE", spendMinor: 30000, orders: 30, revenueMinor: 110000, roas: 3.67, metaRoas: 4.5, cpaMinor: 1000 },
    ],
    adsets: [
      { adsetId: "1", name: "good set", status: "ACTIVE", dailyBudgetMinor: 15000, spendMinor: 40000, orders: 30, revenueMinor: 140000, roas: 3.5 },
      { adsetId: "2", name: "other good set", status: "ACTIVE", dailyBudgetMinor: 20000, spendMinor: 40000, orders: 30, revenueMinor: 140000, roas: 3.5 },
    ],
  };
  it("allows a supported pause and blocks pausing a winner", () => {
    const r = checkProposals(
      [
        { type: "pause_ad", target_id: "10", reason: "no sales" },
        { type: "pause_ad", target_id: "11", reason: "llm thinks so" },
      ],
      facts, settings,
    );
    expect(r.map((x) => x.allowed)).toEqual([true, false]);
  });
  it("blocks unknown IDs, ad IDs used as ad sets, and oversized changes", () => {
    const r = checkProposals(
      [
        { type: "pause_ad", target_id: "999", reason: "" },
        { type: "increase_budget", target_id: "11", change_pct: 10, reason: "" },
        { type: "increase_budget", target_id: "1", change_pct: 50, reason: "" },
        { foo: "bar" },
      ],
      facts, settings,
    );
    expect(r.every((x) => !x.allowed)).toBe(true);
  });
  it("computes budgets in code and enforces the daily increase cap", () => {
    const r = checkProposals(
      [
        { type: "increase_budget", target_id: "1", change_pct: 20, reason: "" }, // +30.00
        { type: "increase_budget", target_id: "2", change_pct: 20, reason: "" }, // +40.00 → over €50 cap
      ],
      facts, settings,
    );
    expect(r[0]).toMatchObject({ allowed: true, fromBudgetMinor: 15000, toBudgetMinor: 18000 });
    expect(r[1].allowed).toBe(false);
    expect(r[1].blockReason).toMatch(/cap/);
  });
});

describe("LLM output parsing", () => {
  it("extracts JSON from think-blocks and code fences", () => {
    const t = '<think>maybe {"x":1}</think>Sure!\n```json\n{"summary":"ok","actions":[{"a":"}"}]}\n```';
    expect(extractJson(t)).toEqual({ summary: "ok", actions: [{ a: "}" }] });
  });
});

describe("end-to-end on sample data", () => {
  beforeEach(() => {
    process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "cpp-"));
    delete process.env.OPENROUTER_API_KEY;
  });
  it("syncs, verifies, runs the agent (rules fallback) and applies an approval", async () => {
    const { LocalStore } = await import("@/lib/store/local");
    const { runSync } = await import("@/lib/sync");
    const { runAgent } = await import("@/lib/agent/run");
    const { decide } = await import("@/lib/agent/execute");
    const store = new LocalStore();
    const run = await runSync(store, new Date("2026-11-22T12:00:00Z"));
    expect(run.error).toBeNull();
    expect(run.verified).toBe(true);
    expect(run.checks.find((c) => c.name.startsWith("Every ad has an owner"))?.passed).toBe(false); // TEST_ ad is unassigned
    const out = await runAgent(store, new Date("2026-11-22T12:00:00Z"));
    if ("error" in out) throw new Error(out.error);
    expect(out.report.model).toMatch(/^rules-only/);
    const pending = out.actions.filter((a) => a.status === "pending");
    expect(pending.length).toBeGreaterThan(0);
    const pauses = pending.filter((a) => a.type === "pause_ad");
    expect(pauses.map((p) => p.targetName)).toContain("UGC_Unboxing_Founder_v2"); // the zero-sales spender
    expect(pauses.map((p) => p.targetName)).not.toContain("RT_Static_Reviews_v2"); // never the best ad
    const pause = pauses.find((p) => p.targetName === "UGC_Unboxing_Founder_v2")!;
    const editor = { id: "e", name: "Ben", role: "editor" as const, personName: "Ben" };
    await expect(decide(store, editor, pause.id, "approve")).rejects.toThrow(/Only admins/);
    const admin = { id: "a", name: "Admin", role: "admin" as const, personName: null };
    const res = await decide(store, admin, pause.id, "approve");
    expect(res.status).toBe("executed");
    const creatives = await store.getCreatives(admin);
    expect(creatives.find((c) => c.adId === pause.targetId)?.status).toBe("PAUSED");
  });
});

describe("Shopify client credentials", () => {
  it("exchanges client id/secret for a token and caches it until near expiry", async () => {
    process.env.SHOPIFY_STORE_DOMAIN = "demo.myshopify.com";
    process.env.SHOPIFY_CLIENT_ID = "id";
    process.env.SHOPIFY_CLIENT_SECRET = "secret";
    delete process.env.SHOPIFY_ADMIN_TOKEN;
    const { shopifyAccessToken, resetShopifyTokenCache } = await import("@/lib/sources/shopify");
    resetShopifyTokenCache();
    const calls: { url: string; body: string }[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body) });
      return new Response(JSON.stringify({ access_token: `tok${calls.length}`, scope: "read_orders,write_orders", expires_in: 86399 }), { status: 200 });
    }) as typeof fetch;
    try {
      const t0 = Date.now();
      expect(await shopifyAccessToken(t0)).toBe("tok1");
      expect(await shopifyAccessToken(t0 + 60_000)).toBe("tok1"); // cached
      expect(await shopifyAccessToken(t0 + 86_200_000)).toBe("tok2"); // refreshed near expiry
      expect(calls[0].url).toBe("https://demo.myshopify.com/admin/oauth/access_token");
      expect(calls[0].body).toContain("grant_type=client_credentials");
    } finally {
      globalThis.fetch = orig;
    }
  });
});
