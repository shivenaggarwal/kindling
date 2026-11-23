"use client";

import { useActionState, useState } from "react";
import { createProject } from "@/lib/actions";
import { SubmitButton } from "./client";

export function NewProjectForm({ large }: { large?: boolean }) {
  const [error, action] = useActionState(createProject, null);
  const [showNotes, setShowNotes] = useState(false);
  return (
    <form action={action} className="w-full">
      <div className="flex flex-col gap-2 rounded-[26px] bg-surface p-2 ring-1 ring-[var(--card-ring)] shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_24px_-12px_rgb(0_0_0/0.12)] focus-within:ring-[3px] focus-within:ring-[var(--focus)] sm:flex-row">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Website</span>
          <input
            name="website"
            required
            autoFocus={large}
            inputMode="url"
            autoComplete="url"
            placeholder="acme.com"
            className="h-12 w-full rounded-[18px] bg-transparent px-4 text-[17px] tracking-[-0.01em] placeholder:text-faint focus:outline-none"
          />
        </label>
        <SubmitButton size="lg" pendingText="Starting…">
          Find customers
        </SubmitButton>
      </div>
      {showNotes ? (
        <label className="mt-2 block">
          <span className="sr-only">Notes for the agent</span>
          <textarea
            name="notes"
            rows={3}
            autoFocus
            placeholder="Who you've sold to, who to avoid, regions you serve, tone…"
            className="w-full rounded-[18px] bg-surface px-4 py-3 text-[14px] ring-1 ring-[var(--card-ring)] placeholder:text-faint focus:outline-none focus:ring-[3px] focus:ring-[var(--focus)]"
          />
        </label>
      ) : (
        <button type="button" onClick={() => setShowNotes(true)} className="mt-3 px-2 text-[13px] font-medium text-muted transition-colors hover:text-text">
          Add notes for the agent
        </button>
      )}
      {error ? (
        <p className="mt-2 px-2 text-[13px] text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
