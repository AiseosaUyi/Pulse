"use client";

import { useState, useTransition } from "react";
import { formatDateTime } from "@/lib/utils/format";
import {
  CheckCircle2,
  Loader2,
  ShieldAlert,
  Trash2,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDialogs } from "@/components/ui/Dialog";
import {
  saveIntegration,
  disconnectIntegration,
  testIntegration,
} from "@/lib/actions/integrations";
import {
  INTEGRATION_PROVIDERS,
  PROVIDER_BLURBS,
  PROVIDER_LABELS,
  type IntegrationProvider,
  type IntegrationRecord,
} from "@/lib/types/integrations";

type ProviderForm = {
  [K in IntegrationProvider]: Record<string, string>;
};

function emptyForm(): ProviderForm {
  return {
    ga4: { property_id: "", service_account_json: "" },
    gsc: { site_url: "", service_account_json: "" },
    contentful: {
      space_id: "",
      cma_token: "",
      environment: "",
      locale: "",
      blog_content_type: "",
      landing_content_type: "",
    },
  };
}

export function IntegrationsClient({
  tenantSlug,
  initial,
}: {
  tenantSlug: string;
  initial: IntegrationRecord[];
}) {
  const dialogs = useDialogs();
  const [records, setRecords] = useState<IntegrationRecord[]>(initial);
  const [forms, setForms] = useState<ProviderForm>(() => {
    const base = emptyForm();
    for (const rec of initial) {
      if (rec.provider === "ga4") {
        base.ga4.property_id = String(rec.config.property_id ?? "");
      }
      if (rec.provider === "gsc") {
        base.gsc.site_url = String(rec.config.site_url ?? "");
      }
      if (rec.provider === "contentful") {
        base.contentful.space_id = String(rec.config.space_id ?? "");
        base.contentful.environment = String(rec.config.environment ?? "");
        base.contentful.locale = String(rec.config.locale ?? "");
        base.contentful.blog_content_type = String(
          rec.config.blog_content_type ?? ""
        );
        base.contentful.landing_content_type = String(
          rec.config.landing_content_type ?? ""
        );
      }
    }
    return base;
  });
  const [busyProvider, setBusyProvider] = useState<IntegrationProvider | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const getRecord = (provider: IntegrationProvider) =>
    records.find((r) => r.provider === provider);

  const updateForm = (
    provider: IntegrationProvider,
    field: string,
    value: string
  ) => {
    setForms((prev) => ({
      ...prev,
      [provider]: { ...prev[provider], [field]: value },
    }));
  };

  const handleSave = async (provider: IntegrationProvider) => {
    setError(null);
    setSuccessMessage(null);
    const form = forms[provider];

    let config: Record<string, unknown> = {};
    let secretToken: string | null | undefined;

    if (provider === "ga4") {
      if (!form.property_id) {
        setError("GA4 property ID is required");
        return;
      }
      if (!form.service_account_json && !getRecord("ga4")?.hasSecret) {
        setError("Service-account JSON is required");
        return;
      }
      let projectId: string | undefined;
      let clientEmail: string | undefined;
      if (form.service_account_json) {
        try {
          const parsed = JSON.parse(form.service_account_json) as {
            client_email?: string;
            project_id?: string;
            private_key?: string;
          };
          if (!parsed.client_email || !parsed.private_key) {
            setError(
              "Service-account JSON missing client_email or private_key"
            );
            return;
          }
          projectId = parsed.project_id;
          clientEmail = parsed.client_email;
        } catch {
          setError("Service-account JSON is not valid JSON");
          return;
        }
      }
      config = {
        property_id: form.property_id,
        client_email: clientEmail ?? getRecord("ga4")?.config.client_email,
        project_id: projectId ?? getRecord("ga4")?.config.project_id,
      };
      if (form.service_account_json) {
        secretToken = form.service_account_json;
      }
    }

    if (provider === "gsc") {
      if (!form.site_url) {
        setError("Search Console property URL is required");
        return;
      }
      if (!form.service_account_json && !getRecord("gsc")?.hasSecret) {
        setError("Service-account JSON is required");
        return;
      }
      let clientEmail: string | undefined;
      if (form.service_account_json) {
        try {
          const parsed = JSON.parse(form.service_account_json) as {
            client_email?: string;
            private_key?: string;
          };
          if (!parsed.client_email || !parsed.private_key) {
            setError("Service-account JSON missing client_email or private_key");
            return;
          }
          clientEmail = parsed.client_email;
        } catch {
          setError("Service-account JSON is not valid JSON");
          return;
        }
      }
      config = {
        site_url: form.site_url,
        client_email: clientEmail ?? getRecord("gsc")?.config.client_email,
      };
      if (form.service_account_json) {
        secretToken = form.service_account_json;
      }
    }

    if (provider === "contentful") {
      if (!form.space_id) {
        setError("Contentful Space ID is required");
        return;
      }
      if (!form.cma_token && !getRecord("contentful")?.hasSecret) {
        setError("Content Management API token is required");
        return;
      }
      config = {
        space_id: form.space_id,
        environment: form.environment || "master",
        locale: form.locale || "en-US",
        // Optional overrides — blank means use the defaults (gruveBlog /
        // seoLandingPage), so each tenant only sets these if theirs differ.
        ...(form.blog_content_type
          ? { blog_content_type: form.blog_content_type }
          : {}),
        ...(form.landing_content_type
          ? { landing_content_type: form.landing_content_type }
          : {}),
      };
      if (form.cma_token) {
        secretToken = form.cma_token;
      }
    }

    setBusyProvider(provider);
    const res = await saveIntegration({
      tenantSlug,
      provider,
      config,
      secretToken,
    });
    setBusyProvider(null);

    if (!res.success) {
      setError(res.error);
      return;
    }
    setSuccessMessage(
      res.tested
        ? `${PROVIDER_LABELS[provider]} — connected and verified.`
        : `${PROVIDER_LABELS[provider]} — saved but verification failed. Check the banner below.`
    );
    if (provider === "ga4" || provider === "gsc")
      updateForm(provider, "service_account_json", "");
    if (provider === "contentful") updateForm(provider, "cma_token", "");
    startTransition(() => {
      location.reload();
    });
  };

  const handleTest = async (provider: IntegrationProvider) => {
    setError(null);
    setSuccessMessage(null);
    setBusyProvider(provider);
    const res = await testIntegration(tenantSlug, provider);
    setBusyProvider(null);
    if (!res.success) {
      setError(`${PROVIDER_LABELS[provider]} — ${res.error}`);
      setRecords((prev) =>
        prev.map((r) =>
          r.provider === provider
            ? { ...r, status: "error", lastError: res.error }
            : r
        )
      );
    } else {
      setSuccessMessage(
        res.detail
          ? `${PROVIDER_LABELS[provider]} — ${res.detail}`
          : `${PROVIDER_LABELS[provider]} — connected.`
      );
      setRecords((prev) =>
        prev.map((r) =>
          r.provider === provider
            ? { ...r, status: "connected", lastError: null }
            : r
        )
      );
    }
  };

  const handleDisconnect = async (provider: IntegrationProvider) => {
    const ok = await dialogs.confirm({
      title: `Disconnect ${PROVIDER_LABELS[provider]}?`,
      subtitle:
        "Pulse will stop pulling data from this service. You can reconnect anytime.",
      tone: "destructive",
      confirmLabel: "Disconnect",
    });
    if (!ok) return;
    setBusyProvider(provider);
    const res = await disconnectIntegration(tenantSlug, provider);
    setBusyProvider(null);
    if (!res.success) {
      setError(res.error);
      return;
    }
    setRecords((prev) => prev.filter((r) => r.provider !== provider));
    setSuccessMessage(`${PROVIDER_LABELS[provider]} disconnected.`);
  };

  return (
    <div className="space-y-4">
      {error && (
        <div
          className="rounded-lg border border-status-red/30 bg-status-red/5 px-3 py-2 text-sm text-status-red"
          role="alert"
        >
          {error}
        </div>
      )}
      {successMessage && !error && (
        <div
          className="rounded-lg border border-status-green/30 bg-status-green/5 px-3 py-2 text-sm text-status-green"
          role="status"
        >
          {successMessage}
        </div>
      )}

      {INTEGRATION_PROVIDERS.map((provider) => {
        const record = getRecord(provider);
        const form = forms[provider];
        const busy = busyProvider === provider;
        return (
          <section
            key={provider}
            className="bg-card border border-border rounded-2xl p-6"
          >
            <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
              <div className="min-w-0">
                <h2 className="text-foreground font-semibold flex items-center gap-2">
                  {PROVIDER_LABELS[provider]}
                  {record?.status === "connected" && (
                    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-status-green">
                      <CheckCircle2 size={12} /> connected
                    </span>
                  )}
                  {record?.status === "error" && (
                    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-status-red">
                      <ShieldAlert size={12} /> error
                    </span>
                  )}
                </h2>
                <p className="text-xs text-text-muted mt-1 max-w-xl">
                  {PROVIDER_BLURBS[provider]}
                </p>
                {record?.lastError && (
                  <p className="text-xs text-status-red mt-1">
                    Last error: {record.lastError}
                  </p>
                )}
              </div>
              {record && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleTest(provider)}
                    disabled={busy}
                    className="gap-1.5"
                  >
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                    Test
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDisconnect(provider)}
                    disabled={busy}
                    className="gap-1.5 text-status-red hover:text-status-red"
                  >
                    <Trash2 size={14} />
                    Disconnect
                  </Button>
                </div>
              )}
            </div>

            {renderFields(provider, form, record, (field, value) =>
              updateForm(provider, field, value)
            )}

            <div className="mt-4 flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => handleSave(provider)}
                disabled={busy}
                className="gap-1.5"
              >
                {busy && <Loader2 size={14} className="animate-spin" />}
                {record ? "Save changes" : "Connect"}
              </Button>
              {record?.lastTestedAt && (
                <span className="text-[11px] text-text-muted">
                  Last tested {formatDateTime(record.lastTestedAt)}
                </span>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function renderFields(
  provider: IntegrationProvider,
  form: Record<string, string>,
  record: IntegrationRecord | undefined,
  onChange: (field: string, value: string) => void
): React.ReactNode {
  const secretPlaceholder = record?.hasSecret
    ? "•••••••• (leave blank to keep current)"
    : "";

  if (provider === "ga4") {
    return (
      <div className="space-y-3">
        <div>
          <Label htmlFor="ga4-prop">GA4 property ID</Label>
          <Input
            id="ga4-prop"
            value={form.property_id}
            onChange={(e) => onChange("property_id", e.target.value)}
            placeholder="e.g. 412345678"
          />
          <p className="text-[11px] text-text-muted mt-1">
            In GA4, go to Admin → Property settings → Property ID. Just
            the numeric ID.
          </p>
        </div>
        <div>
          <Label htmlFor="ga4-sa">Service-account JSON</Label>
          <textarea
            id="ga4-sa"
            rows={6}
            value={form.service_account_json}
            onChange={(e) => onChange("service_account_json", e.target.value)}
            placeholder={
              secretPlaceholder ||
              `{\n  "type": "service_account",\n  "project_id": "...",\n  "private_key": "-----BEGIN PRIVATE KEY-----\\n...",\n  "client_email": "pulse@project.iam.gserviceaccount.com",\n  ...\n}`
            }
            className="w-full rounded-lg border border-border bg-card text-xs font-mono leading-relaxed px-3 py-2"
            spellCheck={false}
            autoComplete="off"
          />
          <p className="text-[11px] text-text-muted mt-1">
            Create a service account in GCP, grant it <strong>Viewer</strong>{" "}
            on your GA4 property (Admin → Property Access Management → add
            the client_email), then paste the full JSON key file here.
          </p>
        </div>
      </div>
    );
  }

  if (provider === "gsc") {
    return (
      <div className="space-y-3">
        <div>
          <Label htmlFor="gsc-site">Property URL</Label>
          <Input
            id="gsc-site"
            value={form.site_url}
            onChange={(e) => onChange("site_url", e.target.value)}
            placeholder="https://www.yourbrand.com/  or  sc-domain:yourbrand.com"
          />
          <p className="text-[11px] text-text-muted mt-1">
            Exactly as it appears in Search Console. Domain properties use the{" "}
            <code>sc-domain:</code> prefix; URL-prefix properties are the full
            URL with trailing slash.
          </p>
        </div>
        <div>
          <Label htmlFor="gsc-sa">Service-account JSON</Label>
          <textarea
            id="gsc-sa"
            rows={6}
            value={form.service_account_json}
            onChange={(e) => onChange("service_account_json", e.target.value)}
            placeholder={
              secretPlaceholder ||
              `{\n  "type": "service_account",\n  "project_id": "...",\n  "private_key": "-----BEGIN PRIVATE KEY-----\\n...",\n  "client_email": "pulse@project.iam.gserviceaccount.com",\n  ...\n}`
            }
            className="w-full rounded-lg border border-border bg-card text-xs font-mono leading-relaxed px-3 py-2"
            spellCheck={false}
            autoComplete="off"
          />
          <p className="text-[11px] text-text-muted mt-1">
            Reuse your GA4 service account or make a new one, then add its{" "}
            <strong>client_email</strong> as a user in Search Console (Settings
            → Users and permissions → Add user → Restricted), and paste the
            full JSON key here.
          </p>
        </div>
      </div>
    );
  }

  if (provider === "contentful") {
    return (
      <div className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="cf-space">Space ID</Label>
            <Input
              id="cf-space"
              value={form.space_id}
              onChange={(e) => onChange("space_id", e.target.value)}
              placeholder="e.g. nc7eiymdfagh"
            />
          </div>
          <div>
            <Label htmlFor="cf-env">Environment</Label>
            <Input
              id="cf-env"
              value={form.environment}
              onChange={(e) => onChange("environment", e.target.value)}
              placeholder="master"
            />
          </div>
        </div>
        <div>
          <Label htmlFor="cf-token">Content Management API token</Label>
          <Input
            id="cf-token"
            type="password"
            value={form.cma_token}
            onChange={(e) => onChange("cma_token", e.target.value)}
            placeholder={
              secretPlaceholder || "CFPAT-… (Settings → API keys → CMA tokens)"
            }
            autoComplete="off"
          />
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          <div>
            <Label htmlFor="cf-locale">Locale</Label>
            <Input
              id="cf-locale"
              value={form.locale}
              onChange={(e) => onChange("locale", e.target.value)}
              placeholder="en-US"
            />
          </div>
          <div>
            <Label htmlFor="cf-blog-ct">Blog content type</Label>
            <Input
              id="cf-blog-ct"
              value={form.blog_content_type}
              onChange={(e) => onChange("blog_content_type", e.target.value)}
              placeholder="blogPost"
            />
          </div>
          <div>
            <Label htmlFor="cf-landing-ct">Landing content type</Label>
            <Input
              id="cf-landing-ct"
              value={form.landing_content_type}
              onChange={(e) =>
                onChange("landing_content_type", e.target.value)
              }
              placeholder="seoLandingPage"
            />
          </div>
        </div>
        <p className="text-[11px] text-text-muted">
          Locale + content-type ids are optional — blank uses the defaults
          (<code>en-US</code>, <code>blogPost</code>,{" "}
          <code>seoLandingPage</code>). Set them only if this workspace&apos;s
          Contentful model differs.
        </p>
      </div>
    );
  }

  return null;
}
