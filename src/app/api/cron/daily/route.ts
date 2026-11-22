import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { getSystemStore } from "@/lib/session";
import { runSync } from "@/lib/sync";
import { runAgent } from "@/lib/agent/run";

export const maxDuration = 300;

/** Vercel Cron: sync all sources, then (only if verified) run the agent. Proposals still wait for a human. */
export async function GET(req: NextRequest) {
  const secret = env.cronSecret();
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const store = getSystemStore();
  const sync = await runSync(store);
  if (!sync.verified) return NextResponse.json({ sync: { verified: false, error: sync.error }, agent: "skipped: data unverified" });
  const agent = await runAgent(store);
  return NextResponse.json({
    sync: { verified: true, rows: sync.rows },
    agent: "error" in agent ? agent.error : { model: agent.report.model, actions: agent.actions.length },
  });
}
