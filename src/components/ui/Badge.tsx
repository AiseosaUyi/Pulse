import { type ReactNode } from "react";

type BadgeVariant =
  | "gradient"
  | "active"
  | "needs_posts"
  | "low_activity"
  | "high_impact"
  | "urgent"
  | "overdue"
  | "opportunity"
  | "published"
  | "draft_status"
  | "planned"
  | "gap"
  | "informational"
  | "transactional"
  | "navigational"
  | "commercial";

interface BadgeProps {
  variant: BadgeVariant;
  children: ReactNode;
}

const variantStyles: Record<BadgeVariant, string> = {
  gradient:
    "bg-gradient-to-r from-accent-purple to-accent-pink text-white",
  active:
    "border border-status-green/30 text-status-green bg-status-green/10",
  needs_posts:
    "border border-status-yellow/30 text-status-yellow bg-status-yellow/10",
  low_activity:
    "border border-status-red/30 text-status-red bg-status-red/10",
  high_impact:
    "border border-status-purple/30 text-status-purple bg-status-purple/10",
  urgent:
    "border border-status-red/30 text-status-red bg-status-red/10",
  overdue:
    "border border-status-red/30 text-status-red bg-status-red/10",
  opportunity:
    "border border-status-teal/30 text-status-teal bg-status-teal/10",
  published:
    "border border-status-green/30 text-status-green bg-status-green/10",
  draft_status:
    "border border-status-yellow/30 text-status-yellow bg-status-yellow/10",
  planned:
    "border border-status-teal/30 text-status-teal bg-status-teal/10",
  gap:
    "border border-status-red/30 border-dashed text-status-red bg-status-red/5",
  informational:
    "border border-blue-400/30 text-blue-400 bg-blue-400/10",
  transactional:
    "border border-status-green/30 text-status-green bg-status-green/10",
  navigational:
    "border border-status-purple/30 text-status-purple bg-status-purple/10",
  commercial:
    "border border-status-yellow/30 text-status-yellow bg-status-yellow/10",
};

const variantLabels: Partial<Record<BadgeVariant, string>> = {
  active: "Active",
  needs_posts: "Needs posts",
  low_activity: "Low activity",
};

export function Badge({ variant, children }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap ${variantStyles[variant]}`}
    >
      {children ?? variantLabels[variant]}
    </span>
  );
}
