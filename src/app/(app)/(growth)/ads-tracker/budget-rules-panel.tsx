"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createBudgetRuleAction, toggleBudgetRuleAction, deleteBudgetRuleAction } from "@/lib/actions/ads-platform";
import type { AdAccountRecord, AdBudgetRuleRecord, BudgetRuleAction, BudgetRuleComparator, BudgetRuleMetric, BudgetRuleScope } from "@/lib/types/ads-platform";

const METRICS: BudgetRuleMetric[] = ["cpa", "roas", "ctr", "frequency", "spend", "cpm"];
const COMPARATORS: Array<{ value: BudgetRuleComparator; label: string }> = [
  { value: "gt", label: "is greater than" },
  { value: "lt", label: "is less than" },
  { value: "gte", label: "is greater than or equal to" },
  { value: "lte", label: "is less than or equal to" },
];
const ACTIONS: Array<{ value: BudgetRuleAction; label: string }> = [
  { value: "notify_only", label: "Just alert me" },
  { value: "pause", label: "Pause the campaign" },
  { value: "increase_budget", label: "Increase budget" },
  { value: "decrease_budget", label: "Decrease budget" },
];
const SCOPES: BudgetRuleScope[] = ["campaign", "adset", "account"];

export function BudgetRulesPanel({
  tenantSlug,
  accounts,
  initialRules,
}: {
  tenantSlug: string;
  accounts: AdAccountRecord[];
  initialRules: AdBudgetRuleRecord[];
}) {
  void tenantSlug;
  const router = useRouter();
  const [rules, setRules] = useState(initialRules);
  const [showForm, setShowForm] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [scope, setScope] = useState<BudgetRuleScope>("campaign");
  const [metric, setMetric] = useState<BudgetRuleMetric>("cpa");
  const [comparator, setComparator] = useState<BudgetRuleComparator>("gt");
  const [threshold, setThreshold] = useState("");
  const [holdDays, setHoldDays] = useState("3");
  const [action, setAction] = useState<BudgetRuleAction>("notify_only");
  const [actionAmountPct, setActionAmountPct] = useState("20");
  const [adAccountId, setAdAccountId] = useState(accounts[0]?.id ?? "");

  const handleCreate = () => {
    setError(null);
    if (!name.trim() || !threshold) {
      setError("Name and threshold are required.");
      return;
    }
    startTransition(async () => {
      const res = await createBudgetRuleAction({
        adAccountId: adAccountId || undefined,
        name: name.trim(),
        scope,
        metric,
        comparator,
        threshold: Number(threshold),
        holdDays: Number(holdDays) || 3,
        action,
        actionAmountPct: action.includes("budget") ? Number(actionAmountPct) || 20 : undefined,
      });
      if (!res.success) {
        setError(res.error);
        return;
      }
      setShowForm(false);
      setName("");
      setThreshold("");
      router.refresh();
    });
  };

  const handleToggle = (rule: AdBudgetRuleRecord) => {
    startTransition(async () => {
      await toggleBudgetRuleAction(rule.id, !rule.enabled);
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r)));
    });
  };

  const handleDelete = (rule: AdBudgetRuleRecord) => {
    startTransition(async () => {
      await deleteBudgetRuleAction(rule.id);
      setRules((prev) => prev.filter((r) => r.id !== rule.id));
    });
  };

  return (
    <section className="bg-card rounded-2xl border border-border/50 p-5">
      <div className="flex items-start justify-between mb-4 gap-2 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Budget guardrail rules</h2>
          <p className="text-xs text-text-muted mt-1">
            A metric must hold past its threshold for every day in the hold window before a rule acts — one bad day never fires it.
          </p>
        </div>
        <Button size="sm" variant={showForm ? "outline" : "default"} onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ New rule"}
        </Button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-border/50 p-4 mb-4 space-y-3">
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-text-muted">Rule name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pause high-CPA campaigns" className="mt-1 w-full h-9 rounded-lg border border-border bg-card px-3 text-sm text-foreground" />
            </div>
            <div>
              <label className="text-xs text-text-muted">Ad account</label>
              <select value={adAccountId} onChange={(e) => setAdAccountId(e.target.value)} className="mt-1 w-full h-9 rounded-lg border border-border bg-card px-3 text-sm text-foreground">
                <option value="">All accounts</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.accountName ?? a.externalAccountId} ({a.platform})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid md:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-text-muted">Scope</label>
              <select value={scope} onChange={(e) => setScope(e.target.value as BudgetRuleScope)} className="mt-1 w-full h-9 rounded-lg border border-border bg-card px-2 text-sm text-foreground capitalize">
                {SCOPES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-text-muted">Metric</label>
              <select value={metric} onChange={(e) => setMetric(e.target.value as BudgetRuleMetric)} className="mt-1 w-full h-9 rounded-lg border border-border bg-card px-2 text-sm text-foreground uppercase">
                {METRICS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-text-muted">Condition</label>
              <select value={comparator} onChange={(e) => setComparator(e.target.value as BudgetRuleComparator)} className="mt-1 w-full h-9 rounded-lg border border-border bg-card px-2 text-sm text-foreground">
                {COMPARATORS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-text-muted">Threshold</label>
              <input type="number" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="e.g. 5000" className="mt-1 w-full h-9 rounded-lg border border-border bg-card px-3 text-sm text-foreground" />
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-text-muted">Hold for (days)</label>
              <input type="number" min={1} max={14} value={holdDays} onChange={(e) => setHoldDays(e.target.value)} className="mt-1 w-full h-9 rounded-lg border border-border bg-card px-3 text-sm text-foreground" />
            </div>
            <div>
              <label className="text-xs text-text-muted">Then</label>
              <select value={action} onChange={(e) => setAction(e.target.value as BudgetRuleAction)} className="mt-1 w-full h-9 rounded-lg border border-border bg-card px-2 text-sm text-foreground">
                {ACTIONS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
            {action.includes("budget") && (
              <div>
                <label className="text-xs text-text-muted">By (%)</label>
                <input type="number" min={1} max={100} value={actionAmountPct} onChange={(e) => setActionAmountPct(e.target.value)} className="mt-1 w-full h-9 rounded-lg border border-border bg-card px-3 text-sm text-foreground" />
              </div>
            )}
          </div>

          {error && <p className="text-xs text-status-red">{error}</p>}
          <Button size="sm" onClick={handleCreate} disabled={isPending}>
            {isPending ? "Creating…" : "Create rule"}
          </Button>
        </div>
      )}

      {rules.length === 0 ? (
        <p className="text-sm text-text-muted">No budget rules yet.</p>
      ) : (
        <div className="space-y-2">
          {rules.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/50 p-3">
              <div>
                <p className="text-sm font-medium text-foreground">{r.name}</p>
                <p className="text-xs text-text-muted">
                  {r.scope} · {r.metric.toUpperCase()} {r.comparator} {r.threshold} held {r.holdDays}d → {r.action.replace(/_/g, " ")}
                  {r.lastEvaluatedAt ? ` · last checked ${new Date(r.lastEvaluatedAt).toLocaleString()}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => handleToggle(r)} disabled={isPending} className={`text-xs px-2 py-1 rounded ${r.enabled ? "text-status-green" : "text-text-muted"}`}>
                  {r.enabled ? "Enabled" : "Disabled"}
                </button>
                <button onClick={() => handleDelete(r)} disabled={isPending} className="text-xs text-status-red hover:underline">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
