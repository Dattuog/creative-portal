import { redirect } from "next/navigation";
import { getStore, getViewer } from "@/lib/session";
import { latestSync } from "@/lib/ensure";
import { ago, int, money } from "@/lib/format";
import { cn } from "@/lib/utils";
import { syncNow } from "../actions";
import { RunButton } from "@/components/run-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

export default async function ChecksPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const store = await getStore();
  const [sync, settings] = await Promise.all([latestSync(store), store.getSettings()]);
  const cur = settings.currency;

  if (!sync) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No sync yet</EmptyTitle>
          <EmptyDescription>Checks run after every sync.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const failed = sync.checks.filter((c) => c.critical && !c.passed).length;
  const warnings = sync.checks.filter((c) => !c.critical && !c.passed).length;
  const isMoney = (name: string) => name.startsWith("Meta spend");
  const summary = [
    ["Last sync", ago(sync.finishedAt)],
    ["Period", `${sync.windowStart} to ${sync.windowEnd}`],
    ["Ad-day rows", int(sync.rows.insights)],
    ["Orders", int(sync.rows.orders)],
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Data checks</h1>
          <p className="text-muted-foreground">
            {failed ? "A critical check failed." : warnings ? `Totals match the source. ${warnings} ${warnings === 1 ? "item" : "items"} to fix.` : "Totals match the source."}
          </p>
        </div>
        {viewer.role === "admin" && <RunButton action={syncNow} label="Sync now" pendingLabel="Syncing" />}
      </div>

      {(sync.error || failed > 0) && (
        <Alert variant="destructive">
          <AlertTitle>Numbers are hidden from the agent</AlertTitle>
          <AlertDescription>{sync.error ?? "Fix the failed check, then sync again."}</AlertDescription>
        </Alert>
      )}

      <Card className="gap-0 py-0">
        <CardContent className="num grid grid-cols-2 px-0 lg:grid-cols-4">
          {summary.map(([k, v], i) => (
            <div key={k} className={cn("flex flex-col gap-1 border-border px-5 py-4", i < summary.length - 1 && "border-b lg:border-r lg:border-b-0")}>
              <span className="text-sm text-muted-foreground">{k}</span>
              <span className="text-lg font-medium">{v}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="gap-2 pb-0">
        <CardHeader>
          <CardTitle>Checks</CardTitle>
          <CardDescription>
            Stored data compared with each source. Times in {settings.accountTimezone}.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table className="num">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-5">Check</TableHead>
                <TableHead className="hidden text-right md:table-cell">Source</TableHead>
                <TableHead className="hidden text-right md:table-cell">Stored</TableHead>
                <TableHead className="pr-5 text-right">Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sync.checks.map((c) => (
                <TableRow key={c.name}>
                  <TableCell className="py-3 pl-5 whitespace-normal">
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-muted-foreground">{c.note}</div>
                  </TableCell>
                  <TableCell className="hidden text-right md:table-cell">{isMoney(c.name) ? money(c.sourceValue, cur, 2) : int(c.sourceValue)}</TableCell>
                  <TableCell className="hidden text-right md:table-cell">{isMoney(c.name) ? money(c.dbValue, cur, 2) : int(c.dbValue)}</TableCell>
                  <TableCell className="pr-5 text-right">
                    {c.passed ? (
                      <Badge variant="positive">Pass</Badge>
                    ) : c.critical ? (
                      <Badge variant="negative">Fail</Badge>
                    ) : (
                      <Badge variant="warning">Fix</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
