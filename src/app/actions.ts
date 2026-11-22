"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { DEMO_COOKIE, getStore, getViewer, supabaseUserClient } from "@/lib/session";
import { env } from "@/lib/env";
import { runSync } from "@/lib/sync";
import { runAgent } from "@/lib/agent/run";
import { canDecide, decide } from "@/lib/agent/execute";
import { seedShopify } from "@/lib/sample/seed-shopify";

export type ActionState = { ok: boolean; message: string } | null;

export async function setDemoViewer(formData: FormData) {
  if (env.useSupabase()) return; // real logins are used instead
  const v = String(formData.get("viewer") ?? "admin");
  if (!/^(admin|strategist:[A-Za-z]+|editor:[A-Za-z]+)$/.test(v)) return;
  (await cookies()).set(DEMO_COOKIE, v, { httpOnly: true, sameSite: "lax", path: "/" });
  revalidatePath("/", "layout");
}

export async function syncNow(): Promise<ActionState> {
  const viewer = await getViewer();
  if (!viewer || viewer.role !== "admin") return { ok: false, message: "Only admins can run a sync." };
  const run = await runSync(await getStore());
  revalidatePath("/", "layout");
  if (run.error) return { ok: false, message: `Sync failed: ${run.error}` };
  return { ok: run.verified, message: run.verified ? "Synced and verified." : "Synced, but a critical data check failed." };
}

export async function seedShopifyNow(): Promise<ActionState> {
  const viewer = await getViewer();
  if (!viewer || viewer.role !== "admin") return { ok: false, message: "Only admins can load sample orders." };
  try {
    const r = await seedShopify(await getStore());
    revalidatePath("/checks");
    return {
      ok: true,
      message: r.remainingDays > 0
        ? `Added ${r.created} orders. ${r.remainingDays} days left, run it again.`
        : `Added ${r.created} orders. Shopify is filled through ${r.windowEnd}. Sync to see them.`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not load sample orders." };
  }
}

export async function runAgentNow(): Promise<ActionState> {
  const viewer = await getViewer();
  if (!viewer || !canDecide(viewer)) return { ok: false, message: "Only admins and strategists can run the agent." };
  const out = await runAgent(await getStore());
  revalidatePath("/agent");
  if ("error" in out) return { ok: false, message: out.error };
  return { ok: true, message: "Report ready." };
}

export async function decideAction(formData: FormData) {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const id = String(formData.get("id") ?? "");
  const decision = formData.get("decision") === "approve" ? "approve" : "reject";
  try {
    await decide(await getStore(), viewer, id, decision);
  } catch {
    // Surface state via the action row; avoid leaking internals.
  }
  revalidatePath("/", "layout");
}

export async function signIn(_: ActionState, formData: FormData): Promise<ActionState> {
  const sb = await supabaseUserClient();
  const { error } = await sb.auth.signInWithPassword({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  if (error) return { ok: false, message: "Sign-in failed. Check your email and password." };
  redirect("/");
}

export async function signOut() {
  if (env.useSupabase()) await (await supabaseUserClient()).auth.signOut();
  redirect(env.useSupabase() ? "/login" : "/");
}
