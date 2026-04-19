import { Palette } from "lucide-react";
import { ThemeSwitcher } from "@/components/theme/ThemeSwitcher";
import { SettingsPageHeading } from "../_shared";

export default function AppearanceSettingsPage() {
  return (
    <div>
      <SettingsPageHeading
        icon={Palette}
        title="Appearance"
        subtitle="How Pulse looks on this device. Theme choice is stored locally, not synced across devices."
      />

      <section className="bg-card border border-border rounded-2xl p-6">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div>
            <p
              className="text-sm text-gray-1200 dark:text-foreground"
              style={{ fontFamily: "'Satoshi-500', var(--font-sans)" }}
            >
              Theme
            </p>
            <p className="text-xs text-gray-1000 dark:text-text-muted mt-1 max-w-md">
              Pick Light, Dark, or System — System follows your OS setting and
              updates automatically when you toggle dark mode there.
            </p>
          </div>
          <ThemeSwitcher />
        </div>
      </section>
    </div>
  );
}
