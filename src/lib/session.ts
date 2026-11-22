import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";
import type { Viewer } from "./types";
import type { Store } from "./store/types";
import { LocalStore } from "./store/local";
import { SupabaseStore } from "./store/supabase";

export const DEMO_COOKIE = "demo_viewer";

export async function supabaseUserClient(): Promise<SupabaseClient> {
  const jar = await cookies();
  return createServerClient(env.supabaseUrl()!, env.supabaseAnonKey()!, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => jar.set(name, value, options));
        } catch {
          // Called from a Server Component; the proxy refreshes the session instead.
        }
      },
    },
  });
}

let adminClient: SupabaseClient | null = null;
function supabaseAdmin(): SupabaseClient {
  // Service role key stays on the server; never exposed to the browser.
  adminClient ??= createClient(env.supabaseUrl()!, env.supabaseServiceKey()!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return adminClient;
}

/** Parses the demo "view as" cookie, e.g. "admin", "strategist:Ana", "editor:Ben". */
export function parseDemoViewer(raw: string | undefined): Viewer {
  const [role, person] = (raw ?? "admin").split(":");
  if (role === "strategist" || role === "editor") {
    const p = (person ?? "").replace(/[^\p{L} .'-]/gu, "").slice(0, 40);
    return { id: `demo-${role}-${p}`, name: `${p} (${role})`, role, personName: p };
  }
  return { id: "demo-admin", name: "Admin", role: "admin", personName: null };
}

/** The signed-in viewer, or null when Supabase auth is on and nobody is signed in. */
export async function getViewer(): Promise<Viewer | null> {
  if (!env.useSupabase()) {
    const jar = await cookies();
    return parseDemoViewer(jar.get(DEMO_COOKIE)?.value);
  }
  const sb = await supabaseUserClient();
  const { data } = await sb.auth.getUser();
  if (!data.user) return null;
  const { data: p, error } = await sb.from("profiles").select("*").eq("user_id", data.user.id).maybeSingle();
  if (error) console.error("profile lookup failed:", error.message);
  if (!p) return null; // signed in but not provisioned (or no access): no access
  return { id: data.user.id, name: p.display_name, role: p.role, personName: p.person_name };
}

export async function getStore(): Promise<Store> {
  if (!env.useSupabase()) return new LocalStore();
  return new SupabaseStore(await supabaseUserClient(), supabaseAdmin());
}

/** Store for background jobs (cron) with no user session. */
export function getSystemStore(): Store {
  if (!env.useSupabase()) return new LocalStore();
  return new SupabaseStore(null, supabaseAdmin());
}
