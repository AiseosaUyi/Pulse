"use client";

// Dashboard banner for the "Needs You" checklist — a collapsed summary that
// expands into the full list, computed live per tenant (see
// src/lib/services/setup-status.ts). Nothing here is tenant-specific; the
// same component renders whatever that tenant's own state produces.

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, CircleAlert, CheckCircle2, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SetupItem, SetupStatus } from "@/lib/services/setup-status";

const KIND_LABEL: Record<SetupItem["kind"], string> = {
  key: "Connect",
  "sign-in": "Sign in",
  info: "Fill in",
  decision: "Decide",
  access: "Needs a developer",
};

const PRIORITY_TONE: Record<SetupItem["priority"], string> = {
  P0: "border-status-red/30 bg-status-red/5",
  P1: "border-status-yellow/30 bg-status-yellow/5",
  P2: "border-border bg-sidebar",
};

export function NeedsYouBanner({ status }: { status: SetupStatus }) {
  const [expanded, setExpanded] = useState(false);
  const openItems = status.items.filter((i) => !i.done);
  const p0Open = openItems.filter((i) => i.priority === "P0");

  if (status.allDone) {
    return (
      <div className="rounded-2xl border border-status-green/30 bg-status-green/5 px-4 py-3 flex items-center gap-2.5 text-sm text-status-green">
        <CheckCircle2 size={16} className="shrink-0" />
        Everything Pulse needs from you is set up.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-card-hover transition-colors"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={cn(
              "h-8 w-8 rounded-full flex items-center justify-center shrink-0",
              p0Open.length > 0
                ? "bg-status-red/10 text-status-red"
                : "bg-status-yellow/10 text-status-yellow"
            )}
          >
            <CircleAlert size={15} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">
              Needs you — {openItems.length} open item{openItems.length === 1 ? "" : "s"}
              {p0Open.length > 0 && (
                <span className="text-status-red"> ({p0Open.length} blocking)</span>
              )}
            </p>
            <p className="text-xs text-text-muted mt-0.5">
              {status.doneCount}/{status.total} set up
            </p>
          </div>
        </div>
        {expanded ? <ChevronUp size={16} className="text-text-muted shrink-0" /> : <ChevronDown size={16} className="text-text-muted shrink-0" />}
      </button>

      {expanded && (
        <div className="border-t border-border px-4 py-3 space-y-2">
          {openItems.map((item) => (
            <div
              key={item.key}
              className={cn(
                "flex items-start justify-between gap-3 rounded-lg border px-3 py-2.5",
                PRIORITY_TONE[item.priority]
              )}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-foreground">{item.label}</span>
                  <span className="text-[10px] uppercase tracking-wide text-text-muted px-1.5 py-0.5 rounded-full bg-sidebar border border-border/50">
                    {KIND_LABEL[item.kind]}
                  </span>
                </div>
                <p className="text-xs text-text-muted mt-0.5">{item.unblocks}</p>
              </div>
              {item.href ? (
                <Link
                  href={item.href}
                  className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-primary-500 hover:text-primary-600 px-2.5 py-1.5 rounded-md hover:bg-primary-500/10 whitespace-nowrap"
                >
                  Fix <ArrowUpRight size={12} />
                </Link>
              ) : (
                <span className="shrink-0 text-xs text-text-muted whitespace-nowrap">{item.hint}</span>
              )}
            </div>
          ))}
          <Link
            href="/needs-you"
            className="block text-center text-xs text-primary-500 hover:underline pt-1"
          >
            View full checklist →
          </Link>
        </div>
      )}
    </div>
  );
}
