"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Circle,
  Rocket,
  ChevronDown,
  ChevronUp,
  ArrowUpRight,
} from "lucide-react";
import type { SetupStatus } from "@/lib/services/setup-status";

// Account/integration connection banner ("Connect your accounts") — distinct
// from the sidebar's OnboardingChecklist ("Content setup"), which tracks
// content-strategy activation instead. Collapsed by default so the tenant's
// real stat cards above lead the Dashboard; stays on the page until every
// setup task is done (then it renders nothing). Items tick off automatically
// — the state is recomputed server-side on each dashboard load, no manual
// checking off.
export function SetupBanner({ status }: { status: SetupStatus }) {
  const [open, setOpen] = useState(false);

  if (status.allDone) return null;

  const remaining = status.total - status.doneCount;
  const pct = Math.round((status.doneCount / status.total) * 100);

  return (
    <div className="mb-6 rounded-2xl border border-primary-500/30 bg-primary-500/5 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <Rocket size={18} className="text-primary-500 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              Connect your accounts
            </p>
            <p className="text-xs text-text-muted">
              {status.doneCount} of {status.total} done · {remaining} to go
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="hidden sm:block w-28 h-1.5 rounded-full bg-border overflow-hidden">
            <div
              className="h-full bg-primary-500 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          {open ? (
            <ChevronUp size={16} className="text-text-muted" />
          ) : (
            <ChevronDown size={16} className="text-text-muted" />
          )}
        </div>
      </button>

      {open && (
        <ul className="px-4 pb-3 space-y-1">
          {status.items.map((item) => {
            const row = (
              <div
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 ${
                  item.done
                    ? "opacity-60"
                    : item.href
                      ? "hover:bg-card transition-colors"
                      : ""
                }`}
              >
                {item.done ? (
                  <CheckCircle2 size={16} className="text-green-600 shrink-0" />
                ) : (
                  <Circle size={16} className="text-text-muted shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-sm ${
                      item.done
                        ? "text-text-muted line-through"
                        : "text-foreground"
                    }`}
                  >
                    {item.label}
                  </p>
                  {!item.done && (
                    <p className="text-xs text-text-muted">{item.hint}</p>
                  )}
                </div>
                {!item.done && item.href && (
                  <ArrowUpRight size={14} className="text-primary-500 shrink-0" />
                )}
              </div>
            );

            return (
              <li key={item.key}>
                {!item.done && item.href ? (
                  <Link href={item.href}>{row}</Link>
                ) : (
                  row
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
