// Generic instant loading fallback for data-heavy routes (Next Suspense via
// loading.tsx). Pairs with the top RouteProgress bar so navigation always has
// immediate feedback instead of a frozen previous page.

export function RouteSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="p-6 md:p-8 space-y-5" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <div className="h-6 w-56 rounded-md bg-gray-200/70 dark:bg-white/10 animate-skeleton" />
        <div className="h-3.5 w-80 max-w-full rounded bg-gray-200/60 dark:bg-white/[0.07] animate-skeleton" />
      </div>
      <div className="grid gap-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="h-16 rounded-xl border border-border bg-card animate-skeleton"
          />
        ))}
      </div>
    </div>
  );
}
