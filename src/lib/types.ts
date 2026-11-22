// All money is stored as integer minor units (cents) to avoid float drift.

export type Role = "admin" | "strategist" | "editor";

export interface Viewer {
  id: string;
  name: string;
  role: Role;
  /** Person name as it appears in the owners sheet (strategist/editor column). */
  personName: string | null;
}

export interface Settings {
  accountTimezone: string; // Meta ad account timezone, e.g. "Europe/Ljubljana"
  currency: string; // ISO code, e.g. "EUR"
  targetRoas: number; // e.g. 2.5
  /** Max total daily budget increase the agent may propose per run (minor units). */
  dailyBudgetIncreaseCapMinor: number;
  /** Max % change to a single ad set budget in one action. */
  maxBudgetChangePct: number;
}

export interface AdSet {
  adsetId: string;
  name: string;
  campaignName: string;
  status: "ACTIVE" | "PAUSED";
  dailyBudgetMinor: number;
}

export interface Creative {
  adId: string;
  adName: string;
  adsetId: string;
  format: string;
  status: "ACTIVE" | "PAUSED";
}

export interface InsightRow {
  adId: string;
  date: string; // YYYY-MM-DD in ad account timezone
  spendMinor: number;
  impressions: number;
  clicks: number;
  metaPurchases: number;
  metaPurchaseValueMinor: number;
}

export interface OrderRow {
  orderId: string;
  createdAt: string; // ISO UTC from Shopify
  date: string; // YYYY-MM-DD converted to ad account timezone
  totalMinor: number;
  currency: string;
  utmSource: string | null;
  attributedAdId: string | null; // from utm_content={{ad.id}}
}

export interface OwnerRow {
  adId: string;
  strategist: string;
  editor: string;
}

export interface CheckResult {
  name: string;
  critical: boolean;
  sourceValue: number;
  dbValue: number;
  diffPct: number;
  passed: boolean;
  note: string;
}

export interface SyncRun {
  id: string;
  startedAt: string;
  finishedAt: string;
  mode: { meta: "live" | "sample"; shopify: "live" | "sample"; sheet: "live" | "sample" };
  windowStart: string;
  windowEnd: string;
  rows: { creatives: number; insights: number; orders: number; owners: number };
  checks: CheckResult[];
  verified: boolean;
  error: string | null;
}

export type ActionType = "pause_ad" | "increase_budget" | "decrease_budget";
export type ActionStatus = "pending" | "approved" | "rejected" | "executed" | "failed" | "blocked";

export interface AgentAction {
  id: string;
  reportId: string;
  type: ActionType;
  targetId: string; // ad_id for pause, adset_id for budget
  targetName: string;
  changePct: number | null;
  fromBudgetMinor: number | null;
  toBudgetMinor: number | null;
  reason: string;
  status: ActionStatus;
  /** Why guardrails blocked it, or the execution result. */
  statusNote: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface AgentReport {
  id: string;
  createdAt: string;
  model: string; // e.g. nvidia/nemotron-... or "rules-only"
  summary: string;
  windowStart: string;
  windowEnd: string;
  /** LLM proposals rejected by guardrails, kept for audit. */
  blockedCount: number;
}
