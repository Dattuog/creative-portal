import { promises as fs } from "fs";
import path from "path";
import type { Store } from "./types";
import type {
  AdSet, AgentAction, AgentReport, Creative, InsightRow, OrderRow, OwnerRow, Settings, SyncRun, Viewer,
} from "../types";
import { env } from "../env";
import { canSee, visibleAdIds } from "./scope";
import { inWindow } from "../metrics";
import { SAMPLE_CURRENCY, SAMPLE_TZ } from "../sample/generator";

interface DB {
  settings: Settings;
  adsets: AdSet[];
  creatives: Creative[];
  insights: InsightRow[];
  orders: OrderRow[];
  owners: OwnerRow[];
  syncRuns: SyncRun[];
  reports: AgentReport[];
  actions: AgentAction[];
  kv: Record<string, unknown>;
}

export const DEFAULT_SETTINGS: Settings = {
  accountTimezone: SAMPLE_TZ,
  currency: SAMPLE_CURRENCY,
  targetRoas: 2.5,
  dailyBudgetIncreaseCapMinor: 5000, // €50/day across all agent proposals
  maxBudgetChangePct: 20,
};

const empty = (): DB => ({
  settings: DEFAULT_SETTINGS,
  adsets: [],
  creatives: [],
  insights: [],
  orders: [],
  owners: [],
  syncRuns: [],
  reports: [],
  actions: [],
  kv: {},
});

/** JSON-file store for running without Supabase (local dev / demo). */
export class LocalStore implements Store {
  kind = "local" as const;
  private file = path.join(env.dataDir(), "db.json");
  private lock: Promise<unknown> = Promise.resolve();

  private async read(): Promise<DB> {
    try {
      return { ...empty(), ...JSON.parse(await fs.readFile(this.file, "utf8")) };
    } catch {
      return empty();
    }
  }
  private async mutate(fn: (db: DB) => void) {
    const run = this.lock.then(async () => {
      const db = await this.read();
      fn(db);
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = this.file + ".tmp";
      await fs.writeFile(tmp, JSON.stringify(db));
      await fs.rename(tmp, this.file);
    });
    this.lock = run.catch(() => {});
    return run;
  }

  async getSettings() {
    return (await this.read()).settings;
  }
  async saveSettings(s: Settings) {
    await this.mutate((db) => (db.settings = s));
  }

  async getOwners(v: Viewer) {
    const db = await this.read();
    const vis = visibleAdIds(v, db.owners);
    return db.owners.filter((o) => canSee(vis, o.adId));
  }
  async getCreatives(v: Viewer) {
    const db = await this.read();
    const vis = visibleAdIds(v, db.owners);
    return db.creatives.filter((c) => canSee(vis, c.adId));
  }
  async getAdsets(v: Viewer) {
    const db = await this.read();
    const vis = visibleAdIds(v, db.owners);
    const ids = new Set(db.creatives.filter((c) => canSee(vis, c.adId)).map((c) => c.adsetId));
    return db.adsets.filter((a) => ids.has(a.adsetId));
  }
  async getInsights(v: Viewer, start: string, end: string) {
    const db = await this.read();
    const vis = visibleAdIds(v, db.owners);
    return db.insights.filter((r) => inWindow(r.date, start, end) && canSee(vis, r.adId));
  }
  async getOrders(v: Viewer, start: string, end: string) {
    const db = await this.read();
    const vis = visibleAdIds(v, db.owners);
    return db.orders.filter((o) => inWindow(o.date, start, end) && canSee(vis, o.attributedAdId));
  }

  async writeSnapshot(d: Parameters<Store["writeSnapshot"]>[0]) {
    await this.mutate((db) => {
      db.adsets = d.adsets;
      db.creatives = d.creatives;
      db.owners = d.owners;
      db.insights = db.insights.filter((r) => !inWindow(r.date, d.start, d.end)).concat(d.insights);
      db.orders = db.orders.filter((o) => !inWindow(o.date, d.start, d.end)).concat(d.orders);
    });
  }

  async saveSyncRun(r: SyncRun) {
    await this.mutate((db) => {
      db.syncRuns.push(r);
      db.syncRuns = db.syncRuns.slice(-50);
    });
  }
  async getLatestSyncRun() {
    const db = await this.read();
    return db.syncRuns.at(-1) ?? null;
  }

  async saveReport(r: AgentReport, actions: AgentAction[]) {
    await this.mutate((db) => {
      db.reports.push(r);
      db.actions.push(...actions);
    });
  }
  async getLatestReport() {
    return (await this.read()).reports.at(-1) ?? null;
  }
  async getActions(reportId: string) {
    return (await this.read()).actions.filter((a) => a.reportId === reportId);
  }
  async getAction(id: string) {
    return (await this.read()).actions.find((a) => a.id === id) ?? null;
  }
  async updateAction(id: string, patch: Partial<AgentAction>) {
    await this.mutate((db) => {
      const a = db.actions.find((x) => x.id === id);
      if (a) Object.assign(a, patch);
    });
  }
  async updateCreativeStatus(adId: string, status: "ACTIVE" | "PAUSED") {
    await this.mutate((db) => {
      const c = db.creatives.find((x) => x.adId === adId);
      if (c) c.status = status;
    });
  }
  async updateAdsetBudget(adsetId: string, budgetMinor: number) {
    await this.mutate((db) => {
      const a = db.adsets.find((x) => x.adsetId === adsetId);
      if (a) a.dailyBudgetMinor = budgetMinor;
    });
  }
  async kvGet<T>(key: string) {
    return ((await this.read()).kv[key] as T) ?? null;
  }
  async kvSet<T>(key: string, value: T) {
    await this.mutate((db) => (db.kv[key] = value));
  }
}
