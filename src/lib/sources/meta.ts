import type { AdSet, Creative, InsightRow } from "../types";
import { env } from "../env";

/* ---------- Raw Graph API shapes (what Meta actually returns) ---------- */

export interface MetaAction {
  action_type: string;
  value: string;
}
export interface MetaInsightRaw {
  ad_id: string;
  date_start: string; // in ad account timezone
  date_stop: string;
  spend: string; // decimal string in MAJOR units, e.g. "12.34"
  impressions: string;
  clicks: string;
  actions?: MetaAction[];
  action_values?: MetaAction[];
}
export interface MetaAdsetRaw {
  id: string;
  name: string;
  status: string;
  daily_budget?: string; // MINOR units (cents) as a string — different from insights!
  campaign?: { name: string };
}
export interface MetaAdRaw {
  id: string;
  name: string;
  adset_id: string;
  status: string;
  creative?: { object_type?: string };
}
export interface MetaAccountRaw {
  timezone_name: string;
  currency: string;
}

export interface MetaSnapshotRaw {
  account: MetaAccountRaw;
  adsets: MetaAdsetRaw[];
  ads: MetaAdRaw[];
  insights: MetaInsightRaw[];
  /** Independent account-level spend total for the same window (used by the data check). */
  accountSpend: string;
}

/* ---------- Parsing (shared by live + sample so both run the same code path) ---------- */

/** Meta insights money is a decimal string in major units. Convert without float drift. */
export function majorStringToMinor(s: string | undefined): number {
  if (!s) return 0;
  const neg = s.trim().startsWith("-");
  const [int, frac = ""] = s.trim().replace("-", "").split(".");
  const cents = Number(int) * 100 + Number((frac + "00").slice(0, 2));
  return neg ? -cents : cents;
}

// One purchase action type only — summing "purchase" + "omni_purchase" +
// "offsite_conversion.fb_pixel_purchase" double/triple counts the same order.
const PURCHASE_TYPES = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"];

function pickPurchase(list: MetaAction[] | undefined): string | undefined {
  if (!list) return undefined;
  for (const t of PURCHASE_TYPES) {
    const hit = list.find((a) => a.action_type === t);
    if (hit) return hit.value;
  }
  return undefined;
}

export function parseInsights(raw: MetaInsightRaw[]): InsightRow[] {
  return raw.map((r) => ({
    adId: r.ad_id,
    date: r.date_start,
    spendMinor: majorStringToMinor(r.spend),
    impressions: Number(r.impressions || 0),
    clicks: Number(r.clicks || 0),
    metaPurchases: Math.round(Number(pickPurchase(r.actions) ?? 0)),
    metaPurchaseValueMinor: majorStringToMinor(pickPurchase(r.action_values)),
  }));
}

const normStatus = (s: string): "ACTIVE" | "PAUSED" => (s === "ACTIVE" ? "ACTIVE" : "PAUSED");

export function parseAdsets(raw: MetaAdsetRaw[]): AdSet[] {
  return raw.map((a) => ({
    adsetId: a.id,
    name: a.name,
    campaignName: a.campaign?.name ?? "",
    status: normStatus(a.status),
    dailyBudgetMinor: Number(a.daily_budget ?? 0), // already minor units
  }));
}

export function parseAds(raw: MetaAdRaw[]): Creative[] {
  return raw.map((a) => ({
    adId: a.id,
    adName: a.name,
    adsetId: a.adset_id,
    status: normStatus(a.status),
    format: (a.creative?.object_type ?? "UNKNOWN").toLowerCase(),
  }));
}

/* ---------- Live Graph API client ---------- */

function base() {
  return `https://graph.facebook.com/${env.metaApiVersion()}`;
}

async function graphGetAll<T>(path: string, params: Record<string, string>): Promise<T[]> {
  const token = env.metaToken();
  const url = new URL(`${base()}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token!);
  const out: T[] = [];
  let next: string | null = url.toString();
  let pages = 0;
  while (next) {
    if (++pages > 50) throw new Error(`Meta pagination exceeded 50 pages for ${path}`);
    const res: Response = await fetch(next, { cache: "no-store" });
    const body = await res.json();
    if (!res.ok || body.error) {
      throw new Error(`Meta API ${path}: ${body.error?.message ?? res.status}`);
    }
    out.push(...(body.data ?? []));
    next = body.paging?.next ?? null;
  }
  return out;
}

async function graphGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${base()}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", env.metaToken()!);
  const res = await fetch(url, { cache: "no-store" });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(`Meta API ${path}: ${body.error?.message ?? res.status}`);
  return body as T;
}

export async function fetchMetaLive(start: string, end: string): Promise<MetaSnapshotRaw> {
  const act = env.metaAdAccountId()!; // "act_123"
  const timeRange = JSON.stringify({ since: start, until: end });
  const [account, adsets, ads, insights, acctIns] = await Promise.all([
    graphGet<MetaAccountRaw>(act, { fields: "timezone_name,currency" }),
    graphGetAll<MetaAdsetRaw>(`${act}/adsets`, { fields: "id,name,status,daily_budget,campaign{name}", limit: "200" }),
    graphGetAll<MetaAdRaw>(`${act}/ads`, { fields: "id,name,adset_id,status,creative{object_type}", limit: "200" }),
    graphGetAll<MetaInsightRaw>(`${act}/insights`, {
      level: "ad",
      fields: "ad_id,spend,impressions,clicks,actions,action_values",
      time_range: timeRange,
      time_increment: "1",
      limit: "500",
    }),
    graphGetAll<{ spend: string }>(`${act}/insights`, { level: "account", fields: "spend", time_range: timeRange }),
  ]);
  return { account, adsets, ads, insights, accountSpend: acctIns[0]?.spend ?? "0" };
}

/* ---------- Writes (only ever called after a human approves) ---------- */

export async function metaPauseAd(adId: string) {
  return graphPost(adId, { status: "PAUSED" });
}
export async function metaSetAdsetBudget(adsetId: string, dailyBudgetMinor: number) {
  return graphPost(adsetId, { daily_budget: String(dailyBudgetMinor) });
}
async function graphPost(id: string, fields: Record<string, string>) {
  const body = new URLSearchParams({ ...fields, access_token: env.metaToken()! });
  const res = await fetch(`${base()}/${id}`, { method: "POST", body, cache: "no-store" });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(`Meta API POST ${id}: ${json.error?.message ?? res.status}`);
  return json;
}
