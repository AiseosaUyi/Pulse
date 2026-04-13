import type { StatCardData } from "@/lib/types/dashboard";

interface StatCardProps {
  data: StatCardData;
  scoreMax?: number;
}

export function StatCard({ data, scoreMax }: StatCardProps) {
  return (
    <div className="bg-card rounded-xl p-5 border border-border/50 hover:border-border transition-colors duration-150">
      <p className="text-text-secondary text-[13px] mb-2">{data.label}</p>
      <div className="flex items-baseline gap-1">
        <span className="text-4xl font-extrabold tracking-tight text-white">
          {data.value}
        </span>
        {scoreMax && (
          <span className="text-lg font-semibold text-text-muted">
            /{scoreMax}
          </span>
        )}
      </div>
      {data.change && (
        <p
          className={`text-[13px] mt-1 font-medium ${
            data.change.direction === "up"
              ? "text-status-green"
              : data.change.direction === "down"
                ? "text-status-red"
                : "text-text-secondary"
          }`}
        >
          {data.change.direction === "up" && "\u2191 "}
          {data.change.direction === "down" && "\u2193 "}
          {data.change.value}
        </p>
      )}
      {data.subtitle && !data.change && (
        <p className="text-[13px] mt-1 text-text-secondary">{data.subtitle}</p>
      )}
      {data.subtitle && data.change && (
        <p className="text-[13px] mt-0.5 text-text-secondary">{data.subtitle}</p>
      )}
    </div>
  );
}

export function StatCardSkeleton() {
  return (
    <div className="bg-card rounded-xl p-5 border border-border/50">
      <div className="h-3 w-20 bg-border/50 rounded animate-skeleton mb-3" />
      <div className="h-9 w-24 bg-border/50 rounded animate-skeleton mb-2" />
      <div className="h-3 w-28 bg-border/50 rounded animate-skeleton" />
    </div>
  );
}
