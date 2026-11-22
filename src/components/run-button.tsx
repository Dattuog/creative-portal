"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { ActionState } from "@/app/actions";

export function RunButton({
  action,
  label,
  pendingLabel,
  variant = "outline",
  size = "sm",
}: {
  action: () => Promise<ActionState>;
  label: string;
  pendingLabel: string;
  variant?: "default" | "outline" | "ghost";
  size?: "sm" | "default";
}) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant={variant}
      size={size}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await action();
          if (!r) return;
          if (r.ok) toast.success(r.message);
          else toast.error(r.message);
        })
      }
    >
      {pending && <Spinner data-icon="inline-start" />}
      {pending ? pendingLabel : label}
    </Button>
  );
}
