import { Bell } from "lucide-react";
import { SettingsPageHeading } from "../_shared";

const PREFS = [
  {
    id: "weekly",
    label: "Weekly business review",
    desc: "Monday morning synthesis of everything Pulse shipped last week.",
  },
  {
    id: "morning",
    label: "Morning intel brief",
    desc: "Top competitor moves from overnight, delivered at 7am local.",
  },
  {
    id: "anomalies",
    label: "Anomaly alerts",
    desc: "Real-time pings when a competitor goes viral or the coach flags something urgent.",
  },
  {
    id: "mentions",
    label: "@mentions & replies",
    desc: "When someone engages with your content across platforms.",
  },
] as const;

export default function NotificationsSettingsPage() {
  return (
    <div>
      <SettingsPageHeading
        icon={Bell}
        title="Email notifications"
        subtitle="Which Pulse emails land in your inbox. Coming when the email pipeline ships."
      />

      <section className="bg-card border border-border rounded-2xl p-6">
        <div className="space-y-3 opacity-60 pointer-events-none">
          {PREFS.map((pref) => (
            <label
              key={pref.id}
              className="flex items-start gap-3 p-3 rounded-lg bg-white-50 dark:bg-sidebar/40 border border-white-200 dark:border-border/40"
            >
              <input
                type="checkbox"
                defaultChecked
                disabled
                className="mt-0.5 h-4 w-4 rounded border-white-200 accent-primary-500"
              />
              <div>
                <p className="text-sm text-gray-1200 dark:text-foreground [font-family:'Satoshi-500',var(--font-sans)]">
                  {pref.label}
                </p>
                <p className="text-xs text-gray-1000 dark:text-text-muted mt-0.5">
                  {pref.desc}
                </p>
              </div>
            </label>
          ))}
        </div>
        <p className="text-xs text-gray-500 italic mt-3">
          Notification preferences — coming once we wire an email delivery
          provider. Weekly Business Review is already generated on demand from
          the dashboard; email delivery is the next step.
        </p>
      </section>
    </div>
  );
}
