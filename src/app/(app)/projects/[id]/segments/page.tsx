import { asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { integrations } from "@/lib/config";
import { segmentStats } from "@/lib/pipeline/stats";
import { createSegment, deleteSegment, findLeadsForSegment, setSegmentStatus, updateSegment } from "@/lib/actions";
import { AutoRefresh, SubmitButton } from "@/components/client";
import { PerfBadge } from "@/components/status";
import { Badge, Card, Empty, Field, FitBar, Input, Textarea } from "@/components/ui";

export const metadata = { title: "Segments" };

export default async function SegmentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = (await db.query.projects.findFirst({ where: eq(schema.projects.id, id) }))!;
  const segs = await db
    .select()
    .from(schema.segments)
    .where(eq(schema.segments.projectId, id))
    .orderBy(asc(schema.segments.status), desc(schema.segments.fitScore));
  const stats = await segmentStats(id);
  const ints = integrations();
  const busy = segs.some((s) => s.findingLeads) || project.status === "analyzing";

  const sources = [
    "AI web research",
    ints.apollo && "Apollo",
    ints.hunter && "Hunter",
    ints.places && "Google Maps",
  ].filter(Boolean);

  return (
    <div className="space-y-5">
      <AutoRefresh active={busy} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted">
          Each segment is a group of companies likely to buy, with the people to reach. Activate the ones you like and
          find leads. Lead sources in use: <span className="text-text">{sources.join(", ")}</span>.
        </p>
      </div>

      {segs.length === 0 ? (
        <Empty title={project.status === "analyzing" ? "Working out who buys…" : "No segments yet"}>
          {project.status === "analyzing"
            ? "The agent is studying the business. Segments will appear here in a minute or two."
            : "Add one below to get started."}
        </Empty>
      ) : null}

      <div className="space-y-3">
        {segs.map((s) => {
          const st = stats.get(s.id);
          const t = s.targeting;
          return (
            <Card key={s.id} className={s.status === "proposed" ? "border-dashed" : undefined}>
              <div className="flex flex-wrap items-start justify-between gap-4 p-5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[15px] font-semibold">{s.name}</h3>
                    <PerfBadge performance={s.performance} status={s.status} />
                    {s.findingLeads ? <Badge tone="ai"><span className="ember-dot inline-block size-1.5 rounded-full bg-current" />Finding leads</Badge> : null}
                  </div>
                  <p className="mt-1 text-sm text-muted">{s.description}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-[11px] text-muted">Fit score</span>
                  <FitBar value={s.fitScore} />
                </div>
              </div>

              <div className="grid gap-4 border-t border-border px-5 py-4 text-sm md:grid-cols-2">
                <div>
                  <div className="text-xs font-medium text-muted">Why they buy</div>
                  <p className="mt-1">{s.rationale}</p>
                </div>
                <div>
                  <div className="text-xs font-medium text-muted">Opening angle</div>
                  <p className="mt-1">{s.angle || "—"}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 border-t border-border px-5 py-3">
                {t.titles.slice(0, 5).map((x) => <Badge key={`t-${x}`}>{x}</Badge>)}
                {t.locations.slice(0, 4).map((x) => <Badge key={`l-${x}`} tone="info">{x}</Badge>)}
                {t.placesQueries.length && ints.places ? <Badge tone="neutral">{t.placesQueries.length} Maps queries</Badge> : null}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface-2/40 px-5 py-3">
                <div className="num flex gap-4 text-xs text-muted">
                  <span><b className="text-text">{st?.leads ?? 0}</b> leads</span>
                  <span><b className="text-text">{st?.contacted ?? 0}</b> contacted</span>
                  <span><b className="text-text">{st?.positive ?? 0}</b> warm</span>
                  <span><b className="text-text">{st?.meetings ?? 0}</b> meetings</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <form action={findLeadsForSegment.bind(null, s.id)} className="flex items-center gap-1.5">
                    <Input name="count" type="number" min={5} max={100} defaultValue={project.settings.leadsPerBatch} className="h-7 w-16 text-xs" aria-label="How many leads" />
                    <SubmitButton size="sm" variant={s.status === "proposed" ? "primary" : "secondary"} pendingText="Queued…">
                      {s.status === "proposed" ? "Activate & find leads" : "Find more leads"}
                    </SubmitButton>
                  </form>
                  {s.status === "active" ? (
                    <form action={setSegmentStatus.bind(null, s.id, "paused")}>
                      <SubmitButton size="sm" variant="ghost">Pause</SubmitButton>
                    </form>
                  ) : s.status === "paused" ? (
                    <form action={setSegmentStatus.bind(null, s.id, "active")}>
                      <SubmitButton size="sm" variant="ghost">Resume</SubmitButton>
                    </form>
                  ) : null}
                </div>
              </div>

              <details className="group border-t border-border">
                <summary className="cursor-pointer list-none px-5 py-2.5 text-xs text-muted hover:text-text">
                  <span className="group-open:hidden">Edit targeting ▸</span>
                  <span className="hidden group-open:inline">Hide ▾</span>
                </summary>
                <form action={updateSegment.bind(null, s.id)} className="grid gap-3 px-5 pb-5 md:grid-cols-2">
                  <Field label="Name"><Input name="name" defaultValue={s.name} /></Field>
                  <Field label="Decision-maker titles" hint="Comma separated, most important first"><Input name="titles" defaultValue={t.titles.join(", ")} /></Field>
                  <Field label="Description" className="md:col-span-2"><Textarea name="description" rows={2} defaultValue={s.description} /></Field>
                  <Field label="Opening angle" className="md:col-span-2"><Textarea name="angle" rows={2} defaultValue={s.angle} /></Field>
                  <Field label="Locations"><Input name="locations" defaultValue={t.locations.join(", ")} /></Field>
                  <Field label="Industries"><Input name="industries" defaultValue={t.industries.join(", ")} /></Field>
                  <Field label="Keywords" hint="Used for Apollo company search"><Input name="keywords" defaultValue={t.keywords.join(", ")} /></Field>
                  <Field label="Google Maps queries" hint='e.g. "wedding planner in Austin, TX"'><Input name="placesQueries" defaultValue={t.placesQueries.join(", ")} /></Field>
                  <div className="flex items-center justify-between md:col-span-2">
                    <SubmitButton size="sm" variant="primary">Save</SubmitButton>
                    <SubmitButton size="sm" variant="danger" formAction={deleteSegment.bind(null, s.id)} confirm={`Delete segment "${s.name}"? Its leads stay.`}>
                      Delete segment
                    </SubmitButton>
                  </div>
                </form>
              </details>
            </Card>
          );
        })}
      </div>

      <Card>
        <details>
          <summary className="cursor-pointer list-none px-5 py-4 text-sm font-medium hover:text-accent">+ Add your own segment</summary>
          <form action={createSegment.bind(null, id)} className="grid gap-3 border-t border-border p-5 md:grid-cols-2">
            <Field label="Name"><Input name="name" required placeholder="e.g. Boutique hotels in London" /></Field>
            <Field label="Decision-maker titles"><Input name="titles" placeholder="Owner, General Manager" required /></Field>
            <Field label="Who exactly" className="md:col-span-2"><Textarea name="description" rows={2} /></Field>
            <Field label="Opening angle" className="md:col-span-2"><Textarea name="angle" rows={2} placeholder="What problem do we solve for them?" /></Field>
            <Field label="Locations"><Input name="locations" placeholder="London, UK" /></Field>
            <Field label="Keywords"><Input name="keywords" placeholder="boutique hotel, hospitality" /></Field>
            <Field label="Industries"><Input name="industries" placeholder="Hospitality" /></Field>
            <Field label="Google Maps queries"><Input name="placesQueries" placeholder="boutique hotel in London" /></Field>
            <div className="md:col-span-2"><SubmitButton size="sm">Add segment</SubmitButton></div>
          </form>
        </details>
      </Card>
    </div>
  );
}
