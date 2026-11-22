import { redirect } from "next/navigation";
import { getStore, getViewer } from "@/lib/session";
import { canDecide } from "@/lib/agent/execute";
import { env } from "@/lib/env";
import { ago, money } from "@/lib/format";
import { decideAction, runAgentNow } from "../actions";
import type { AgentAction } from "@/lib/types";
import { RunButton } from "@/components/run-button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

const VERB: Record<AgentAction["type"], string> = {
  pause_ad: "Pause ad",
  increase_budget: "Raise ad set budget",
  decrease_budget: "Lower ad set budget",
};

const STATUS: Record<AgentAction["status"], { variant: "warning" | "positive" | "neutral" | "negative"; label: string }> = {
  pending: { variant: "warning", label: "Waiting" },
  approved: { variant: "neutral", label: "Approved" },
  executed: { variant: "positive", label: "Applied" },
  rejected: { variant: "neutral", label: "Rejected" },
  failed: { variant: "negative", label: "Failed" },
  blocked: { variant: "negative", label: "Blocked" },
};

const clean = (reason: string) => reason.replace(/\s*\[verified: .*\]$/, "").replace(/\.$/, "");

export default async function ApprovalsPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!canDecide(viewer)) redirect("/"); // editors don't see budget decisions

  const store = await getStore();
  const [report, settings] = await Promise.all([store.getLatestReport(), store.getSettings()]);
  const actions = report ? await store.getActions(report.id) : [];
  const proposed = actions.filter((a) => a.decidedBy !== "guardrails");
  const blocked = actions.filter((a) => a.decidedBy === "guardrails");
  const waiting = proposed.filter((a) => a.status === "pending").length;
  const cur = settings.currency;
  const appliesTo = env.metaLive() ? (env.metaWriteMode() === "live" ? "Meta" : "Meta, dry run") : "Sample data";
  const byAi = report && !report.model.startsWith("rules-only");

  const limits = [
    ["Change per ad set", `Up to ${settings.maxBudgetChangePct}%`],
    ["New budget per day", `Up to ${money(settings.dailyBudgetIncreaseCapMinor, cur)}`],
    ["Approvals apply to", appliesTo],
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
          <p className="text-muted-foreground">
            {report ? `${waiting} ${waiting === 1 ? "change" : "changes"} waiting. Nothing changes in Meta until you approve.` : "No proposals yet."}
          </p>
        </div>
        <RunButton action={runAgentNow} label="Run agent" pendingLabel="Running" />
      </div>

      {!report ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>No proposals yet</EmptyTitle>
            <EmptyDescription>Run the agent to review the last 7 days of verified data.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">
          <div className="flex flex-col gap-6 xl:col-span-2">
            <Card className="gap-2 pb-2">
              <CardHeader>
                <CardTitle>Proposed changes</CardTitle>
                <CardDescription>
                  {report.windowStart} to {report.windowEnd}
                </CardDescription>
              </CardHeader>
              <CardContent className="px-0">
                {proposed.length === 0 ? (
                  <Empty className="mx-5 mb-3 border">
                    <EmptyHeader>
                      <EmptyTitle>No changes proposed</EmptyTitle>
                      <EmptyDescription>Every creative is within its limits.</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : (
                  <ul className="flex flex-col">
                    {proposed.map((a) => {
                      const s = STATUS[a.status];
                      return (
                        <li key={a.id} className="flex flex-col gap-3 border-t px-5 py-4 first:border-t-0 sm:flex-row sm:items-center">
                          <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">{VERB[a.type]}</span>
                              <span className="truncate text-muted-foreground">{a.targetName}</span>
                              <Badge variant={s.variant}>{s.label}</Badge>
                            </div>
                            <p className="num text-sm text-muted-foreground">
                              {a.fromBudgetMinor !== null && (
                                <>
                                  <span className="text-foreground">
                                    {money(a.fromBudgetMinor, cur)} to {money(a.toBudgetMinor, cur)} a day
                                  </span>
                                  {" · "}
                                </>
                              )}
                              {clean(a.reason)}
                            </p>
                            {a.status !== "pending" && a.statusNote && (
                              <p className="text-xs text-muted-foreground">
                                {a.statusNote}
                                {a.decidedBy ? ` by ${a.decidedBy}` : ""}
                              </p>
                            )}
                          </div>
                          {a.status === "pending" && (
                            <form action={decideAction} className="flex gap-2">
                              <input type="hidden" name="id" value={a.id} />
                              <Button name="decision" value="reject" variant="ghost" size="sm">
                                Reject
                              </Button>
                              <Button name="decision" value="approve" variant="outline" size="sm">
                                Approve
                              </Button>
                            </form>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card className="gap-2 pb-2">
              <CardHeader>
                <CardTitle>Blocked by limits</CardTitle>
                <CardDescription>Proposals the checks rejected before they reached you</CardDescription>
              </CardHeader>
              <CardContent className="px-0">
                {blocked.length === 0 ? (
                  <p className="px-5 pb-3 text-sm text-muted-foreground">None this run.</p>
                ) : (
                  <ul className="flex flex-col">
                    {blocked.map((a) => (
                      <li key={a.id} className="flex flex-col gap-1 border-t px-5 py-3 first:border-t-0">
                        <span>
                          <span className="font-medium">{VERB[a.type]}</span> <span className="text-muted-foreground">{a.targetName}</span>
                        </span>
                        <span className="text-sm text-destructive">{a.statusNote}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Summary</CardTitle>
                <CardAction>
                  <span className="text-xs text-muted-foreground">{ago(report.createdAt)}</span>
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <p className="leading-6 whitespace-pre-line">{report.summary}</p>
                <Separator />
                <p className="text-xs text-muted-foreground">
                  {byAi ? <>Written by <span className="font-mono">{report.model}</span>.</> : "Written by the built-in rules. Add an OpenRouter key for an AI summary."}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Limits</CardTitle>
                <CardDescription>Enforced in code on every proposal</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="num flex flex-col gap-3 text-sm">
                  {limits.map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
