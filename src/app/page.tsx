import Link from "next/link";
import { redirect } from "next/navigation";
import { getStore, getViewer } from "@/lib/session";
import { latestSync } from "@/lib/ensure";
import { buildDashboard, type DashboardModel, type Row } from "@/lib/metrics";
import { addDays } from "@/lib/time";
import { int, money, ratio } from "@/lib/format";
import { cn } from "@/lib/utils";
import { canDecide } from "@/lib/agent/execute";
import { decideAction, syncNow } from "./actions";
import type { AgentAction } from "@/lib/types";
import { ClaimBar } from "@/components/charts";
import { TrendChart } from "@/components/trend-chart";
import { RangeToggle } from "@/components/range-toggle";
import { RunButton } from "@/components/run-button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

const RANGES = [7, 14, 30] as const;

function finding(d: DashboardModel, cur: string, target: number): string | null {
  const active = d.byCreative.filter((c) => c.status === "ACTIVE");
  const dead = active.filter((c) => c.shopifyOrders === 0 && c.spendMinor > 0).sort((a, b) => b.spendMinor - a.spendMinor)[0];
  if (dead) return `${dead.label} spent ${money(dead.spendMinor, cur)} with no orders.`;
  const weak = active.filter((c) => c.roas !== null && c.roas < target * 0.5).sort((a, b) => b.spendMinor - a.spendMinor)[0];
  if (weak) return `${weak.label} returns ${ratio(weak.roas)} on ${money(weak.spendMinor, cur)}.`;
  const best = active.filter((c) => c.roas !== null).sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0))[0];
  return best ? `${best.label} leads at ${ratio(best.roas)} ROAS.` : null;
}

const change = (now: number | null, prev: number | null) => (now === null || prev === null || prev === 0 ? null : now / prev - 1);

