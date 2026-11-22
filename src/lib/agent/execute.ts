import type { Store } from "../store/types";
import { SYSTEM_VIEWER } from "../store/types";
import type { AgentAction, Viewer } from "../types";
import { env } from "../env";
import { metaPauseAd, metaSetAdsetBudget } from "../sources/meta";
import { emptyOverrides, type SampleOverrides } from "../sample/generator";
import { OVERRIDES_KEY } from "../sync";
import { INCREASE_KEY } from "./run";
import { todayInTimezone } from "../time";

export const canDecide = (v: Viewer) => v.role === "admin" || v.role === "strategist";

/**
 * Human decision on one action. Approval re-checks the world first: the
 * budget may have changed since the agent ran, or the daily cap may already
 * be used by another approval.
 */
export async function decide(store: Store, viewer: Viewer, actionId: string, decision: "approve" | "reject"): Promise<AgentAction> {
  if (!canDecide(viewer)) throw new Error("Only admins and strategists can approve or reject actions.");
  const a = await store.getAction(actionId);
  if (!a) throw new Error("Action not found");
  if (a.status !== "pending") throw new Error(`Action is already ${a.status}`);
  const now = new Date().toISOString();

  if (decision === "reject") {
    await store.updateAction(a.id, { status: "rejected", decidedBy: viewer.name, decidedAt: now });
    return { ...a, status: "rejected" };
  }

  const settings = await store.getSettings();
  const day = todayInTimezone(settings.accountTimezone);
  const fail = async (note: string) => {
    await store.updateAction(a.id, { status: "blocked", statusNote: `Re-check at approval: ${note}`, decidedBy: viewer.name, decidedAt: now });
    return { ...a, status: "blocked" as const, statusNote: note };
  };

  if (a.type === "pause_ad") {
    const c = (await store.getCreatives(SYSTEM_VIEWER)).find((x) => x.adId === a.targetId);
    if (!c) return fail("ad no longer exists");
    if (c.status !== "ACTIVE") return fail("ad is already paused");
  } else {
    const s = (await store.getAdsets(SYSTEM_VIEWER)).find((x) => x.adsetId === a.targetId);
    if (!s) return fail("ad set no longer exists");
    if (s.dailyBudgetMinor !== a.fromBudgetMinor) return fail(`budget changed since the report (now ${s.dailyBudgetMinor}, expected ${a.fromBudgetMinor}) — re-run the agent`);
    if (a.type === "increase_budget") {
      const used = (await store.kvGet<number>(INCREASE_KEY(day))) ?? 0;
      const delta = (a.toBudgetMinor ?? 0) - (a.fromBudgetMinor ?? 0);
      if (used + delta > settings.dailyBudgetIncreaseCapMinor) return fail("today's budget-increase cap is already used");
    }
  }

  const live = env.metaLive() && env.metaWriteMode() === "live";
  try {
    if (live) {
      if (a.type === "pause_ad") await metaPauseAd(a.targetId);
      else await metaSetAdsetBudget(a.targetId, a.toBudgetMinor!);
    } else if (!env.metaLive()) {
      // Sample mode: remember the change so the next sync reflects it.
      const o = (await store.kvGet<SampleOverrides>(OVERRIDES_KEY)) ?? emptyOverrides();
      if (a.type === "pause_ad") o.adStatus[a.targetId] = { status: "PAUSED", since: day };
      else (o.adsetBudget[a.targetId] ??= []).push({ budgetMinor: a.toBudgetMinor!, since: day });
      await store.kvSet(OVERRIDES_KEY, o);
    }
    if (a.type === "pause_ad") await store.updateCreativeStatus(a.targetId, "PAUSED");
    else await store.updateAdsetBudget(a.targetId, a.toBudgetMinor!);
    if (a.type === "increase_budget") {
      const used = (await store.kvGet<number>(INCREASE_KEY(day))) ?? 0;
      await store.kvSet(INCREASE_KEY(day), used + (a.toBudgetMinor! - a.fromBudgetMinor!));
    }
    const note = live ? "Applied in Meta" : env.metaLive() ? "Dry run — META_WRITE_MODE is not 'live', Meta was not changed" : "Applied to sample data";
    await store.updateAction(a.id, { status: "executed", statusNote: note, decidedBy: viewer.name, decidedAt: now });
    return { ...a, status: "executed", statusNote: note };
  } catch (e) {
    const note = e instanceof Error ? e.message : String(e);
    await store.updateAction(a.id, { status: "failed", statusNote: note, decidedBy: viewer.name, decidedAt: now });
    return { ...a, status: "failed", statusNote: note };
  }
}
