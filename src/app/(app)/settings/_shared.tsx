import type { LucideIcon } from "lucide-react";

export function SettingsPageHeading({
  title,
  subtitle,
}: {
  // `icon` is still accepted from callers for back-compat but no longer rendered.
  icon?: LucideIcon;
  title: string;
  subtitle: string;
}) {
  return (
    <header className="mb-5">
      <h1
        className="text-xl md:text-2xl text-gray-1100 dark:text-foreground tracking-tight"
        style={{ fontFamily: "'Satoshi-700', var(--font-sans)" }}
      >
        {title}
      </h1>
      <p className="text-sm text-gray-1000 dark:text-text-muted mt-1.5">
        {subtitle}
      </p>
    </header>
  );
}
