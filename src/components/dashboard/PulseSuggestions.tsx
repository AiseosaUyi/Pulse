import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import type { Suggestion } from "@/lib/types/dashboard";

interface PulseSuggestionsProps {
  suggestions: Suggestion[];
}

const impactLabels: Record<string, string> = {
  high_impact: "High impact",
  urgent: "Urgent",
  overdue: "Overdue",
  opportunity: "Opportunity",
};

export function PulseSuggestions({ suggestions }: PulseSuggestionsProps) {
  if (suggestions.length === 0) {
    return (
      <div className="bg-card rounded-xl p-6 border border-border/50">
        <h2 className="text-sm font-semibold text-foreground mb-4">
          Pulse Suggestions
        </h2>
        <div className="text-center py-8">
          <p className="text-text-secondary text-sm">All caught up</p>
          <p className="text-text-muted text-xs mt-1">
            No suggestions right now. Keep it up!
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl p-6 border border-border/50">
      <h2 className="text-sm font-semibold text-foreground mb-5">
        Pulse Suggestions
      </h2>
      <div className="flex flex-col gap-4">
        {suggestions.map((suggestion) => (
          <Link
            key={suggestion.id}
            href={suggestion.targetModule}
            className="flex items-start justify-between gap-3 group hover:bg-card-hover p-2 -mx-2 rounded-lg transition-colors duration-150"
          >
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-foreground text-sm group-hover:text-primary-500 transition-colors">
                {suggestion.title}
              </p>
              <p className="text-text-secondary text-xs mt-0.5 line-clamp-2">
                {suggestion.description}
              </p>
            </div>
            <Badge variant={suggestion.impact}>
              {impactLabels[suggestion.impact]}
            </Badge>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function PulseSuggestionsSkeleton() {
  return (
    <div className="bg-card rounded-xl p-6 border border-border/50">
      <div className="h-4 w-36 bg-border/50 rounded animate-skeleton mb-5" />
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-start justify-between gap-3 mb-4">
          <div className="flex-1">
            <div className="h-4 w-48 bg-border/50 rounded animate-skeleton mb-2" />
            <div className="h-3 w-64 bg-border/50 rounded animate-skeleton" />
          </div>
          <div className="h-6 w-20 bg-border/50 rounded-full animate-skeleton" />
        </div>
      ))}
    </div>
  );
}
