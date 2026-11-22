"use client";

import { useActionState } from "react";
import { signIn, type ActionState } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";

export function LoginForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(signIn, null);
  const invalid = !!state && !state.ok;
  return (
    <form action={action}>
      <FieldGroup>
        <Field data-invalid={invalid || undefined}>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input id="email" name="email" type="email" required autoComplete="email" aria-invalid={invalid || undefined} />
        </Field>
        <Field data-invalid={invalid || undefined}>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input id="password" name="password" type="password" required autoComplete="current-password" aria-invalid={invalid || undefined} />
          {invalid && <FieldError>{state.message}</FieldError>}
        </Field>
        <Button type="submit" disabled={pending}>
          {pending && <Spinner data-icon="inline-start" />}
          Sign in
        </Button>
      </FieldGroup>
    </form>
  );
}
