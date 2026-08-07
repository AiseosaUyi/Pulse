import type { LucideIcon } from "lucide-react";
import { PlugZap, ExternalLink } from "lucide-react";

interface FeatureSetupNoticeCta {
  label: string;
  href: string;
  external?: boolean;
}

/**
 * Shown in place of a feature's real UI when the integration it depends on
 * (an API key, env var, or OAuth connection) isn't configured yet — so the
 * failure is visible on the page itself instead of a silent no-op or a
 * toast the user only sees after clicking something that was never going
 * to work. Mirrors the settings/social-publishing "not configured" card.
 */
export function FeatureSetupNotice({
  icon: Icon = PlugZap,
  title,
  description,
  steps,
  cta,
}: {
  icon?: LucideIcon;
  title: string;
  description: React.ReactNode;
  steps?: string[];
  cta?: FeatureSetupNoticeCta;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-6 space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-primary-50 flex items-center justify-center flex-shrink-0">
          <Icon size={16} className="text-primary-500" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="text-sm text-text-muted mt-0.5">{description}</p>
        </div>
      </div>

      {steps && steps.length > 0 ? (
        <ol className="space-y-1.5 text-sm text-text-muted list-decimal list-inside pl-1">
          {steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      ) : null}

      {cta ? (
        <a
          href={cta.href}
          target={cta.external ? "_blank" : undefined}
          rel={cta.external ? "noopener noreferrer" : undefined}
          className="inline-flex items-center gap-1.5 rounded-full border border-primary-500 bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
        >
          {cta.label} {cta.external ? <ExternalLink size={13} /> : null}
        </a>
      ) : null}
    </div>
  );
}
