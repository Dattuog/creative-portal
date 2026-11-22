import type { SupabaseClient } from "@supabase/supabase-js";
import type { Store } from "./types";
import type {
  AdSet, AgentAction, AgentReport, Creative, InsightRow, OrderRow, OwnerRow, Settings, SyncRun, Viewer,
} from "../types";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Reads use the signed-in user's client, so Postgres RLS decides what they see.
 * Writes (sync, agent, approved actions) use the service-role client on the server only.
 */
export class SupabaseStore implements Store {
  kind = "supabase" as const;
  constructor(
    private user: SupabaseClient | null,
    private admin: SupabaseClient,
  ) {}

  private r(v: Viewer): SupabaseClient {
    if (v.id === "system") return this.admin;
    if (!this.user) throw new Error("No signed-in user");
    return this.user;
  }

  private async all(q: () => any): Promise<any[]> {
    const out: any[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await q().range(from, from + 999);
      if (error) throw new Error(error.message);
      out.push(...data);
      if (data.length < 1000) return out;
    }
  }
  private async chunked(table: string, rows: any[], onConflict: string) {
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await this.admin.from(table).upsert(rows.slice(i, i + 500), { onConflict });
      if (error) throw new Error(`${table}: ${error.message}`);
    }
  }

  async getSettings(): Promise<Settings> {
    const { data, error } = await this.admin.from("settings").select("*").eq("id", 1).single();
    if (error) throw new Error(error.message);
    return {
      accountTimezone: data.account_timezone,
      currency: data.currency,
      targetRoas: Number(data.target_roas),
      dailyBudgetIncreaseCapMinor: Number(data.daily_budget_increase_cap_minor),
      maxBudgetChangePct: Number(data.max_budget_change_pct),
    };
  }
  async saveSettings(s: Settings) {
    const { error } = await this.admin.from("settings").upsert({
      id: 1,
      account_timezone: s.accountTimezone,
      currency: s.currency,
      target_roas: s.targetRoas,
      daily_budget_increase_cap_minor: s.dailyBudgetIncreaseCapMinor,
      max_budget_change_pct: s.maxBudgetChangePct,
    });
    if (error) throw new Error(error.message);
  }

  async getAdsets(v: Viewer): Promise<AdSet[]> {
    const rows = await this.all(() => this.r(v).from("adsets").select("*").order("adset_id"));
    return rows.map((a) => ({
      adsetId: a.adset_id, name: a.name, campaignName: a.campaign_name, status: a.status, dailyBudgetMinor: Number(a.daily_budget_minor),
    }));
  }
  async getCreatives(v: Viewer): Promise<Creative[]> {
    const rows = await this.all(() => this.r(v).from("creatives").select("*").order("ad_id"));
    return rows.map((c) => ({ adId: c.ad_id, adName: c.ad_name, adsetId: c.adset_id, format: c.format, status: c.status }));
  }
  async getInsights(v: Viewer, start: string, end: string): Promise<InsightRow[]> {
    const rows = await this.all(() =>
      this.r(v).from("meta_insights_daily").select("*").gte("date", start).lte("date", end).order("date").order("ad_id"),
    );
    return rows.map((r) => ({
      adId: r.ad_id, date: r.date, spendMinor: Number(r.spend_minor), impressions: Number(r.impressions), clicks: Number(r.clicks),
      metaPurchases: Number(r.meta_purchases), metaPurchaseValueMinor: Number(r.meta_purchase_value_minor),
    }));
  }
  async getOrders(v: Viewer, start: string, end: string): Promise<OrderRow[]> {
    const rows = await this.all(() =>
      this.r(v).from("shopify_orders").select("*").gte("date", start).lte("date", end).order("order_id"),
    );
    return rows.map((o) => ({
      orderId: o.order_id, createdAt: o.created_at, date: o.date, totalMinor: Number(o.total_minor), currency: o.currency,
      utmSource: o.utm_source, attributedAdId: o.attributed_ad_id,
    }));
  }
  async getOwners(v: Viewer): Promise<OwnerRow[]> {
    const rows = await this.all(() => this.r(v).from("creative_owners").select("*").order("ad_id"));
    return rows.map((o) => ({ adId: o.ad_id, strategist: o.strategist, editor: o.editor }));
  }

  async writeSnapshot(d: Parameters<Store["writeSnapshot"]>[0]) {
    await this.chunked("adsets", d.adsets.map((a) => ({
      adset_id: a.adsetId, name: a.name, campaign_name: a.campaignName, status: a.status, daily_budget_minor: a.dailyBudgetMinor,
    })), "adset_id");
    await this.chunked("creatives", d.creatives.map((c) => ({
      ad_id: c.adId, ad_name: c.adName, adset_id: c.adsetId, format: c.format, status: c.status,
    })), "ad_id");
    // Owners sheet is the source of truth: replace fully.
    const del = await this.admin.from("creative_owners").delete().neq("ad_id", "");
    if (del.error) throw new Error(del.error.message);
    await this.chunked("creative_owners", d.owners.map((o) => ({ ad_id: o.adId, strategist: o.strategist, editor: o.editor })), "ad_id");
    // Window replace keeps re-syncs idempotent and drops rows deleted at the source.
    for (const [t, col] of [["meta_insights_daily", "date"], ["shopify_orders", "date"]] as const) {
      const { error } = await this.admin.from(t).delete().gte(col, d.start).lte(col, d.end);
      if (error) throw new Error(error.message);
    }
    await this.chunked("meta_insights_daily", d.insights.map((r) => ({
      ad_id: r.adId, date: r.date, spend_minor: r.spendMinor, impressions: r.impressions, clicks: r.clicks,
      meta_purchases: r.metaPurchases, meta_purchase_value_minor: r.metaPurchaseValueMinor,
    })), "ad_id,date");
    await this.chunked("shopify_orders", d.orders.map((o) => ({
      order_id: o.orderId, created_at: o.createdAt, date: o.date, total_minor: o.totalMinor, currency: o.currency,
      utm_source: o.utmSource, attributed_ad_id: o.attributedAdId,
    })), "order_id");
  }

  async saveSyncRun(r: SyncRun) {
    const { error } = await this.admin.from("sync_runs").insert({ id: r.id, started_at: r.startedAt, finished_at: r.finishedAt, payload: r });
    if (error) throw new Error(error.message);
  }
  async getLatestSyncRun(): Promise<SyncRun | null> {
    const { data, error } = await this.admin.from("sync_runs").select("payload").order("finished_at", { ascending: false }).limit(1);
    if (error) throw new Error(error.message);
    return (data?.[0]?.payload as SyncRun) ?? null;
  }

  async saveReport(r: AgentReport, actions: AgentAction[]) {
    const a = await this.admin.from("agent_reports").insert({ id: r.id, created_at: r.createdAt, payload: r });
    if (a.error) throw new Error(a.error.message);
    if (actions.length) {
      const b = await this.admin.from("agent_actions").insert(actions.map((x) => ({ id: x.id, report_id: x.reportId, status: x.status, payload: x })));
      if (b.error) throw new Error(b.error.message);
    }
  }
  async getLatestReport(): Promise<AgentReport | null> {
    const { data, error } = await this.admin.from("agent_reports").select("payload").order("created_at", { ascending: false }).limit(1);
    if (error) throw new Error(error.message);
    return (data?.[0]?.payload as AgentReport) ?? null;
  }
  async getActions(reportId: string): Promise<AgentAction[]> {
    const { data, error } = await this.admin.from("agent_actions").select("payload").eq("report_id", reportId);
    if (error) throw new Error(error.message);
    return (data ?? []).map((d) => d.payload as AgentAction);
  }
  async getAction(id: string): Promise<AgentAction | null> {
    const { data, error } = await this.admin.from("agent_actions").select("payload").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return (data?.payload as AgentAction) ?? null;
  }
  async updateAction(id: string, patch: Partial<AgentAction>) {
    const cur = await this.getAction(id);
    if (!cur) throw new Error("Action not found");
    const next = { ...cur, ...patch };
    const { error } = await this.admin.from("agent_actions").update({ status: next.status, payload: next }).eq("id", id);
    if (error) throw new Error(error.message);
  }
  async updateCreativeStatus(adId: string, status: "ACTIVE" | "PAUSED") {
    const { error } = await this.admin.from("creatives").update({ status }).eq("ad_id", adId);
    if (error) throw new Error(error.message);
  }
  async updateAdsetBudget(adsetId: string, budgetMinor: number) {
    const { error } = await this.admin.from("adsets").update({ daily_budget_minor: budgetMinor }).eq("adset_id", adsetId);
    if (error) throw new Error(error.message);
  }
  async kvGet<T>(key: string): Promise<T | null> {
    const { data, error } = await this.admin.from("kv").select("value").eq("key", key).maybeSingle();
    if (error) throw new Error(error.message);
    return (data?.value as T) ?? null;
  }
  async kvSet<T>(key: string, value: T) {
    const { error } = await this.admin.from("kv").upsert({ key, value });
    if (error) throw new Error(error.message);
  }
}
