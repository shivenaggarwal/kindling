"use client";

import { useActionState } from "react";
import { login } from "@/lib/actions";
import { SubmitButton } from "@/components/client";
import { Input } from "@/components/ui";

export function LoginForm({ next }: { next: string }) {
  const [error, action] = useActionState(login, null);
  return (
    <form action={action} className="space-y-3 rounded-xl border border-border bg-surface p-5">
      <input type="hidden" name="next" value={next} />
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium">Password</span>
        <Input type="password" name="password" autoFocus required autoComplete="current-password" />
      </label>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <SubmitButton className="w-full" pendingText="Signing in…">
        Sign in
      </SubmitButton>
    </form>
  );
}
