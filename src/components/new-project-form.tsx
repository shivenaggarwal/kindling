"use client";

import { useActionState, useState } from "react";
import { createProject } from "@/lib/actions";
import { SubmitButton } from "./client";

export function NewProjectForm({ large }: { large?: boolean }) {
  const [error, action] = useActionState(createProject, null);
  const [showNotes, setShowNotes] = useState(false);
  return (
    <form action={action} className="w-full">
      <div className="flex flex-col gap-2 rounded-2xl border border-border-strong bg-surface p-2 shadow-sm sm:flex-row">
        <input
          name="website"
          required
          autoFocus={large}
          placeholder="Paste your website, e.g. acme.com"
          className="h-12 min-w-0 flex-1 rounded-xl bg-transparent px-4 text-[15px] placeholder:text-faint focus:outline-none"
        />
        <SubmitButton size="lg" pendingText="Starting…" className="h-12 rounded-xl">
          Find my customers
        </SubmitButton>
      </div>
      {showNotes ? (
        <textarea
          name="notes"
          rows={3}
          placeholder="Optional: anything the agent should know (who you've sold to, who to avoid, regions you serve, tone…)"
          className="mt-2 w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm placeholder:text-faint focus:border-accent focus:outline-none"
        />
      ) : (
        <button type="button" onClick={() => setShowNotes(true)} className="mt-2 text-xs text-muted hover:text-text">
          + Add notes for the agent
        </button>
      )}
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
    </form>
  );
}
