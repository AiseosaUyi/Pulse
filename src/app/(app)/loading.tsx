// Shown the moment you click to any page in the app, while its data loads.
// Pages with their own loading.tsx (dashboard, SEO) use that instead.

export default function AppLoading() {
  return (
    <div className="p-4 md:p-8 max-w-[1200px]" aria-busy="true" aria-label="Loading">
      <div className="h-7 w-48 bg-border/50 rounded animate-skeleton mb-2" />
      <div className="h-4 w-64 bg-border/50 rounded animate-skeleton mb-8" />
      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-14 rounded-lg bg-border/30 animate-skeleton" />
        ))}
      </div>
    </div>
  );
}
