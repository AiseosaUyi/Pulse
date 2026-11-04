"use client";

import { useState } from "react";
import {
  Copy,
  Check,
  Calendar,
  Share2,
  AlertCircle,
  CheckCircle2,
  Flame,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/Toaster";
import type { StandupReport, TeamPerson } from "@/lib/types/tasks";

interface StandupTabProps {
  initialReport: StandupReport;
  people: TeamPerson[];
  tenantSlug: string;
}

export function StandupTab({ initialReport, people, tenantSlug }: StandupTabProps) {
  const [report, setReport] = useState<StandupReport>(initialReport);
  const [from, setFrom] = useState(initialReport.range.from);
  const [to, setTo] = useState(initialReport.range.to);
  const [personId, setPersonId] = useState<string>("all");
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchReport = async (newFrom = from, newTo = to, newPerson = personId) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ from: newFrom, to: newTo });
      if (newPerson !== "all") params.set("person", newPerson);

      const res = await fetch(`/api/v1/tasks/report?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load standup report");
      const data = await res.json();
      setReport(data);
    } catch {
      toast.error("Could not refresh report");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyWhatsApp = async () => {
    try {
      await navigator.clipboard.writeText(report.whatsAppText);
      setCopied(true);
      toast.success("Copied for WhatsApp! Ready to paste into group");
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error("Failed to copy to clipboard");
    }
  };

  return (
    <div className="space-y-6">
      {/* Controls & Range Selector */}
      <div className="p-4 rounded-2xl border border-border bg-card flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <Calendar size={14} className="text-primary-500" />
            <span>Range:</span>
          </div>

          <Input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              fetchReport(e.target.value, to, personId);
            }}
            className="w-36 text-xs h-8"
          />
          <span className="text-text-muted text-xs">to</span>
          <Input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              fetchReport(from, e.target.value, personId);
            }}
            className="w-36 text-xs h-8"
          />

          <select
            value={personId}
            onChange={(e) => {
              setPersonId(e.target.value);
              fetchReport(from, to, e.target.value);
            }}
            className="h-8 px-2.5 rounded-lg border border-border bg-background text-foreground text-xs"
          >
            <option value="all">Everyone</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <Button
          onClick={handleCopyWhatsApp}
          className="flex items-center gap-2 h-9 text-xs font-semibold px-4 self-start md:self-auto bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied!" : "Copy for WhatsApp"}
        </Button>
      </div>

      {/* Per Person Standup Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {report.people.map((p) => (
          <div
            key={p.person.id}
            className="rounded-2xl border border-border bg-card p-5 space-y-4"
          >
            {/* Person Header */}
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-base font-bold text-foreground">{p.person.name}</h3>
                <p className="text-xs text-text-muted">
                  {p.completedTasks.length} task{p.completedTasks.length === 1 ? "" : "s"} completed
                </p>
              </div>

              {p.breaches.length === 0 ? (
                <span className="text-xs font-bold text-success-500 bg-success-500/10 px-2.5 py-1 rounded-full border border-success-500/20 flex items-center gap-1">
                  <CheckCircle2 size={13} />
                  100% On Track
                </span>
              ) : (
                <span className="text-xs font-bold text-error-500 bg-error-500/10 px-2.5 py-1 rounded-full border border-error-500/20 flex items-center gap-1">
                  <AlertCircle size={13} />
                  {p.breaches.length} Breach{p.breaches.length === 1 ? "" : "es"}
                </span>
              )}
            </div>

            {/* Daily Habits & Recurring Rates */}
            {p.recurringStats.length > 0 && (
              <div className="space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted block">
                  Daily Habits & Completion Rate
                </span>
                <div className="space-y-1.5">
                  {p.recurringStats.map((r, i) => (
                    <div
                      key={i}
                      className="p-2.5 rounded-lg border border-border bg-background flex items-center justify-between text-xs"
                    >
                      <span className="font-medium text-foreground">{r.taskTitle}</span>
                      <span className="font-bold text-foreground">
                        {r.done} of {r.total}{" "}
                        <span
                          className={
                            r.rate >= 80
                              ? "text-success-500"
                              : r.rate >= 50
                              ? "text-warning-500"
                              : "text-error-500"
                          }
                        >
                          ({r.rate}%)
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Metrics Achieved */}
            {p.metricTotals.length > 0 && (
              <div className="space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted block">
                  Metrics & Volumes
                </span>
                <div className="flex flex-wrap gap-2">
                  {p.metricTotals.map((m, i) => (
                    <div
                      key={i}
                      className="px-3 py-1.5 rounded-lg border border-border bg-background text-xs font-medium text-foreground"
                    >
                      <strong className="text-primary-500 font-bold">{m.total}</strong>{" "}
                      {m.label}
                      {m.target ? (
                        <span className="text-text-muted text-[11px]">
                          {" "}
                          / {m.target} target
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Breaches List */}
            {p.breaches.length > 0 && (
              <div className="space-y-2 pt-1 border-t border-border">
                <span className="text-[10px] font-bold uppercase tracking-wider text-error-500 block">
                  Breaches (Missed Days)
                </span>
                <div className="space-y-1">
                  {p.breaches.map((b, i) => (
                    <div
                      key={i}
                      className="text-xs text-error-500 font-medium flex items-center gap-1.5"
                    >
                      <span>❌</span>
                      <span>{b.taskTitle}</span>
                      <span className="text-text-muted font-mono">({b.occursOn})</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Open One-off Tasks */}
            {p.openOneOffTasks.length > 0 && (
              <div className="space-y-2 pt-1 border-t border-border">
                <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted block">
                  Open One-Off Tasks
                </span>
                <div className="space-y-1.5">
                  {p.openOneOffTasks.map((o, i) => (
                    <div
                      key={i}
                      className="p-2 rounded-lg border border-border bg-background flex items-center justify-between text-xs"
                    >
                      <span className="text-foreground font-medium">{o.title}</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-text-muted">Due {o.dueDate}</span>
                        {o.daysOverdue > 0 && (
                          <span className="text-[10px] font-bold text-error-500 bg-error-500/10 px-1.5 py-0.5 rounded-full border border-error-500/20">
                            {o.daysOverdue}d overdue
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Raw WhatsApp Preview Accordion */}
      <details className="rounded-2xl border border-border bg-card">
        <summary className="p-4 text-xs font-bold text-text-muted cursor-pointer hover:text-foreground flex items-center justify-between">
          <span>Preview Plain Text (WhatsApp Format)</span>
          <span className="text-[11px] font-normal">Click to expand</span>
        </summary>
        <div className="p-5 pt-0">
          <pre className="p-4 rounded-xl bg-background border border-border text-xs text-text-secondary whitespace-pre-wrap font-mono select-all">
            {report.whatsAppText}
          </pre>
        </div>
      </details>
    </div>
  );
}
