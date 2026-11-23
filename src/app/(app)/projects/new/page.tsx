import { NewProjectForm } from "@/components/new-project-form";

export const metadata = { title: "New project" };

export default function NewProjectPage() {
  return (
    <div className="mx-auto max-w-[640px] pt-4 md:pt-16">
      <h1 className="text-center text-[34px] font-bold leading-[1.08] tracking-[-0.04em] md:text-[48px]">Who are we finding customers for?</h1>
      <p className="mx-auto mt-4 max-w-[44ch] text-center text-[16px] leading-snug text-muted">
        Paste the business&apos;s website. The agent reads it, works out who buys, and proposes where to start.
      </p>
      <div className="mt-10">
        <NewProjectForm large />
      </div>
    </div>
  );
}
