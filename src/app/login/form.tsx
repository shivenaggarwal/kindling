"use client";

import { useActionState } from "react";
import { login } from "@/lib/actions";
import { SubmitButton } from "@/components/client";
import { Input } from "@/components/ui";

export function LoginForm({ next }: { next: string }) {
  const [error, action] = useActionState(login, null);
  return (
    <form action={action} className="space-y-3 rounded-[24px] bg-surface p-4 ring-1 ring-[var(--card-ring)]">
      <input type="hidden" name="next" value={next} />
      <label className="block">
        <span className="sr-only">Password</span>
        <Input type="password" name="password" placeholder="Password" autoFocus required autoComplete="current-password" className="h-12 text-[15px]" />
      </label>
      {error ? (
        <p className="px-1 text-[13px] text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <SubmitButton size="lg" className="w-full" pendingText="Signing in…">
        Sign in
      </SubmitButton>
    </form>
  );
}
