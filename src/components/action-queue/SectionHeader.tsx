// Shared label+count header — every group carries its count, including
// ones that are height-capped/scrolled, so nothing hides silently.
export function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 py-1.5 px-1">
      <span className="text-sm font-semibold text-foreground">{label}</span>
      <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-border/50 text-text-secondary">{count}</span>
    </div>
  );
}