export default async function Performance({ searchParams }: PageProps<"/">) {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const store = await getStore();
  const sync = await latestSync(store);

  if (!sync) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No data yet</EmptyTitle>
          <EmptyDescription>Sync Meta, Shopify and the owners sheet to see performance.</EmptyDescription>
        </EmptyHeader>
        {viewer.role === "admin" && (
          <EmptyContent>
            <RunButton action={syncNow} label="Run first sync" pendingLabel="Syncing" variant="default" size="default" />
          </EmptyContent>
        )}
      </Empty>
    );
  }

  const sp = await searchParams;
  const days = RANGES.includes(Number(sp.days) as 7) ? Number(sp.days) : 14;
  const end = sync.windowEnd;
  const start = addDays(end, -(days - 1));
  const prevStart = addDays(start, -days);
  const hasPrior = prevStart >= sync.windowStart;
  const settings = await store.getSettings();
  const [creatives, adsets, insights, orders, owners] = await Promise.all([
    store.getCreatives(viewer),
    store.getAdsets(viewer),
    store.getInsights(viewer, hasPrior ? prevStart : start, end),
    store.getOrders(viewer, hasPrior ? prevStart : start, end),
    store.getOwners(viewer),
  ]);
  const base = { creatives, adsets, insights, orders, owners, includeUnattributed: viewer.role === "admin" };
  const d = buildDashboard({ ...base, start, end });
  const p = hasPrior ? buildDashboard({ ...base, start: prevStart, end: addDays(start, -1) }) : null;

  let pending: AgentAction[] = [];
  if (canDecide(viewer)) {
    const report = await store.getLatestReport();
    if (report) pending = (await store.getActions(report.id)).filter((a) => a.status === "pending");
  }

  const cur = settings.currency;
  const t = d.total;
  const line = finding(d, cur, settings.targetRoas);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{viewer.role === "admin" ? "Performance" : `${viewer.personName}’s creatives`}</h1>
          {line && <p className="text-muted-foreground">{line}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RangeToggle value={days} options={RANGES} />
          {pending.length > 0 && (
            <Button asChild size="sm">
              <Link href="/agent">Review {pending.length} {pending.length === 1 ? "change" : "changes"}</Link>
            </Button>
          )}
        </div>
      </div>

      {!sync.verified && (
        <Alert variant="destructive">
          <AlertTitle>These numbers are not verified</AlertTitle>
          <AlertDescription>
            <p>
              A data check failed on the last sync. <Link href="/checks" className="underline underline-offset-4">See data checks</Link>.
            </p>
          </AlertDescription>
        </Alert>
      )}

      <Card className="gap-0 py-0">
        <CardContent className="grid grid-cols-2 px-0 sm:grid-cols-3 lg:grid-cols-5">
          <Kpi label="Return on ad spend" value={ratio(t.roas)} lead note={`Target ${settings.targetRoas.toFixed(1)}`} delta={change(t.roas, p?.total.roas ?? null)} good="up" days={days} />
          <Kpi label="Shopify revenue" value={money(t.shopifyRevenueMinor, cur)} delta={p ? change(t.shopifyRevenueMinor, p.total.shopifyRevenueMinor) : null} good="up" days={days} />
          <Kpi label="Ad spend" value={money(t.spendMinor, cur)} delta={p ? change(t.spendMinor, p.total.spendMinor) : null} good="neutral" days={days} />
          <Kpi label="Cost per order" value={money(t.cpa, cur, 2)} delta={change(t.cpa, p?.total.cpa ?? null)} good="down" days={days} />
          <Kpi label="Orders" value={int(t.shopifyOrders)} delta={p ? change(t.shopifyOrders, p.total.shopifyOrders) : null} good="up" days={days} last />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Spend and revenue</CardTitle>
            <CardDescription>Daily, Shopify-attributed revenue</CardDescription>
          </CardHeader>
          <CardContent>
            <TrendChart days={d.daily} currency={cur} />
          </CardContent>
        </Card>
        {canDecide(viewer) ? <Approvals pending={pending} cur={cur} /> : <Attribution d={d} cur={cur} admin={false} />}
      </div>

      <Creatives d={d} cur={cur} target={settings.targetRoas} />

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">
        <Team d={d} cur={cur} target={settings.targetRoas} className={canDecide(viewer) ? "xl:col-span-2" : "xl:col-span-3"} />
        {canDecide(viewer) && <Attribution d={d} cur={cur} admin={viewer.role === "admin"} />}
      </div>
    </div>
  );
}

function Kpi(props: {
  label: string;
  value: string;
  delta: number | null;
  good: "up" | "down" | "neutral";
  days: number;
  note?: string;
  lead?: boolean;
  last?: boolean;
}) {
  const { label, value, delta, good, days, note, lead, last } = props;
  const isGood = good === "neutral" || delta === null || Math.abs(delta) < 0.005 ? null : delta > 0 === (good === "up");
  return (
    <div className={cn("flex flex-col gap-1 border-border px-5 py-4", !last && "border-b lg:border-r lg:border-b-0")}>
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-baseline gap-2">
        <span className={cn("num tracking-tight", lead ? "text-3xl font-semibold" : "text-2xl font-medium")}>{value}</span>
        {note && <span className="text-xs text-muted-foreground">{note}</span>}
      </div>
      <span className="text-xs text-muted-foreground">
        {delta === null ? (
          "No earlier period"
        ) : (
          <>
            <span className={cn("num font-medium", isGood === true && "text-positive", isGood === false && "text-destructive")}>
              {delta > 0 ? "+" : delta < 0 ? "−" : ""}
              {Math.abs(delta * 100).toFixed(1)}%
            </span>{" "}
            vs previous {days} days
          </>
        )}
      </span>
    </div>
  );
}

const VERB: Record<AgentAction["type"], string> = {
  pause_ad: "Pause",
  increase_budget: "Raise budget",
  decrease_budget: "Lower budget",
};

