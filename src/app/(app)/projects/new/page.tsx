import { NewProjectForm } from "@/components/new-project-form";

export const metadata = { title: "New project" };

export default function NewProjectPage() {
  return (
    <div className="mx-auto max-w-2xl pt-6 md:pt-12">
      <h1 className="text-center font-display text-5xl tracking-tight">Who are we finding customers for?</h1>
      <p className="mx-auto mt-3 max-w-md text-center text-sm text-muted">
        Paste the business&apos;s website. The agent reads it, works out who buys, and proposes where to start.
      </p>
      <div className="mt-8">
        <NewProjectForm large />
      </div>
    </div>
  );
}
