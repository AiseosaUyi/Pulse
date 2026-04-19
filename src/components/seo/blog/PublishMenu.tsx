"use client";

// Blog editor publish menu. Lists the tenant's configured WordPress /
// Ghost integrations and lets the user push the current blog post
// with a chosen status (draft or live). Slice 4 — Publish Loop.

import { useState, useTransition } from "react";
import {
  Loader2,
  Globe,
  ExternalLink,
  Send,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogCloseButton,
} from "@/components/ui/Dialog";
import { publishBlog } from "@/lib/actions/publish";
import type {
  BlogPublicationRecord,
  IntegrationRecord,
} from "@/lib/types/integrations";

type PublishProvider = "wordpress" | "ghost";

export function PublishMenu({
  tenantSlug,
  blogPostId,
  integrations,
  publications,
}: {
  tenantSlug: string;
  blogPostId: string;
  integrations: IntegrationRecord[];
  publications: BlogPublicationRecord[];
}) {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<PublishProvider | null>(null);
  const [publishStatus, setPublishStatus] = useState<"draft" | "live">("draft");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<
    { ok: boolean; url?: string | null; error?: string | null } | null
  >(null);
  const [isPublishing, startPublish] = useTransition();

  const wpConnected = integrations.find(
    (i) => i.provider === "wordpress" && i.status === "connected"
  );
  const ghostConnected = integrations.find(
    (i) => i.provider === "ghost" && i.status === "connected"
  );
  const anyConnected = Boolean(wpConnected || ghostConnected);

  if (!anyConnected && publications.length === 0) {
    // Nothing connected and never published — skip the button entirely
    // so the header stays clean. Integrations settings link lives on
    // the settings page.
    return null;
  }

  const handlePublish = () => {
    if (!provider) return;
    setError(null);
    setResult(null);
    startPublish(async () => {
      const wpStatus =
        publishStatus === "live"
          ? provider === "wordpress"
            ? "publish"
            : "published"
          : "draft";
      const res = await publishBlog(tenantSlug, blogPostId, provider, {
        status: wpStatus,
      });
      if (!res.success) {
        setError(res.error);
        setResult({ ok: false, error: res.error });
        return;
      }
      setResult({ ok: true, url: res.externalUrl });
    });
  };

  const mostRecent = publications[0];

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setProvider(wpConnected ? "wordpress" : ghostConnected ? "ghost" : null);
          setOpen(true);
          setResult(null);
          setError(null);
        }}
        className="gap-1.5"
        title={anyConnected ? "Publish to external blog" : "Connect an integration to publish"}
      >
        <Send size={14} />
        Publish
        {publications.length > 0 && (
          <span className="ml-0.5 text-[10px] px-1 rounded-full bg-status-green/10 text-status-green">
            {publications.length}
          </span>
        )}
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} size="md" locked={isPublishing}>
        <DialogCloseButton onClose={() => setOpen(false)} />
        <DialogHeader
          title="Publish to external blog"
          subtitle="Push this post to the platforms you've connected under Settings → Integrations."
          tone="info"
        />
        <DialogBody>
          {!anyConnected && (
            <div className="rounded-lg border border-dashed border-border p-4 text-sm text-text-muted">
              No publishing integrations connected yet. Go to{" "}
              <a
                href="/settings/integrations"
                className="text-primary-500 hover:text-primary-600"
              >
                Settings → Integrations
              </a>{" "}
              to add WordPress or Ghost.
            </div>
          )}

          {anyConnected && (
            <>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">
                  Destination
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {wpConnected && (
                    <button
                      type="button"
                      onClick={() => setProvider("wordpress")}
                      className={`border rounded-lg p-3 text-left ${
                        provider === "wordpress"
                          ? "border-primary-500 bg-primary-500/5"
                          : "border-border hover:border-border/60"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Globe size={14} className="text-primary-500" />
                        <span className="text-sm font-semibold text-foreground">
                          WordPress
                        </span>
                      </div>
                      <p className="text-[11px] text-text-muted mt-0.5 truncate">
                        {String(wpConnected.config.site_url ?? "")}
                      </p>
                    </button>
                  )}
                  {ghostConnected && (
                    <button
                      type="button"
                      onClick={() => setProvider("ghost")}
                      className={`border rounded-lg p-3 text-left ${
                        provider === "ghost"
                          ? "border-primary-500 bg-primary-500/5"
                          : "border-border hover:border-border/60"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Globe size={14} className="text-primary-500" />
                        <span className="text-sm font-semibold text-foreground">
                          Ghost
                        </span>
                      </div>
                      <p className="text-[11px] text-text-muted mt-0.5 truncate">
                        {String(ghostConnected.config.admin_url ?? "")}
                      </p>
                    </button>
                  )}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">
                  Status
                </p>
                <div className="flex items-center gap-3 text-sm">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      checked={publishStatus === "draft"}
                      onChange={() => setPublishStatus("draft")}
                      className="accent-primary-500"
                    />
                    <span>Draft</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      checked={publishStatus === "live"}
                      onChange={() => setPublishStatus("live")}
                      className="accent-primary-500"
                    />
                    <span>Publish live</span>
                  </label>
                </div>
              </div>

              {error && (
                <div
                  className="rounded-lg border border-status-red/30 bg-status-red/5 px-3 py-2 text-sm text-status-red"
                  role="alert"
                >
                  {error}
                </div>
              )}

              {result?.ok && (
                <div className="rounded-lg border border-status-green/30 bg-status-green/5 px-3 py-2 text-sm text-status-green flex items-center gap-2">
                  <CheckCircle2 size={14} />
                  Published.
                  {result.url && (
                    <a
                      href={result.url}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-auto inline-flex items-center gap-1 text-status-green hover:underline"
                    >
                      View live
                      <ExternalLink size={12} />
                    </a>
                  )}
                </div>
              )}
            </>
          )}

          {publications.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">
                Recent publications
              </p>
              <ul className="space-y-1.5">
                {publications.slice(0, 5).map((pub) => (
                  <li
                    key={pub.id}
                    className="flex items-center gap-2 text-xs text-text-muted"
                  >
                    {pub.status === "failed" ? (
                      <XCircle size={12} className="text-status-red" />
                    ) : (
                      <CheckCircle2 size={12} className="text-status-green" />
                    )}
                    <span className="capitalize">{pub.provider}</span>
                    <span>·</span>
                    <span>{new Date(pub.publishedAt).toLocaleString()}</span>
                    <span>·</span>
                    <span className="capitalize">{pub.status.replace("_", " ")}</span>
                    {pub.externalUrl && (
                      <a
                        href={pub.externalUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-auto inline-flex items-center gap-1 text-primary-500 hover:underline"
                      >
                        Open
                        <ExternalLink size={11} />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Close
          </Button>
          {anyConnected && (
            <Button
              size="sm"
              onClick={handlePublish}
              disabled={!provider || isPublishing}
              className="gap-1.5"
            >
              {isPublishing ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Publishing…
                </>
              ) : (
                <>
                  <Send size={14} />
                  {publishStatus === "live" ? "Publish live" : "Push draft"}
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </Dialog>

      {/* Tiny most-recent chip below the button — optional, keep the
          header tight. Comment out if it crowds. */}
      {mostRecent && !open && false && (
        <span className="text-[10px] text-text-muted">
          Last published {new Date(mostRecent.publishedAt).toLocaleDateString()}
        </span>
      )}
    </>
  );
}
