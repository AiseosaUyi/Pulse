import Link from "next/link";
import { Check } from "lucide-react";

export const metadata = {
  title: "Pricing — PULSE",
  description: "Simple pricing for growing brands. Start free, scale when you're ready.",
};

const tiers = [
  {
    name: "Solo",
    price: "$49",
    period: "/mo",
    description: "For individual creators and single-brand founders.",
    cta: "Start free trial",
    features: [
      "1 brand",
      "5 social platforms",
      "20 AI blog posts per month",
      "SEO keyword tracking",
      "Intel Feed — competitor + X signals",
      "AI content drafts",
      "Basic publishing & scheduling",
      "Brand voice configuration",
    ],
    highlight: false,
  },
  {
    name: "Startup",
    price: "$99",
    period: "/mo",
    description: "For teams managing multiple brands at scale.",
    cta: "Start free trial",
    features: [
      "Up to 3 brands",
      "All social platforms",
      "Unlimited AI blog posts",
      "Team up to 5 members",
      "Trend scouts",
      "Lead outreach & prospect discovery",
      "Video generation",
      "Weekly business review digest",
      "Priority support",
    ],
    highlight: true,
  },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/90 backdrop-blur">
        <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between">
          <Link
            href="/"
            className="text-lg font-black tracking-tight text-primary-500"
          >
            PULSE
          </Link>
          <nav className="flex items-center gap-6">
            <Link
              href="/pricing"
              className="text-sm text-foreground font-medium transition-colors"
            >
              Pricing
            </Link>
            <Link
              href="/login"
              className="text-sm text-text-secondary hover:text-foreground transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="inline-flex items-center px-4 py-2 rounded-full text-sm font-semibold bg-primary-500 text-white hover:bg-primary-600 transition-colors"
            >
              Get started
            </Link>
          </nav>
        </div>
      </header>

      {/* Header */}
      <section className="mx-auto max-w-6xl px-6 pt-20 pb-12 text-center">
        <h1
          className="text-4xl md:text-5xl font-black text-foreground mb-4"
          style={{ fontFamily: "'Satoshi-900', var(--font-sans)" }}
        >
          Simple pricing.
          <br />
          No surprises.
        </h1>
        <p className="text-text-secondary max-w-md mx-auto">
          Start free. No credit card required. Cancel any time.
        </p>
      </section>

      {/* Tiers */}
      <section className="mx-auto max-w-4xl px-6 pb-24">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className={`rounded-2xl border p-8 flex flex-col ${
                tier.highlight
                  ? "border-primary-500 bg-primary-50 dark:bg-primary-500/5"
                  : "border-border bg-card"
              }`}
            >
              {tier.highlight && (
                <p className="text-xs font-bold uppercase tracking-widest text-primary-500 mb-4">
                  Most popular
                </p>
              )}
              <h2
                className="text-2xl font-black text-foreground"
                style={{ fontFamily: "'Satoshi-700', var(--font-sans)" }}
              >
                {tier.name}
              </h2>
              <div className="flex items-baseline gap-1 mt-2 mb-2">
                <span className="text-4xl font-black text-foreground">
                  {tier.price}
                </span>
                <span className="text-text-muted text-sm">{tier.period}</span>
              </div>
              <p className="text-sm text-text-secondary mb-6">
                {tier.description}
              </p>

              <Link
                href="/signup"
                className={`inline-flex items-center justify-center px-6 py-3 rounded-full text-sm font-semibold transition-colors mb-8 ${
                  tier.highlight
                    ? "bg-primary-500 text-white hover:bg-primary-600"
                    : "border border-border text-foreground hover:bg-sidebar"
                }`}
              >
                {tier.cta}
              </Link>

              <ul className="space-y-3 mt-auto">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5 text-sm">
                    <Check
                      size={15}
                      className="shrink-0 mt-0.5 text-primary-500"
                    />
                    <span className="text-text-secondary">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* FAQ / reassurance */}
        <div className="mt-12 text-center">
          <p className="text-sm text-text-muted">
            Both plans include a 14-day free trial. Questions?{" "}
            <a
              href="mailto:hello@gruve.events"
              className="text-primary-500 hover:underline"
            >
              Email us
            </a>
            .
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/40">
        <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between">
          <span className="text-sm font-black text-primary-500">PULSE</span>
          <div className="flex items-center gap-6 text-xs text-text-muted">
            <Link href="/" className="hover:text-foreground transition-colors">
              Home
            </Link>
            <Link href="/login" className="hover:text-foreground transition-colors">
              Sign in
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
