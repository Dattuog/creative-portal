"use client";

import { useRouter } from "next/navigation";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export function RangeToggle({ value, options }: { value: number; options: readonly number[] }) {
  const router = useRouter();
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={String(value)}
      onValueChange={(v) => v && router.push(`/?days=${v}`)}
      aria-label="Date range"
    >
      {options.map((o) => (
        <ToggleGroupItem key={o} value={String(o)} className="num px-3">
          {o} days
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
