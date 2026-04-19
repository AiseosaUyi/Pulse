"use client";

import { useState, useTransition } from "react";
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
    ayrshare: { apiKey: "" },
    wordpress: { site_url: "", username: "", appPassword: "" },
    ghost: { admin_url: "", admin_key: "" },
    resend: { apiKey: "", from_email: "", from_name: "" },
    ga4: { property_id: "", service_account_json: "" },
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
      if (rec.provider === "wordpress") {
        base.wordpress.site_url = String(rec.config.site_url ?? "");
        base.wordpress.username = String(rec.config.username ?? "");
      }
      if (rec.provider === "ghost") {
        base.ghost.admin_url = String(rec.config.admin_url ?? "");
      }
      if (rec.provider === "resend") {
        base.resend.from_email = String(rec.config.from_email ?? "");
        base.resend.from_name = String(rec.config.from_name ?? "");
      }
      if (rec.provider === "ga4") {
        base.ga4.property_id = String(rec.config.property_id ?? "");
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
    let secretToken2: string | null | undefined;

    switch (provider) {
      case "ayrshare":
        if (!form.apiKey) {
          setError("API key is required");
          return;
        }
        secretToken = form.apiKey;
        break;
      case "wordpress":
        if (!form.site_url || !form.username) {
          setError("Site URL and username are required");
          return;
        }
        if (!form.appPassword && !getRecord("wordpress")?.hasSecret) {
          setError("Application password is required");
          return;
        }
        config = { site_url: form.site_url, username: form.username };
        if (form.appPassword) secretToken = form.appPassword;
        break;
      case "ghost":
        if (!form.admin_url) {
          setError("Admin URL is required");
          return;
        }
        if (!form.admin_key && !getRecord("ghost")?.hasSecret) {
          setError("Admin key is required");
          return;
        }
        config = { admin_url: form.admin_url };
        if (form.admin_key) {
          const [id, secret] = form.admin_key.split(":");
          if (!id || !secret) {
            setError("Admin key must be formatted id:secret");
            return;
          }
          secretToken = id;
          secretToken2 = secret;
        }
        break;
      case "resend":
        if (!form.apiKey || !form.from_email) {
          setError("API key and sender email are required");
          return;
        }
        config = { from_email: form.from_email, from_name: form.from_name };
        secretToken = form.apiKey;
        break;
      case "ga4": {
        if (!form.property_id) {
          setError("GA4 property ID is required");
          return;
        }
        if (!form.service_account_json && !getRecord("ga4")?.hasSecret) {
          setError("Service-account JSON is required");
          return;
        }
        // Parse to pull the client_email for display (and validate early).
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
        break;
      }
    }

    setBusyProvider(provider);
    const res = await saveIntegration({
      tenantSlug,
      provider,
      config,
      secretToken,
      secretToken2,
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
    // Clear the secret fields so the browser doesn't keep them.
    if (provider === "ayrshare" || provider === "resend") {
      updateForm(provider, "apiKey", "");
    }
    if (provider === "wordpress") updateForm(provider, "appPassword", "");
    if (provider === "ghost") updateForm(provider, "admin_key", "");
    if (provider === "ga4") updateForm(provider, "service_account_json", "");
    startTransition(() => {
      // Reload records from the server via router refresh on parent.
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
        "Pulse will stop publishing to this service. You can reconnect anytime.",
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
                  Last tested {new Date(record.lastTestedAt).toLocaleString()}
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

  switch (provider) {
    case "ayrshare":
      return (
        <div>
          <Label htmlFor="ayr-key">Ayrshare API key</Label>
          <Input
            id="ayr-key"
            type="password"
            autoComplete="off"
            value={form.apiKey}
            onChange={(e) => onChange("apiKey", e.target.value)}
            placeholder={secretPlaceholder || "e.g. 9A1B2C3D-4E5F-6G7H-8I9J-0123456789AB"}
          />
        </div>
      );
    case "wordpress":
      return (
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="wp-url">Site URL</Label>
            <Input
              id="wp-url"
              type="url"
              value={form.site_url}
              onChange={(e) => onChange("site_url", e.target.value)}
              placeholder="https://yourblog.com"
            />
          </div>
          <div>
            <Label htmlFor="wp-user">Username</Label>
            <Input
              id="wp-user"
              value={form.username}
              onChange={(e) => onChange("username", e.target.value)}
              placeholder="your-wp-username"
            />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="wp-pass">Application password</Label>
            <Input
              id="wp-pass"
              type="password"
              autoComplete="off"
              value={form.appPassword}
              onChange={(e) => onChange("appPassword", e.target.value)}
              placeholder={secretPlaceholder || "xxxx xxxx xxxx xxxx xxxx xxxx"}
            />
            <p className="text-[11px] text-text-muted mt-1">
              Generate at Users → Profile → Application Passwords. Not your
              regular login password.
            </p>
          </div>
        </div>
      );
    case "ghost":
      return (
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="ghost-url">Admin URL</Label>
            <Input
              id="ghost-url"
              type="url"
              value={form.admin_url}
              onChange={(e) => onChange("admin_url", e.target.value)}
              placeholder="https://yourblog.ghost.io"
            />
          </div>
          <div>
            <Label htmlFor="ghost-key">Admin API key</Label>
            <Input
              id="ghost-key"
              type="password"
              autoComplete="off"
              value={form.admin_key}
              onChange={(e) => onChange("admin_key", e.target.value)}
              placeholder={secretPlaceholder || "id:secret"}
            />
            <p className="text-[11px] text-text-muted mt-1">
              Create under Integrations → Add custom integration. Copy the full
              Admin API Key.
            </p>
          </div>
        </div>
      );
    case "resend":
      return (
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="resend-key">API key</Label>
            <Input
              id="resend-key"
              type="password"
              autoComplete="off"
              value={form.apiKey}
              onChange={(e) => onChange("apiKey", e.target.value)}
              placeholder={secretPlaceholder || "re_XXXXXXXXXXXXXXXX"}
            />
          </div>
          <div>
            <Label htmlFor="resend-from">From email</Label>
            <Input
              id="resend-from"
              type="email"
              value={form.from_email}
              onChange={(e) => onChange("from_email", e.target.value)}
              placeholder="news@yourdomain.com"
            />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="resend-name">From name (optional)</Label>
            <Input
              id="resend-name"
              value={form.from_name}
              onChange={(e) => onChange("from_name", e.target.value)}
              placeholder="Your Brand Newsletter"
            />
          </div>
        </div>
      );
    case "ga4":
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
}
