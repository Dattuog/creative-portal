"use client";

import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { niceScale } from "@/components/charts";

const config = {
  revenue: { label: "Shopify revenue", color: "var(--chart-1)" },
  spend: { label: "Spend", color: "var(--chart-2)" },
} satisfies ChartConfig;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const label = (d: string) => `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;

export function TrendChart({
  days,
  currency,
}: {
  days: { date: string; spendMinor: number; shopifyRevenueMinor: number }[];
  currency: string;
}) {
  const data = days.map((d) => ({ date: d.date, spend: d.spendMinor / 100, revenue: d.shopifyRevenueMinor / 100 }));
  const { top, ticks } = niceScale(Math.max(1, ...data.map((d) => Math.max(d.spend, d.revenue))));
  const fmt = new Intl.NumberFormat("en-IE", { style: "currency", currency, maximumFractionDigits: 0 });
  return (
    <ChartContainer config={config} className="aspect-auto h-[240px] w-full">
      <ComposedChart data={data} margin={{ left: 0, right: 4, top: 4 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={label} />
        <YAxis
          width={56}
          tickLine={false}
          axisLine={false}
          domain={[0, top]}
          ticks={ticks}
          tickFormatter={(v: number) => fmt.format(v)}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(_, p) => (p?.[0]?.payload?.date ? label(p[0].payload.date) : "")}
              formatter={(v, name) => (
                <div className="flex w-full justify-between gap-4">
                  <span className="text-muted-foreground">{config[name as keyof typeof config]?.label}</span>
                  <span className="num font-medium">{fmt.format(Number(v))}</span>
                </div>
              )}
            />
          }
        />
        <Bar dataKey="spend" fill="var(--color-spend)" maxBarSize={18} isAnimationActive={false} />
        <Line dataKey="revenue" type="linear" stroke="var(--color-revenue)" strokeWidth={2} dot={false} isAnimationActive={false} />
        <ChartLegend verticalAlign="top" align="right" content={<ChartLegendContent className="justify-end pt-0 pb-3" />} />
      </ComposedChart>
    </ChartContainer>
  );
}
