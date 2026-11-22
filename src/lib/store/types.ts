import type {
  AdSet, AgentAction, AgentReport, Creative, InsightRow, OrderRow, OwnerRow, Settings, SyncRun, Viewer,
} from "../types";

/**
 * Storage boundary. Reads take a Viewer and must only return rows that viewer
 * may see (Supabase: enforced by RLS; local sample store: mirrored in code).
 * Writes are server-only and run with system privileges.
 */
export interface Store {
  kind: "supabase" | "local";

  getSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;

  getAdsets(v: Viewer): Promise<AdSet[]>;
  getCreatives(v: Viewer): Promise<Creative[]>;
  getInsights(v: Viewer, start: string, end: string): Promise<InsightRow[]>;
  getOrders(v: Viewer, start: string, end: string): Promise<OrderRow[]>;
  getOwners(v: Viewer): Promise<OwnerRow[]>;

  /** Replace snapshot data for the window (idempotent: re-running a sync never double counts). */
  writeSnapshot(d: {
    adsets: AdSet[];
    creatives: Creative[];
    insights: InsightRow[];
    orders: OrderRow[];
    owners: OwnerRow[];
    start: string;
    end: string;
  }): Promise<void>;

  saveSyncRun(r: SyncRun): Promise<void>;
  getLatestSyncRun(): Promise<SyncRun | null>;

  saveReport(r: AgentReport, actions: AgentAction[]): Promise<void>;
  getLatestReport(): Promise<AgentReport | null>;
  getActions(reportId: string): Promise<AgentAction[]>;
  getAction(id: string): Promise<AgentAction | null>;
  updateAction(id: string, patch: Partial<AgentAction>): Promise<void>;

  updateCreativeStatus(adId: string, status: "ACTIVE" | "PAUSED"): Promise<void>;
  updateAdsetBudget(adsetId: string, budgetMinor: number): Promise<void>;

  kvGet<T>(key: string): Promise<T | null>;
  kvSet<T>(key: string, value: T): Promise<void>;
}

export const SYSTEM_VIEWER: Viewer = { id: "system", name: "System", role: "admin", personName: null };
