"use client";

import { useActionState } from "react";
import { connectWebhookAction, domainShop, type ShopState } from "@/lib/infra-actions";
import { SubmitButton } from "./client";
import { Badge, Input, Notice } from "./ui";

const usd = (n?: number) => (n == null ? "—" : `$${n.toFixed(2)}`);

export function WebhookConnect({ connected }: { connected: boolean }) {
  const [note, action] = useActionState(connectWebhookAction, null);
  return (
    <form action={action} className="space-y-2">
      <SubmitButton size="sm" variant={connected ? "secondary" : "primary"} pendingText="Connecting…">
        {connected ? "Reconnect events" : "Connect reply events"}
      </SubmitButton>
      {note ? <p className={note.ok ? "text-xs text-success" : "text-xs text-danger"}>{note.message}</p> : null}
    </form>
  );
}

export function DomainShop({ defaultKeyword, defaultFirst, defaultLast }: { defaultKeyword: string; defaultFirst: string; defaultLast: string }) {
  const initial: ShopState = {
    step: "search",
    keyword: defaultKeyword,
    orderType: "pre_warmed_up",
    preWarmed: [],
    fresh: [],
    selected: [],
    firstName: defaultFirst,
    lastName: defaultLast,
  };
  const [s, action] = useActionState(domainShop, initial);
  const list = s.orderType === "pre_warmed_up" ? s.preWarmed : s.fresh;

  return (
    <form action={action} className="space-y-5">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1">
          <span className="mb-1.5 block text-xs font-medium">Your brand</span>
          <Input name="keyword" defaultValue={s.keyword} placeholder="e.g. larksilk" />
        </label>
        <SubmitButton variant="secondary" pendingText="Searching…" name="intent" value="search">
          Find domains
        </SubmitButton>
      </div>

      {s.step !== "search" ? (
        <>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["pre_warmed_up", `Pre-warmed: send today (${s.preWarmed.length})`],
                ["dfy", `New lookalike domains: ~3 weeks warm-up (${s.fresh.length})`],
              ] as const
            ).map(([v, label]) => (
              <label key={v} className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm has-checked:border-accent has-checked:bg-accent-soft">
                <input type="radio" name="orderType" value={v} defaultChecked={s.orderType === v} className="accent-[var(--accent)]" />
                {label}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted">
            Switch the type, then click &ldquo;Find domains&rdquo; again to refresh the list. Pre-warmed domains already have aged, warmed mailboxes, so
            they can send today. New domains match your brand closely, but Instantly needs to warm them up first.
          </p>

          {list.length === 0 ? (
            <Notice tone="neutral">No {s.orderType === "pre_warmed_up" ? "pre-warmed" : "lookalike"} domains found for that keyword. Try a shorter brand word.</Notice>
          ) : (
            <div className="grid max-h-72 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              {list.map((d) => (
                <label key={d} className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 font-mono text-xs has-checked:border-accent has-checked:bg-accent-soft">
                  <input type="checkbox" name="domain" value={d} defaultChecked={s.selected.includes(d)} className="accent-[var(--accent)]" />
                  {d}
                </label>
              ))}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className="mb-1.5 block text-xs font-medium">Sender first name</span>
              <Input name="firstName" defaultValue={s.firstName} placeholder="Sam" />
            </label>
            <label>
              <span className="mb-1.5 block text-xs font-medium">Sender last name</span>
              <Input name="lastName" defaultValue={s.lastName} placeholder="Rivera" />
            </label>
          </div>
          <p className="text-xs text-muted">
            New domains get 3 Google mailboxes each (e.g. sam@, sam.rivera@, s.rivera@). At ~30 cold emails per mailbox per day, 10 domains ≈ 900
            emails/day.
          </p>

          <SubmitButton variant="secondary" pendingText="Pricing…" name="intent" value="quote">
            Get price (no charge)
          </SubmitButton>
        </>
      ) : null}

      {s.quote && s.step === "quoted" ? (
        <div className="space-y-3 rounded-xl border border-border bg-surface-2/50 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">Quote</span>
            {s.quote.order_is_valid ? <Badge tone="success">Valid</Badge> : <Badge tone="danger">{s.quote.order_error ?? "Not valid"}</Badge>}
          </div>
          <div className="num grid gap-2 sm:grid-cols-4">
            <div><div className="text-xs text-muted">Domains</div>{s.quote.number_of_domains_ordered ?? s.selected.length}</div>
            <div><div className="text-xs text-muted">Mailboxes</div>{s.quote.number_of_accounts_ordered ?? "—"}</div>
            <div><div className="text-xs text-muted">Per month</div>{usd(s.quote.total_price_per_month)}</div>
            <div><div className="text-xs text-muted">Due now</div>{usd(s.quote.total_price)}</div>
          </div>
          {s.quote.unavailable_domains?.length ? <p className="text-xs text-danger">Unavailable: {s.quote.unavailable_domains.join(", ")}</p> : null}
          {s.quote.blacklist_domains?.length ? <p className="text-xs text-danger">Blacklisted: {s.quote.blacklist_domains.join(", ")}</p> : null}
          {s.quote.invalid_accounts?.length ? (
            <p className="text-xs text-danger">Invalid mailboxes: {s.quote.invalid_accounts.map((a) => `${a.email} (${a.reason})`).join(", ")}</p>
          ) : null}
          {s.quote.order_is_valid ? (
            <div className="space-y-2 border-t border-border pt-3">
              <label className="flex items-start gap-2 text-xs">
                <input type="checkbox" name="confirm" value="yes" className="mt-0.5 accent-[var(--accent)]" />
                <span>
                  Buy these through Instantly. This charges the card on your Instantly account
                  {s.quote.payment_method_last_4_digits ? ` (${s.quote.payment_method_brand ?? "card"} ••${s.quote.payment_method_last_4_digits})` : ""}{" "}
                  {usd(s.quote.total_price)} now, then {usd(s.quote.total_price_per_month)}/month.
                </span>
              </label>
              <SubmitButton pendingText="Ordering…" name="intent" value="order">
                Buy mailboxes
              </SubmitButton>
            </div>
          ) : null}
        </div>
      ) : null}

      {s.result ? (
        s.result.order_placed ? (
          <Notice tone="success">
            Ordered {s.result.number_of_accounts_ordered ?? ""} mailboxes on {s.result.number_of_domains_ordered ?? s.selected.length} domain(s). Instantly
            sets up DNS (SPF, DKIM, DMARC) and the mailboxes automatically. They&apos;ll appear above within a few hours, and Kindling starts sending
            from each one as soon as its warm-up score reaches 80.
          </Notice>
        ) : s.result.checkout_required && s.result.checkout_url ? (
          <Notice tone="info">
            Instantly needs you to confirm payment:{" "}
            <a href={s.result.checkout_url} target="_blank" rel="noreferrer" className="font-medium underline">
              complete checkout ↗
            </a>
          </Notice>
        ) : (
          <Notice tone="danger">Order not placed: {s.result.order_error ?? s.result.payment_failure_reason ?? "unknown error"}</Notice>
        )
      ) : null}

      {s.error ? <p className="text-sm text-danger">{s.error}</p> : null}
    </form>
  );
}
