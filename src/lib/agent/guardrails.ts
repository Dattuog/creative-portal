import { z } from "zod";
import type { ActionType, Settings } from "../types";
import { decreaseEvidence, increaseEvidence, pauseEvidence, type Facts } from "./facts";

/** What the LLM is allowed to propose. It never sets absolute budgets — code computes those. */
export const ProposalSchema = z.object({
  type: z.enum(["pause_ad", "increase_budget", "decrease_budget"]),
  target_id: z.string().regex(/^\d+$/),
  change_pct: z.number().optional().nullable(),
  reason: z.string().max(400),
});
export const AgentOutputSchema = z.object({
  summary: z.string().min(1).max(2000),
  actions: z.array(z.unknown()).max(20),
});
export type Proposal = z.infer<typeof ProposalSchema>;

export interface CheckedProposal {
  type: ActionType;
  targetId: string;
  targetName: string;
  changePct: number | null;
  fromBudgetMinor: number | null;
  toBudgetMinor: number | null;
  reason: string;
  allowed: boolean;
  blockReason: string | null;
}

const withEvidence = (reason: string, ev: string) => (reason.includes(ev) ? reason : `${reason} [verified: ${ev}]`);
const roundBudget = (n: number) => Math.max(100, Math.round(n / 100) * 100); // whole currency units

/**
 * Every LLM proposal passes through here. Anything not backed by the numbers,
 * outside the limits, or pointing at an unknown/paused object is blocked and
 * kept for audit — it is never shown as an approvable action.
 */
export function checkProposals(raw: unknown[], f: Facts, s: Settings, alreadyIncreasedTodayMinor = 0): CheckedProposal[] {
  const out: CheckedProposal[] = [];
  const touched = new Set<string>();
  let increaseUsed = alreadyIncreasedTodayMinor;

  for (const item of raw) {
    const parsed = ProposalSchema.safeParse(item);
    if (!parsed.success) {
      out.push({
        type: "pause_ad", targetId: "?", targetName: "(malformed)", changePct: null, fromBudgetMinor: null, toBudgetMinor: null,
        reason: JSON.stringify(item).slice(0, 200), allowed: false, blockReason: "Malformed proposal (schema validation failed)",
      });
      continue;
    }
    const p = parsed.data;
    const block = (name: string, why: string, extra: Partial<CheckedProposal> = {}): void => {
      out.push({
        type: p.type, targetId: p.target_id, targetName: name, changePct: p.change_pct ?? null,
        fromBudgetMinor: null, toBudgetMinor: null, reason: p.reason, allowed: false, blockReason: why, ...extra,
      });
    };

    if (touched.has(p.target_id)) {
      block(p.target_id, "Duplicate action on the same target");
      continue;
    }

    if (p.type === "pause_ad") {
      const ad = f.ads.find((a) => a.adId === p.target_id);
      if (!ad) { block(p.target_id, "Unknown ad ID (not in this account)"); continue; }
      if (ad.status !== "ACTIVE") { block(ad.adName, "Ad is already paused"); continue; }
      const ev = pauseEvidence(ad, f);
      if (!ev) { block(ad.adName, "Numbers don't support pausing this ad (would pause a performing creative)"); continue; }
      touched.add(p.target_id);
      out.push({
        type: "pause_ad", targetId: ad.adId, targetName: ad.adName, changePct: null, fromBudgetMinor: null, toBudgetMinor: null,
        reason: withEvidence(p.reason, ev), allowed: true, blockReason: null,
      });
      continue;
    }

    // Budget changes
    const set = f.adsets.find((x) => x.adsetId === p.target_id);
    if (!set) { block(p.target_id, "Unknown ad set ID (budget actions target ad sets)"); continue; }
    if (set.status !== "ACTIVE") { block(set.name, "Ad set is paused"); continue; }
    const pctReq = p.change_pct ?? NaN;
    if (!Number.isFinite(pctReq) || pctReq <= 0) { block(set.name, "change_pct must be a positive number"); continue; }
    if (pctReq > s.maxBudgetChangePct) {
      block(set.name, `Change of ${pctReq}% exceeds the ${s.maxBudgetChangePct}% per-action limit`);
      continue;
    }
    const ev = p.type === "increase_budget" ? increaseEvidence(set, f) : decreaseEvidence(set, f);
    if (!ev) { block(set.name, `Numbers don't support ${p.type === "increase_budget" ? "scaling" : "cutting"} this ad set`); continue; }

    const from = set.dailyBudgetMinor;
    const to = roundBudget(p.type === "increase_budget" ? from * (1 + pctReq / 100) : from * (1 - pctReq / 100));
    if (p.type === "increase_budget") {
      const delta = to - from;
      if (increaseUsed + delta > s.dailyBudgetIncreaseCapMinor) {
        block(set.name, `Would exceed the daily budget-increase cap (${increaseUsed + delta} > ${s.dailyBudgetIncreaseCapMinor} minor units)`, {
          fromBudgetMinor: from, toBudgetMinor: to,
        });
        continue;
      }
      increaseUsed += delta;
    }
    touched.add(p.target_id);
    out.push({
      type: p.type, targetId: set.adsetId, targetName: set.name, changePct: pctReq, fromBudgetMinor: from, toBudgetMinor: to,
      reason: withEvidence(p.reason, ev), allowed: true, blockReason: null,
    });
  }
  return out;
}

/** Rule-based proposals: used as the LLM's starting point and as the fallback if the LLM fails. */
export function ruleProposals(f: Facts, s: Settings): Proposal[] {
  const out: Proposal[] = [];
  for (const ad of f.ads) {
    const ev = pauseEvidence(ad, f);
    if (ev) out.push({ type: "pause_ad", target_id: ad.adId, change_pct: null, reason: `${ev}.` });
  }
  const pct = Math.min(20, s.maxBudgetChangePct);
  for (const set of [...f.adsets].sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0))) {
    if (increaseEvidence(set, f)) out.push({ type: "increase_budget", target_id: set.adsetId, change_pct: pct, reason: `${increaseEvidence(set, f)}.` });
    else if (decreaseEvidence(set, f)) out.push({ type: "decrease_budget", target_id: set.adsetId, change_pct: pct, reason: `${decreaseEvidence(set, f)}.` });
  }
  return out;
}
