"use client";

import { useState, useTransition } from "react";
import { Globe, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveSiteDomainConfig } from "@/lib/actions/site-domains";

export function SiteDomainsSection({
  initial,
}: {
  initial: { domain: string; stagingDomain: string; blogPathPrefix: string };
}) {
  const [domain, setDomain] = useState(initial.domain);
  const [stagingDomain, setStagingDomain] = useState(initial.stagingDomain);
  const [blogPathPrefix, setBlogPathPrefix] = useState(
    initial.blogPathPrefix || "/blog"
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const onSave = () => {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await saveSiteDomainConfig({ domain, stagingDomain, blogPathPrefix });
      if (!res.success) {
        setError(res.error);
        return;
      }
      setSaved(true);
    });
  };

  const stagingMatchesLive =
    stagingDomain.trim() &&
    domain.trim() &&
    stagingDomain.trim().replace(/^www\./, "") === domain.trim().replace(/^www\./, "");

  return (
    <section className="bg-card border border-border rounded-2xl p-5">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center flex-shrink-0">
          <Globe size={18} className="text-primary-600" />
        </div>
        <div>
          <h3
            className="text-base text-foreground"
            style={{ fontFamily: "'Satoshi-700', var(--font-sans)" }}
          >
            Site domains
          </h3>
          <p className="text-sm text-text-muted mt-0.5">
            Where published blog posts and pages actually live. The Staging
            toggle in the blog editor links here — get it wrong and &ldquo;Publish
            to Staging&rdquo; sends you to the live site (or nowhere).
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="site-domain">Live domain</Label>
          <Input
            id="site-domain"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="www.yourbrand.com"
            className="mt-1.5"
          />
        </div>
        <div>
          <Label htmlFor="staging-domain">Staging domain</Label>
          <Input
            id="staging-domain"
            value={stagingDomain}
            onChange={(e) => setStagingDomain(e.target.value)}
            placeholder="staging.yourbrand.com"
            className="mt-1.5"
          />
          <p className="text-xs text-text-muted mt-1">
            Leave blank if you don&apos;t have a separate staging site — publishing
            to &ldquo;Staging&rdquo; will link to the live domain instead.
          </p>
        </div>
        <div>
          <Label htmlFor="blog-path-prefix">Blog URL path</Label>
          <Input
            id="blog-path-prefix"
            value={blogPathPrefix}
            onChange={(e) => setBlogPathPrefix(e.target.value)}
            placeholder="/blog"
            className="mt-1.5"
          />
          <p className="text-xs text-text-muted mt-1">
            e.g. "/blog" if posts live at yourbrand.com/blog/your-slug.
          </p>
        </div>
      </div>

      {stagingMatchesLive ? (
        <div className="mt-4 p-3 rounded-lg bg-amber-500/10 text-amber-700 text-sm">
          Staging and live domain look identical — publishing to "Staging"
          will actually publish live content to your production site.
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 p-3 rounded-lg bg-red-500/10 text-red-600 text-sm">
          {error}
        </div>
      ) : null}
      {saved ? (
        <div className="mt-4 flex items-center gap-2 p-3 rounded-lg bg-status-green/10 text-status-green text-sm">
          <CheckCircle2 size={14} />
          Saved. Blog and SEO page publish links will use this immediately.
        </div>
      ) : null}

      <div className="mt-5">
        <Button type="button" onClick={onSave} disabled={isPending}>
          {isPending ? <Loader2 size={14} className="animate-spin mr-1.5" /> : null}
          Save domains
        </Button>
      </div>
    </section>
  );
}
