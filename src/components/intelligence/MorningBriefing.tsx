import { type MorningBriefItem } from "@/lib/types/intelligence";
import { Badge } from "@/components/ui/Badge";

interface MorningBriefingProps {
  items: MorningBriefItem[];
}

const impactVariant = {
  high: "high_impact",
  medium: "opportunity",
  low: "active",
} as const;

export function MorningBriefing({ items }: MorningBriefingProps) {
  if (items.length === 0) return null;

  return (
    <div className="mb-6 rounded-xl border border-primary-500/20 bg-primary-500/[0.05] p-5">
      <h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-muted mb-3">
        Today&apos;s Brief
      </h2>
      <ul className="space-y-2.5">
        {items.map((item) => (
          <li key={item.intelCardId} className="flex items-start gap-3">
            <Badge variant={impactVariant[item.impact]}>{item.impact}</Badge>
            <span className="text-[15px] leading-snug text-foreground/90">
              {item.summary}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
