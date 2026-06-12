"use client";

import { useState, useTransition } from "react";
import { ShoppingCart, Plus } from "lucide-react";
import { createManualOrder } from "@/lib/actions/orders";
import { toast } from "@/components/ui/Toaster";
import type { OrderRecord, OrderStats } from "@/lib/services/orders";

function money(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function OrdersClient({
  orders,
  stats,
}: {
  orders: OrderRecord[];
  stats: OrderStats;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const res = await createManualOrder(formData);
      if (res.success) {
        toast.success("Order logged");
        setOpen(false);
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="p-4 md:p-8 max-w-[1100px] mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <ShoppingCart size={20} className="text-primary-500" />
          <div>
            <h1 className="text-xl md:text-2xl text-gray-1100 dark:text-foreground">
              Orders
            </h1>
            <p className="text-sm text-text-muted mt-0.5">
              Every drink order — from the storefront webhook or logged by hand —
              tied back to the campaign that drove it.
            </p>
          </div>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary-500 text-white px-4 py-2 text-sm font-medium hover:bg-primary-600 transition-colors"
        >
          <Plus size={16} /> Log order
        </button>
      </header>

      <div className="grid grid-cols-3 gap-3 mb-6">
        <Stat label="Orders (30d)" value={String(stats.count)} />
        <Stat label="Revenue (30d)" value={money(stats.revenue, stats.currency)} />
        <Stat
          label="Attributed"
          value={`${stats.attributedCount}/${stats.count}`}
          hint="carry a campaign tag"
        />
      </div>

      {open && (
        <form
          action={onSubmit}
          className="bg-card border border-border rounded-2xl p-4 mb-6 grid grid-cols-2 md:grid-cols-3 gap-3"
        >
          <Field label="Amount">
            <input
              name="amount"
              type="number"
              step="0.01"
              placeholder="5000"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Currency">
            <input
              name="currency"
              defaultValue="NGN"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Channel">
            <select
              name="channel"
              defaultValue="whatsapp"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="whatsapp">WhatsApp</option>
              <option value="dm">DM</option>
              <option value="phone">Phone</option>
              <option value="web">Web</option>
            </select>
          </Field>
          <Field label="Status">
            <select
              name="status"
              defaultValue="paid"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="paid">Paid</option>
              <option value="created">Created</option>
              <option value="fulfilled">Fulfilled</option>
            </select>
          </Field>
          <Field label="Campaign (utm)">
            <input
              name="utm_campaign"
              placeholder="weekend-promo"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Source">
            <input
              name="source"
              placeholder="broadcast / post"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </Field>
          <div className="col-span-2 md:col-span-3 flex justify-end">
            <button
              type="submit"
              disabled={pending}
              className="rounded-full bg-primary-500 text-white px-4 py-2 text-sm font-medium disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save order"}
            </button>
          </div>
        </form>
      )}

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        {orders.length === 0 ? (
          <p className="text-sm text-text-muted text-center py-12">
            No orders yet. They appear here once the storefront webhook fires or
            you log one by hand.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-text-muted">
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-4 py-3 font-medium">Channel</th>
                <th className="px-4 py-3 font-medium">Campaign</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b border-border/50 last:border-0">
                  <td className="px-4 py-3 text-text-secondary">
                    {new Date(o.createdAt).toLocaleString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-4 py-3 capitalize">{o.channel}</td>
                  <td className="px-4 py-3 text-text-secondary">
                    {o.utmCampaign ?? "—"}
                  </td>
                  <td className="px-4 py-3 capitalize">{o.status}</td>
                  <td className="px-4 py-3 text-right">
                    {o.amount != null ? money(o.amount, o.currency) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-2xl p-4">
      <p className="text-xs text-text-muted">{label}</p>
      <p className="text-xl font-semibold text-foreground mt-1">{value}</p>
      {hint && <p className="text-[11px] text-text-muted mt-0.5">{hint}</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-text-muted mb-1 block">{label}</span>
      {children}
    </label>
  );
}
