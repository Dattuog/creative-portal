"use client";

import { useRef } from "react";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FieldLabel } from "@/components/ui/field";

/** Demo mode only: switch role to see what each person can see. Submits on change. */
export function ViewAs({
  action,
  current,
  strategists,
  editors,
}: {
  action: (fd: FormData) => Promise<void>;
  current: string;
  strategists: string[];
  editors: string[];
}) {
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} action={action}>
      <Field>
        <FieldLabel htmlFor="viewer">Viewing as</FieldLabel>
        <Select name="viewer" defaultValue={current} onValueChange={() => setTimeout(() => form.current?.requestSubmit(), 0)}>
          <SelectTrigger id="viewer" className="w-full bg-background">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>Strategists</SelectLabel>
              {strategists.map((p) => (
                <SelectItem key={p} value={`strategist:${p}`}>{p}</SelectItem>
              ))}
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>Editors</SelectLabel>
              {editors.map((p) => (
                <SelectItem key={p} value={`editor:${p}`}>{p}</SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
    </form>
  );
}