function Approvals({ pending, cur }: { pending: AgentAction[]; cur: string }) {
  return (
    <Card className="gap-2 pb-2">
      <CardHeader>
        <CardTitle>Waiting for approval</CardTitle>
        <CardAction>
          <Button asChild variant="link" size="sm" className="h-auto p-0 text-muted-foreground">
            <Link href="/agent">View all</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="px-0">
        {pending.length === 0 ? (
          <Empty className="mx-5 border p-6 md:p-6">
            <EmptyHeader>
              <EmptyTitle className="text-sm">Nothing waiting</EmptyTitle>
              <EmptyDescription>New proposals appear after each verified sync.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col">
            {pending.slice(0, 4).map((a) => (
              <li key={a.id} className="flex items-center gap-3 border-t px-5 py-3 first:border-t-0">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">
                    {VERB[a.type]} {a.targetName}
                  </span>
                  <span className="num truncate text-xs text-muted-foreground">
                    {a.fromBudgetMinor !== null
                      ? `${money(a.fromBudgetMinor, cur)} to ${money(a.toBudgetMinor, cur)} a day`
                      : a.reason.replace(/\s*\[verified: .*\]$/, "").replace(/\.$/, "")}
                  </span>
                </div>
                <form action={decideAction}>
                  <input type="hidden" name="id" value={a.id} />
                  <Button name="decision" value="approve" variant="outline" size="sm">
                    Approve
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Attribution({ d, cur, admin }: { d: DashboardModel; cur: string; admin: boolean }) {
  const t = d.total;
  const over = t.shopifyRevenueMinor ? t.metaRevenueMinor / t.shopifyRevenueMinor - 1 : null;
  const rows = [
    { k: "Meta reports", v: t.metaRevenueMinor, color: "var(--foreground)" },
    { k: "Shopify confirms", v: t.shopifyRevenueMinor, color: "var(--chart-1)" },
    ...(admin
      ? [
          { k: "Email, search and organic", v: d.unattributedRevenueMinor, color: "var(--chart-5)" },
          { k: "All store revenue", v: d.shopifyTotalRevenueMinor, color: "var(--chart-4)" },
        ]
      : []),
  ];
  const max = Math.max(1, ...rows.map((r) => r.v));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Meta vs Shopify</CardTitle>
        <CardDescription>
          {over !== null ? `Meta reports ${Math.round(over * 100)}% more revenue than Shopify confirms.` : "No Shopify revenue in this range."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="num flex flex-col gap-4">
          {rows.map((r) => (
            <div key={r.k} className="flex flex-col gap-1.5">
              <div className="flex justify-between text-sm">
                <dt className="text-muted-foreground">{r.k}</dt>
                <dd>{money(r.v, cur)}</dd>
              </div>
              <div className="h-1.5 rounded-full bg-muted">
                <div className="h-1.5 rounded-full" style={{ width: `${(r.v / max) * 100}%`, background: r.color }} />
              </div>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function Creatives({ d, cur, target }: { d: DashboardModel; cur: string; target: number }) {
  const scaleMax = Math.max(1, ...d.byCreative.map((c) => Math.max(c.metaRevenueMinor, c.shopifyRevenueMinor)));
  const risk = (r: Row) => r.roas !== null && r.roas < target * 0.8;
  return (
    <Card className="gap-2 pb-0">
      <CardHeader>
        <CardTitle>Creatives</CardTitle>
        <CardDescription className="num">{d.byCreative.length} ads, sorted by spend</CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        {d.byCreative.length === 0 ? (
          <Empty className="mx-5 mb-5 border">
            <EmptyHeader>
              <EmptyTitle>No creatives</EmptyTitle>
              <EmptyDescription>Nothing is assigned to you in this range.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <div className="hidden md:block">
              <Table className="num">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-5">Creative</TableHead>
                    <TableHead>Owners</TableHead>
                    <TableHead className="text-right">Spend</TableHead>
                    <TableHead className="text-right">Orders</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">ROAS</TableHead>
                    <TableHead className="text-right">Cost per order</TableHead>
                    <TableHead className="pr-5">Shopify vs Meta</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.byCreative.map((c) => (
                    <TableRow key={c.key}>
                      <TableCell className="max-w-80 py-2.5 pl-5">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium" title={c.label}>{c.label}</span>
                          {c.status !== "ACTIVE" && <Badge variant="neutral">Paused</Badge>}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">{c.adsetName}</div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {c.strategist.startsWith("—") ? <Badge variant="warning">No owner</Badge> : `${c.strategist}, ${c.editor}`}
                      </TableCell>
                      <TableCell className="text-right">{money(c.spendMinor, cur)}</TableCell>
                      <TableCell className="text-right">{c.shopifyOrders}</TableCell>
                      <TableCell className="text-right">{money(c.shopifyRevenueMinor, cur)}</TableCell>
                      <TableCell className={cn("text-right", risk(c) && "font-medium text-destructive")}>{ratio(c.roas)}</TableCell>
                      <TableCell className="text-right">{money(c.cpa, cur, 2)}</TableCell>
                      <TableCell className="pr-5">
                        <span title={`Shopify ${money(c.shopifyRevenueMinor, cur)}, Meta ${money(c.metaRevenueMinor, cur)}`}>
                          <ClaimBar verified={c.shopifyRevenueMinor} claimed={c.metaRevenueMinor} scaleMax={scaleMax} />
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="border-t px-5 py-3 text-xs text-muted-foreground">
                Bar: revenue Shopify confirms. Tick: revenue Meta reports for the same ad.
              </p>
            </div>
            <ul className="flex flex-col pb-2 md:hidden">
              {d.byCreative.map((c) => (
                <li key={c.key} className="flex flex-col gap-0.5 border-t px-5 py-3 first:border-t-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate font-medium">{c.label}</span>
                    <span className={cn("num shrink-0", risk(c) && "font-medium text-destructive")}>{ratio(c.roas)}</span>
                  </div>
                  <div className="num flex justify-between gap-3 text-xs text-muted-foreground">
                    <span className="truncate">
                      {c.strategist.startsWith("—") ? "No owner" : `${c.strategist}, ${c.editor}`}
                      {c.status !== "ACTIVE" ? ", paused" : ""}
                    </span>
                    <span className="shrink-0">
                      {money(c.spendMinor, cur)} spend, {money(c.shopifyRevenueMinor, cur)} revenue
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Team({ d, cur, target, className }: { d: DashboardModel; cur: string; target: number; className?: string }) {
  const count = (k: "strategist" | "editor", name: string) => d.byCreative.filter((c) => c[k] === name).length;
  const rows = [
    ...d.byStrategist.map((r) => ({ ...r, role: "Strategist", ads: count("strategist", r.key) })),
    ...d.byEditor.map((r) => ({ ...r, role: "Editor", ads: count("editor", r.key) })),
  ].filter((r) => !r.label.startsWith("—"));
  return (
    <Card className={cn("gap-2 pb-0", className)}>
      <CardHeader>
        <CardTitle>Team</CardTitle>
        <CardDescription>Results by strategist and editor</CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <Table className="num">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-5">Person</TableHead>
              <TableHead className="text-right">Ads</TableHead>
              <TableHead className="text-right">Spend</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
              <TableHead className="pr-5 text-right">ROAS</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.role + r.key}>
                <TableCell className="pl-5">
                  <div className="flex items-center gap-3">
                    <Avatar className="size-7">
                      <AvatarFallback className="text-xs">{r.label.slice(0, 1)}</AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col leading-tight">
                      <span>{r.label}</span>
                      <span className="text-xs text-muted-foreground">{r.role}</span>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-right">{r.ads}</TableCell>
                <TableCell className="text-right">{money(r.spendMinor, cur)}</TableCell>
                <TableCell className="text-right">{money(r.shopifyRevenueMinor, cur)}</TableCell>
                <TableCell className={cn("pr-5 text-right", r.roas !== null && r.roas < target * 0.8 && "font-medium text-destructive")}>
                  {ratio(r.roas)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
