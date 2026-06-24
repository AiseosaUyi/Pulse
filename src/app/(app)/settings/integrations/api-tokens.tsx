"use client";

// Pulse API tokens section. Owners + admins can mint tokens for the
// Chrome extension (and future first-party clients). Raw token is
// shown ONCE at create — after that only the prefix + last 4 remain.

import { useState, useTransition } from "react";
import { formatDate, formatDateTime } from "@/lib/utils/format";
import {
  Plus,
  Copy,
  Check,
  Loader2,
  KeyRound,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDialogs } from "@/components/ui/Dialog";
import {
  createApiToken,
  revokeApiToken,
} from "@/lib/actions/api-tokens";
import type { ApiTokenRecord } from "@/lib/api-tokens";

export function ApiTokensSection({
  tenantSlug,
  initial,
}: {
  tenantSlug: string;
  initial: ApiTokenRecord[];
}) {
  const dialogs = useDialogs();
  const [tokens, setTokens] = useState(initial);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleCreate = () => {
    if (!name.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await createApiToken(tenantSlug, { name });
      if (!res.success) {
        setError(res.error);
        return;
      }
      setFreshToken(res.token);
      setTokens((prev) => [res.record, ...prev]);
      setName("");
      setCreating(false);
    });
  };

  const handleRevoke = async (token: ApiTokenRecord) => {
    const ok = await dialogs.confirm({
      title: `Revoke "${token.name}"?`,
      subtitle:
        "The Chrome extension (or whatever client uses this token) will stop working immediately.",
      tone: "destructive",
      confirmLabel: "Revoke token",
    });
    if (!ok) return;
    const res = await revokeApiToken(tenantSlug, token.id);
    if (!res.success) {
      setError(res.error);
      return;
    }
    setTokens((prev) =>
      prev.map((t) =>
        t.id === token.id ? { ...t, revokedAt: new Date().toISOString() } : t
      )
    );
  };

  const copyToken = async () => {
    if (!freshToken) return;
    try {
      await navigator.clipboard.writeText(freshToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Couldn't copy to clipboard.");
    }
  };

  const activeTokens = tokens.filter((t) => !t.revokedAt);

  return (
    <section className="bg-card border border-border rounded-2xl p-6">
      <header className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h2 className="text-foreground font-semibold flex items-center gap-2">
            <KeyRound size={14} className="text-text-muted" />
            API tokens
          </h2>
          <p className="text-xs text-text-muted mt-1 max-w-xl">
            For the Pulse Chrome extension and any first-party automation.
            Tokens grant this tenant&apos;s outbound scope — revoke any time.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setCreating(true);
            setFreshToken(null);
          }}
          className="gap-1.5"
        >
          <Plus size={14} />
          New token
        </Button>
      </header>

      {freshToken && (
        <div className="mb-4 rounded-lg border border-primary-500/40 bg-primary-500/5 p-4 space-y-2">
          <div className="flex items-start gap-2">
            <AlertTriangle size={14} className="text-primary-500 mt-0.5" />
            <p className="text-xs text-foreground">
              Save this token now. For security, Pulse will never show it again —
              if you lose it, create a new one.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-background border border-border rounded-md px-3 py-2 font-mono break-all">
              {freshToken}
            </code>
            <Button
              size="sm"
              variant="ghost"
              onClick={copyToken}
              className="gap-1.5 shrink-0"
            >
              {copied ? <Check size={12} className="text-status-green" /> : <Copy size={12} />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <button
            type="button"
            onClick={() => setFreshToken(null)}
            className="text-[11px] text-text-muted hover:text-foreground"
          >
            I&apos;ve saved it — dismiss
          </button>
        </div>
      )}

      {creating && !freshToken && (
        <div className="mb-4 rounded-lg border border-border p-4 space-y-2">
          <Label htmlFor="token-name">Token name</Label>
          <Input
            id="token-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Priye's Chrome extension"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setCreating(false);
                setName("");
              }}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={isPending || !name.trim()}
              className="gap-1.5"
            >
              {isPending && <Loader2 size={12} className="animate-spin" />}
              Generate token
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div
          className="mb-3 rounded-lg border border-status-red/30 bg-status-red/5 px-3 py-2 text-sm text-status-red"
          role="alert"
        >
          {error}
        </div>
      )}

      {activeTokens.length === 0 ? (
        <p className="text-xs text-text-muted italic">
          No active tokens yet. Click &ldquo;New token&rdquo; to mint one for
          the Chrome extension.
        </p>
      ) : (
        <ul className="divide-y divide-border/30">
          {activeTokens.map((t) => (
            <li
              key={t.id}
              className="py-3 flex items-center gap-3 flex-wrap"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground font-medium truncate">
                  {t.name}
                </p>
                <p className="text-[11px] text-text-muted mt-0.5 font-mono">
                  {t.tokenPrefix}…{t.tokenLast4}
                </p>
                <p className="text-[10px] text-text-muted mt-0.5">
                  Created {formatDate(t.createdAt)}
                  {t.lastUsedAt
                    ? ` · last used ${formatDateTime(t.lastUsedAt)}`
                    : " · never used"}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleRevoke(t)}
                className="text-status-red hover:text-status-red gap-1.5"
              >
                <Trash2 size={12} />
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
