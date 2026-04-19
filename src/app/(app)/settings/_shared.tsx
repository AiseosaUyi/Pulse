import type { LucideIcon } from "lucide-react";

export function SettingsPageHeading({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
}) {
  return (
    <header className="mb-5">
      <div className="flex items-center gap-2">
        <Icon size={16} className="text-text-muted" />
        <h1
          className="text-xl md:text-2xl text-gray-1100 dark:text-foreground tracking-tight"
          style={{ fontFamily: "'Satoshi-700', var(--font-sans)" }}
        >
          {title}
        </h1>
      </div>
      <p className="text-sm text-gray-1000 dark:text-text-muted mt-1.5">
        {subtitle}
      </p>
    </header>
  );
}
