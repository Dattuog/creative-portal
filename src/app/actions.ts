"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { DEMO_COOKIE, getStore, getViewer, supabaseUserClient } from "@/lib/session";
import { env } from "@/lib/env";
import { runSync } from "@/lib/sync";
import { runAgent } from "@/lib/agent/run";
import { canDecide, decide } from "@/lib/agent/execute";
import { createShopifyOrder } from "@/lib/sources/shopify";

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

export async function createTestOrderNow(): Promise<ActionState> {
  const viewer = await getViewer();
  if (!viewer || viewer.role !== "admin") return { ok: false, message: "Only admins can create test orders." };
  if (!env.shopifyLive()) return { ok: false, message: "Shopify is not connected." };
  try {
    const store = await getStore();
    const [creatives, settings] = await Promise.all([store.getCreatives(viewer), store.getSettings()]);
    const active = creatives.filter((c) => c.status === "ACTIVE");
    const ad = active[Math.floor(Math.random() * active.length)] ?? creatives[0];
    const cents = 2900 + Math.floor(Math.random() * 3000);
    await createShopifyOrder({
      totalMajor: `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`,
      currency: settings.currency,
      processedAt: new Date().toISOString(),
      utmSource: "facebook",
      utmContent: ad?.adId,
    });
    revalidatePath("/checks");
    return { ok: true, message: `Test order created in Shopify for ${ad?.adName ?? "an ad"}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not create the order." };
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
