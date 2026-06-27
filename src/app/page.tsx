import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export const metadata = {
  title: "PULSE — Marketing OS",
  description:
    "Monitor your market, create content in your brand voice, and publish everywhere — from one command center.",
};

const features = [
  {
    number: "01",
    title: "Intel Feed",
    hook: "Know what's happening before you post",
    body: "Monitors X for relevant conversations and competitor posts. Surface signals before they trend — so every post you write is informed by what's actually moving in your space.",
  },
  {
    number: "02",
    title: "AI Content Engine",
    hook: "Write in your voice, every time",
    body: "Brief → AI draft → publish in minutes. Brand voice, tone, and positioning baked in. No generic output — every draft is calibrated to how your brand actually sounds.",
  },
  {
    number: "03",
    title: "Multi-platform publishing",
    hook: "Schedule once, publish everywhere",
    body: "Instagram, TikTok, LinkedIn, YouTube and X from one place. Set a schedule, let Pulse handle distribution. No more tab juggling or manual cross-posting.",
  },
  {
    number: "04",
    title: "SEO Command Center",
    hook: "Own your search category",
    body: "Track keyword rankings, spot content gaps, and publish AI-generated posts optimized to rank. Close the loop between what your audience searches and what you publish.",
  },
];

export default async function LandingPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

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
              className="text-sm text-text-secondary hover:text-foreground transition-colors"
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

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pt-24 pb-20">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary-500 mb-4">
          Marketing OS
        </p>
        <h1
          className="text-5xl md:text-6xl font-black text-foreground leading-[1.08] max-w-3xl mb-6"
          style={{ fontFamily: "'Satoshi-900', var(--font-sans)" }}
        >
          Intelligence to content.
          <br />
          Content to growth.
        </h1>
        <p className="text-lg text-text-secondary max-w-xl mb-10 leading-relaxed">
          Monitor your market, create content in your brand voice, and publish
          everywhere — from one command center.
        </p>
        <div className="flex items-center gap-4">
          <Link
            href="/signup"
            className="inline-flex items-center px-6 py-3 rounded-full text-base font-semibold bg-primary-500 text-white hover:bg-primary-600 transition-colors"
          >
            Get started free
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center px-6 py-3 rounded-full text-base font-medium text-text-secondary border border-border hover:border-gray-400 hover:text-foreground transition-colors"
          >
            Sign in
          </Link>
        </div>
      </section>

      {/* Feature strip */}
      <section className="border-t border-border/40">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-border/40">
            {features.map((f) => (
              <div key={f.number} className="bg-background p-10">
                <p className="text-[11px] font-bold text-text-muted uppercase tracking-widest mb-4">
                  {f.number}
                </p>
                <h3
                  className="text-xl font-bold text-foreground mb-1"
                  style={{ fontFamily: "'Satoshi-700', var(--font-sans)" }}
                >
                  {f.title}
                </h3>
                <p className="text-sm font-semibold text-primary-500 mb-3">
                  {f.hook}
                </p>
                <p className="text-sm text-text-secondary leading-relaxed">
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border/40">
        <div className="mx-auto max-w-6xl px-6 py-24 text-center">
          <h2
            className="text-4xl font-black text-foreground mb-4"
            style={{ fontFamily: "'Satoshi-900', var(--font-sans)" }}
          >
            One command center.
            <br />
            Everything your brand needs.
          </h2>
          <p className="text-text-secondary mb-10 max-w-md mx-auto">
            Start free — no credit card required. Set up your brand in under 60
            seconds.
          </p>
          <Link
            href="/signup"
            className="inline-flex items-center px-8 py-4 rounded-full text-base font-semibold bg-primary-500 text-white hover:bg-primary-600 transition-colors"
          >
            Get started free
          </Link>
          <p className="mt-4 text-xs text-text-muted">
            Already have an account?{" "}
            <Link href="/login" className="text-primary-500 hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/40">
        <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between">
          <span className="text-sm font-black text-primary-500">PULSE</span>
          <div className="flex items-center gap-6 text-xs text-text-muted">
            <Link href="/pricing" className="hover:text-foreground transition-colors">
              Pricing
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
