import type { Metadata } from "next";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./globals.css";
import { getStore, getViewer } from "@/lib/session";
import { latestSync } from "@/lib/ensure";
import { env } from "@/lib/env";
import { ago, isOlderThanHours } from "@/lib/format";
import { setDemoViewer, signOut, syncNow } from "./actions";
import { SAMPLE_PEOPLE } from "@/lib/sample/generator";
import { AppSidebar, type NavItem } from "@/components/app-sidebar";
import { ViewAs } from "@/components/view-as";
import { RunButton } from "@/components/run-button";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Viewer } from "@/lib/types";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Lumen Skin · Creative performance",
  description: "Meta Ads and Shopify creative performance, with verified numbers and approved actions.",
};

async function navItems(viewer: Viewer | null): Promise<NavItem[]> {
  if (!viewer) return [];
  const items: NavItem[] = [{ href: "/", label: "Performance", icon: "performance" }];
  if (viewer.role !== "editor") {
    let count = 0;
    try {
      const store = await getStore();
      const report = await store.getLatestReport();
      if (report) count = (await store.getActions(report.id)).filter((a) => a.status === "pending").length;
    } catch {
      count = 0;
    }
    items.push({ href: "/agent", label: "Approvals", icon: "actions", count });
  }
  items.push({ href: "/checks", label: "Data checks", icon: "checks" });
  return items;
}

function Sources() {
  const rows: [string, boolean, string][] = [
    ["Meta", env.metaLive(), env.metaLive() ? "Live" : "Sample data"],
    ["Shopify", env.shopifyLive(), env.shopifyOrdersLive() ? "Live" : env.shopifyLive() ? "Connected" : "Sample data"],
    ["Owners sheet", !!env.ownersCsvUrl(), env.ownersCsvUrl() ? "Live" : "Sample data"],
  ];
  return (
    <dl className="flex flex-col gap-1 px-2 text-xs">
      {rows.map(([k, live, label]) => (
        <div key={k} className="flex justify-between">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className={live ? "text-positive" : "text-muted-foreground"}>{label}</dd>
        </div>
      ))}
    </dl>
  );
}

function Account({ viewer }: { viewer: Viewer | null }) {
  if (!env.useSupabase()) {
    const current = viewer ? (viewer.role === "admin" ? "admin" : `${viewer.role}:${viewer.personName}`) : "admin";
    return (
      <div className="px-2">
        <ViewAs action={setDemoViewer} current={current} strategists={SAMPLE_PEOPLE.strategists} editors={SAMPLE_PEOPLE.editors} />
      </div>
    );
  }
  if (!viewer) return null;
  return (
    <form action={signOut} className="flex items-center justify-between gap-2 px-2">
      <div className="grid text-sm leading-tight">
        <span className="truncate font-medium">{viewer.name}</span>
        <span className="text-xs capitalize text-muted-foreground">{viewer.role}</span>
      </div>
      <Button variant="ghost" size="sm">Sign out</Button>
    </form>
  );
}

async function Status({ viewer }: { viewer: Viewer }) {
  const sync = await latestSync(await getStore());
  if (!sync) return <span className="text-sm text-muted-foreground">Not synced yet</span>;
  const verified = sync.verified && !isOlderThanHours(sync.finishedAt, 26);
  return (
    <div className="flex items-center gap-3">
      <Link href="/checks" className="hidden items-center gap-2 text-sm sm:flex">
        <Badge variant={verified ? "positive" : "negative"}>{verified ? "Verified" : "Unverified"}</Badge>
        <span className="text-muted-foreground">Synced {ago(sync.finishedAt)}</span>
      </Link>
      {viewer.role === "admin" && <RunButton action={syncNow} label="Sync" pendingLabel="Syncing" />}
    </div>
  );
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const viewer = await getViewer();
  const items = await navItems(viewer);

  return (
    <html lang="en">
      <body>
        <TooltipProvider>
          <SidebarProvider>
            <AppSidebar
              brand="Lumen Skin"
              account={env.metaAdAccountId() ?? "act_sample"}
              items={items}
              footer={
                <div className="flex flex-col gap-4 pb-2">
                  <Sources />
                  <Account viewer={viewer} />
                </div>
              }
            />
            <SidebarInset>
              <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
                <SidebarTrigger className="-ml-1" />
                <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
                <span className="text-sm text-muted-foreground">Creative performance</span>
                <div className="ml-auto">{viewer && <Status viewer={viewer} />}</div>
              </header>
              <div className="flex flex-1 flex-col p-4 md:p-6">{children}</div>
            </SidebarInset>
          </SidebarProvider>
          <Toaster position="bottom-right" icons={{ success: null, error: null, info: null, warning: null }} />
        </TooltipProvider>
      </body>
    </html>
  );
}
