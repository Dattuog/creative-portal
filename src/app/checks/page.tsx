import { redirect } from "next/navigation";
import { getStore, getViewer } from "@/lib/session";
import { latestSync } from "@/lib/ensure";
import { ago, int, money } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createTestOrderNow, syncNow } from "../actions";
import { env } from "@/lib/env";
import { fetchRecentShopifyOrders } from "@/lib/sources/shopify";
import { RunButton } from "@/components/run-button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

  // Connection proof: read the latest real orders straight from the Shopify store.
  let recent: Awaited<ReturnType<typeof fetchRecentShopifyOrders>> | null = null;
  let shopifyError: string | null = null;
  if (env.shopifyLive()) {
    try {
      recent = await fetchRecentShopifyOrders(settings.accountTimezone);
    } catch (e) {
      shopifyError = e instanceof Error ? e.message : "Could not reach Shopify.";
    }
  }
  const adNames = new Map((await store.getCreatives(viewer)).map((c) => [c.adId, c.adName]));
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

      {env.shopifyLive() && (
        <Card className="gap-2 pb-0">
          <CardHeader>
            <CardTitle>Shopify store</CardTitle>
            <CardDescription>
              Latest orders read live from {env.shopifyDomain()}.
              {!env.shopifyOrdersLive() && " The 30-day history above uses sample orders, because Shopify test stores limit how fast orders can be created."}
            </CardDescription>
            {viewer.role === "admin" && (
              <CardAction>
                <RunButton action={createTestOrderNow} label="Create test order" pendingLabel="Creating" />
              </CardAction>
            )}
          </CardHeader>
          <CardContent className="px-0">
            {shopifyError ? (
              <Alert variant="destructive" className="mx-5 mb-5 w-auto">
                <AlertTitle>Could not reach Shopify</AlertTitle>
                <AlertDescription>{shopifyError}</AlertDescription>
              </Alert>
            ) : !recent || recent.length === 0 ? (
              <Empty className="mx-5 mb-5 border">
                <EmptyHeader>
                  <EmptyTitle>Connected, no orders yet</EmptyTitle>
                  <EmptyDescription>Create a test order to see it arrive here.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <Table className="num">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-5">Order</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Ad</TableHead>
                    <TableHead className="pr-5 text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recent.map((o) => (
                    <TableRow key={o.orderId}>
                      <TableCell className="pl-5 font-medium">{o.name}</TableCell>
                      <TableCell className="text-muted-foreground">{o.date}</TableCell>
                      <TableCell className="text-muted-foreground">{o.utmSource ?? "Direct"}</TableCell>
                      <TableCell className="max-w-64 truncate">{o.attributedAdId ? adNames.get(o.attributedAdId) ?? o.attributedAdId : "Not from Meta"}</TableCell>
                      <TableCell className="pr-5 text-right">{money(o.totalMinor, o.currency, 2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
