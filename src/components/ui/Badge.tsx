import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

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
  | "publish_failed"
  | "approved"
  | "dismissed"
  | "planned"
  | "gap"
  | "informational"
  | "transactional"
  | "navigational"
  | "commercial";

interface BadgeProps {
  variant: BadgeVariant;
  children?: ReactNode;
  className?: string;
}

// All pills share the same shell; only fill/border/text-color vary.
const variantStyles: Record<BadgeVariant, string> = {
  gradient:        "bg-primary-500 text-white",
  active:          "bg-success-1000 text-success-500 border border-success-500/20",
  needs_posts:     "bg-warning-50 text-warning-500 border border-warning-500/20",
  low_activity:    "bg-primary-50 text-primary-500 border border-primary-500/20",
  high_impact:     "bg-primary-50 text-primary-500 border border-primary-500/30",
  urgent:          "bg-primary-50 text-primary-500 border border-primary-500/30",
  overdue:         "bg-primary-50 text-primary-500 border border-primary-500/30",
  opportunity:     "bg-secondary-100 text-secondary-700 border border-secondary-500/20",
  published:       "bg-success-1000 text-success-500 border border-success-500/20",
  draft_status:    "bg-warning-50 text-warning-500 border border-warning-500/20",
  publish_failed:  "bg-error-500/10 text-error-500 border border-error-500/20",
  approved:        "bg-success-1000 text-success-500 border border-success-500/20",
  dismissed:       "bg-gray-50 text-gray-500 border border-gray-500/20",
  planned:         "bg-secondary-100 text-secondary-700 border border-secondary-500/20",
  gap:             "bg-primary-50 text-primary-500 border border-dashed border-primary-500/40",
  informational:   "bg-blue-50 text-blue-600 border border-blue-500/20",
  transactional:   "bg-success-1000 text-success-500 border border-success-500/20",
  navigational:    "bg-primary-50 text-primary-500 border border-primary-500/20",
  commercial:      "bg-warning-50 text-warning-500 border border-warning-500/20",
};

const variantLabels: Partial<Record<BadgeVariant, string>> = {
  active: "Active",
  needs_posts: "Needs posts",
  low_activity: "Low activity",
};

export function Badge({ variant, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap",
        "[font-family:'Satoshi-500',var(--font-sans)]",
        variantStyles[variant],
        className
      )}
    >
      {children ?? variantLabels[variant]}
    </span>
  );
}
