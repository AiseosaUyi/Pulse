"use client";

import { useState, useTransition } from "react";
import { Plus, Send, Users, Radio } from "lucide-react";
import {
  createBroadcastList,
  addBroadcastMembers,
  sendBroadcast,
} from "@/lib/actions/broadcasts";
import { toast } from "@/components/ui/Toaster";
import { WhatsAppConnectCard } from "./WhatsAppConnectCard";
import type {
  BroadcastList,
  BroadcastMessage,
  WhatsappConnectionStatus,
} from "@/lib/services/broadcasts";

export function BroadcastsClient({
  lists,
  messages,
  whatsappStatus,
}: {
  lists: BroadcastList[];
  messages: BroadcastMessage[];
  whatsappStatus: WhatsappConnectionStatus;
}) {
  const [pending, startTransition] = useTransition();
  const [activeList, setActiveList] = useState<string | null>(
    lists[0]?.id ?? null
  );

  function createList(formData: FormData) {
    const name = String(formData.get("name") ?? "");
    startTransition(async () => {
      const res = await createBroadcastList(name);
      res.success ? toast.success("List created") : toast.error(res.error);
    });
  }

  function addMembers(formData: FormData) {
    if (!activeList) return toast.error("Pick a list first");
    const raw = String(formData.get("phones") ?? "");
    const members = raw
      .split(/[\n,]/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((phone) => ({ phone }));
    startTransition(async () => {
      const res = await addBroadcastMembers(activeList, members);
      res.success
        ? toast.success(`${res.added} added`)
        : toast.error(res.error);
    });
  }

  function send(formData: FormData) {
    if (!activeList) return toast.error("Pick a list first");
    const body = String(formData.get("body") ?? "");
    const ctaUrl = String(formData.get("ctaUrl") ?? "").trim() || undefined;
    const templateName =
      String(formData.get("templateName") ?? "").trim() || undefined;
    startTransition(async () => {
      const res = await sendBroadcast({ listId: activeList, body, ctaUrl, templateName });
      res.success
        ? toast.success(`Sent ${res.sent}, failed ${res.failed}`)
        : toast.error(res.error);
    });
  }

  return (
    <div className="p-4 md:p-8 max-w-[1100px] mx-auto">
      <header className="flex items-center gap-2 mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">
            WhatsApp Broadcasts
          </h1>
          <p className="text-sm text-text-muted mt-0.5">
            Weekend deals to opted-in customers. Use <code>{"{link}"}</code> in
            the body and a CTA URL to drop a tracked link that ties clicks to
            orders.
          </p>
        </div>
      </header>

      <div className="mb-6">
        <WhatsAppConnectCard status={whatsappStatus} />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <section className="space-y-4">
          <div className="bg-card border border-border rounded-2xl p-4">
            <h2 className="text-sm font-medium text-foreground mb-3">Lists</h2>
            <ul className="space-y-1 mb-3">
              {lists.map((l) => (
                <li key={l.id}>
                  <button
                    onClick={() => setActiveList(l.id)}
                    className={`w-full text-left rounded-lg px-3 py-2 text-sm transition-colors ${
                      activeList === l.id
                        ? "bg-primary-500/10 text-primary-500"
                        : "hover:bg-sidebar text-text-secondary"
                    }`}
                  >
                    {l.name}{" "}
                    <span className="text-text-muted">({l.memberCount})</span>
                  </button>
                </li>
              ))}
              {lists.length === 0 && (
                <li className="py-5 text-center">
                  <Users size={20} className="mx-auto mb-2 text-text-muted opacity-40" />
                  <p className="text-sm font-medium text-foreground">No lists yet</p>
                  <p className="text-xs text-text-muted mt-0.5">
                    Create one below to start grouping opted-in numbers.
                  </p>
                </li>
              )}
            </ul>
            <form action={createList} className="flex gap-2">
              <input
                name="name"
                placeholder="New list name"
                className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
              <button
                disabled={pending}
                className="rounded-full bg-primary-500 text-white px-3 py-2 text-sm disabled:opacity-60"
              >
                <Plus size={16} />
              </button>
            </form>
          </div>

          <form
            action={addMembers}
            className="bg-card border border-border rounded-2xl p-4"
          >
            <h2 className="text-sm font-medium text-foreground mb-2">
              Add members {activeList ? "" : "(pick a list)"}
            </h2>
            <textarea
              name="phones"
              rows={3}
              placeholder="+2348030000000, +2348090000000 (comma or newline separated)"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm mb-2"
            />
            <button
              disabled={pending || !activeList}
              className="rounded-full bg-background text-foreground border border-border px-4 py-2 text-sm disabled:opacity-60"
            >
              Add to list
            </button>
          </form>
        </section>

        <section className="space-y-4">
          <form
            action={send}
            className="bg-card border border-border rounded-2xl p-4 space-y-2"
          >
            <h2 className="text-sm font-medium text-foreground">Send broadcast</h2>
            <textarea
              name="body"
              rows={4}
              placeholder="🔥 Weekend deal: Buy 2 get 1 free. Order here 👉 {link}"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
            <input
              name="ctaUrl"
              placeholder="CTA URL (replaces {link} with a tracked short link)"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
            <input
              name="templateName"
              placeholder="Meta template name (required outside 24h window)"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
            <button
              disabled={pending || !activeList || !whatsappStatus.connected}
              title={
                !whatsappStatus.connected
                  ? "Connect WhatsApp above before sending"
                  : undefined
              }
              className="inline-flex items-center gap-1.5 rounded-full bg-primary-500 text-white px-4 py-2 text-sm font-medium disabled:opacity-60"
            >
              <Send size={15} /> Send
            </button>
          </form>

          <div className="bg-card border border-border rounded-2xl p-4">
            <h2 className="text-sm font-medium text-foreground mb-2">Recent</h2>
            <ul className="space-y-2">
              {messages.map((m) => (
                <li key={m.id} className="text-sm border-b border-border/50 pb-2 last:border-0">
                  <p className="text-text-secondary line-clamp-2">{m.body}</p>
                  <p className="text-xs text-text-muted mt-0.5">
                    {m.status} · sent {m.sentCount} · failed {m.failedCount}
                  </p>
                </li>
              ))}
              {messages.length === 0 && (
                <li className="py-5 text-center">
                  <Radio size={20} className="mx-auto mb-2 text-text-muted opacity-40" />
                  <p className="text-sm font-medium text-foreground">No broadcasts yet</p>
                  <p className="text-xs text-text-muted mt-0.5">
                    Send your first weekend deal above — it&apos;ll show up here.
                  </p>
                </li>
              )}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
