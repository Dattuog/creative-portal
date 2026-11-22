import type { OwnerRow, Viewer } from "../types";

/**
 * Mirrors the Supabase RLS policies for the local store:
 *  - admin sees everything
 *  - strategist / editor see only ads assigned to them in the owners sheet
 */
export function visibleAdIds(v: Viewer, owners: OwnerRow[]): Set<string> | "all" {
  if (v.role === "admin") return "all";
  const me = (v.personName ?? "").toLowerCase();
  return new Set(
    owners
      .filter((o) => (v.role === "strategist" ? o.strategist : o.editor).toLowerCase() === me && me !== "")
      .map((o) => o.adId),
  );
}

export const canSee = (vis: Set<string> | "all", adId: string | null) =>
  vis === "all" ? true : adId !== null && vis.has(adId);
