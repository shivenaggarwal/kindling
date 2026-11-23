"use server";

import { refresh } from "next/cache";
import { env } from "./config";
import * as instantly from "./instantly/client";
import { connectWebhook } from "./pipeline/instantly";

export type ActionNote = { ok: boolean; message: string } | null;

export async function enableWarmupAll(): Promise<void> {
  await instantly.enableWarmup("all");
  refresh();
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature required by useActionState
export async function connectWebhookAction(_prev: ActionNote): Promise<ActionNote> {
  try {
    await connectWebhook();
    refresh();
    return { ok: true, message: "Connected. Instantly now sends replies, bounces and unsubscribes to Kindling instantly." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export type ShopState = {
  step: "search" | "results" | "quoted" | "done";
  keyword: string;
  orderType: "pre_warmed_up" | "dfy";
  preWarmed: string[];
  fresh: string[];
  selected: string[];
  firstName: string;
  lastName: string;
  quote?: instantly.DfyOrderResult;
  result?: instantly.DfyOrderResult;
  error?: string;
};

const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]/g, "");

function orderItems(state: ShopState): instantly.DfyOrderItem[] {
  if (state.orderType === "pre_warmed_up") return state.selected.map((domain) => ({ domain }));
  const f = clean(state.firstName) || "hello";
  const l = clean(state.lastName);
  const prefixes = Array.from(new Set([f, l ? `${f}.${l}` : `${f}.team`, l ? `${f[0]}.${l}` : `${f}1`]));
  return state.selected.map((domain) => ({
    domain,
    email_provider: 1,
    accounts: prefixes.map((p) => ({
      email_address_prefix: p,
      first_name: state.firstName || "Hello",
      last_name: state.lastName || "Team",
    })),
  }));
}

/** Multi-step flow: find domains → price quote (no charge) → place order. */
export async function domainShop(prev: ShopState, fd: FormData): Promise<ShopState> {
  const intent = String(fd.get("intent") ?? "search");
  const state: ShopState = {
    ...prev,
    keyword: String(fd.get("keyword") ?? prev.keyword).trim(),
    orderType: fd.get("orderType") === "dfy" ? "dfy" : "pre_warmed_up",
    selected: fd.getAll("domain").map(String),
    firstName: String(fd.get("firstName") ?? prev.firstName).trim(),
    lastName: String(fd.get("lastName") ?? prev.lastName).trim(),
    error: undefined,
  };
  if (!env.instantlyKey) return { ...state, error: "Set INSTANTLY_API_KEY first." };

  try {
    if (intent === "search") {
      const kw = clean(state.keyword.replace(/\.(com|org|co|io)$/, ""));
      if (!kw) return { ...state, error: "Enter your brand name, e.g. larksilk" };
      const [pre, similar] = await Promise.allSettled([instantly.preWarmedDomains(kw), instantly.similarDomains(`${kw}.com`)]);
      return {
        ...state,
        step: "results",
        quote: undefined,
        result: undefined,
        preWarmed: pre.status === "fulfilled" ? (pre.value.domains ?? []).slice(0, 40) : [],
        fresh: similar.status === "fulfilled" ? (similar.value.domains ?? []).slice(0, 40) : [],
        selected: [],
        error:
          pre.status === "rejected" && similar.status === "rejected"
            ? (pre.reason as Error).message
            : undefined,
      };
    }

    if (!state.selected.length) return { ...state, error: "Pick at least one domain." };
    if (state.orderType === "dfy" && !state.firstName) return { ...state, error: "Enter the sender's first and last name for the new mailboxes." };

    if (intent === "quote") {
      const quote = await instantly.placeDfyOrder({ items: orderItems(state), order_type: state.orderType, simulation: true });
      return { ...state, step: "quoted", quote };
    }

    if (intent === "order") {
      if (fd.get("confirm") !== "yes") return { ...state, error: "Tick the box to confirm the purchase." };
      const result = await instantly.placeDfyOrder({ items: orderItems(state), order_type: state.orderType, simulation: false });
      refresh();
      return { ...state, step: "done", result };
    }
  } catch (e) {
    return { ...state, error: e instanceof Error ? e.message : String(e) };
  }
  return state;
}
