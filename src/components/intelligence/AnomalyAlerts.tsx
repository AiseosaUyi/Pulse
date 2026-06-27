"use client";

import { useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import type { AnomalyAlert } from "@/lib/services/cross-brand";

interface AnomalyAlertsProps {
  alerts: AnomalyAlert[];
}

const typeIcon: Record<string, string> = {
  engagement_spike: "⚡",
  viral_post: "🔥",
  new_platform: "🆕",
};

const typeLabel: Record<string, string> = {
  engagement_spike: "Engagement Spike",
  viral_post: "Viral Post",
  new_platform: "New Platform",
};

export function AnomalyAlerts({ alerts: initialAlerts }: AnomalyAlertsProps) {
  const [alerts, setAlerts] = useState(initialAlerts);
  const visible = alerts.filter((a) => !a.dismissed);

  if (visible.length === 0) return null;

  const dismiss = (id: string) => {
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, dismissed: true } : a)));
  };

  return (
    <div className="mb-4 space-y-2">
      {visible.map((alert) => (
        <div
          key={alert.id}
          className="flex items-start gap-3 rounded-lg border border-status-yellow/20 bg-status-yellow/[0.06] px-4 py-3"
        >
          <span className="text-base shrink-0 mt-0.5">
            {typeIcon[alert.type]}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-xs font-semibold text-status-yellow uppercase tracking-wide">
                {typeLabel[alert.type]}
              </span>
              <span className="text-xs text-text-muted">
                {alert.competitorName} · {alert.platform}
              </span>
            </div>
            <p className="text-sm text-foreground/80 leading-snug">
              {alert.message}
            </p>
          </div>
          <Link
            href={`/composer?angle=${encodeURIComponent(`${alert.competitorName} got ${alert.multiplier}x engagement on ${alert.platform}: ${alert.message}`)}`}
            className="shrink-0 text-[11px] font-medium text-primary-500 hover:underline whitespace-nowrap"
          >
            Draft about this →
          </Link>
          <button
            onClick={() => dismiss(alert.id)}
            className="p-1 rounded hover:bg-card-hover transition-colors shrink-0"
            aria-label="Dismiss alert"
          >
            <X size={14} className="text-text-muted" />
          </button>
        </div>
      ))}
    </div>
  );
}
