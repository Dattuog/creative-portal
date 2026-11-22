"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ChartColumnIcon, ListChecksIcon, ShieldCheckIcon } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Mark } from "@/components/shell/Mark";

export interface NavItem {
  href: string;
  label: string;
  icon: "performance" | "actions" | "checks";
  count?: number;
}

const ICONS = { performance: ChartColumnIcon, actions: ListChecksIcon, checks: ShieldCheckIcon };

export function AppSidebar({
  brand,
  account,
  items,
  footer,
}: {
  brand: string;
  account: string;
  items: NavItem[];
  footer: ReactNode;
}) {
  const path = usePathname();
  return (
    <Sidebar variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <Mark size={28} />
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-semibold">{brand}</span>
                  <span className="truncate font-mono text-xs text-muted-foreground">{account}</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((it) => {
                const Icon = ICONS[it.icon];
                const active = it.href === "/" ? path === "/" : path.startsWith(it.href);
                return (
                  <SidebarMenuItem key={it.href}>
                    <SidebarMenuButton asChild isActive={active}>
                      <Link href={it.href}>
                        <Icon />
                        <span>{it.label}</span>
                      </Link>
                    </SidebarMenuButton>
                    {it.count ? <SidebarMenuBadge className="num">{it.count}</SidebarMenuBadge> : null}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>{footer}</SidebarFooter>
    </Sidebar>
  );
}
