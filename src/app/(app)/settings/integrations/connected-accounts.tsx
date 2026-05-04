"use client";

import { useState, useTransition } from "react";
import {
  initiateComposioConnection,
  confirmComposioConnection,
  disconnectComposioAccount,
} from "@/lib/actions/composio";

type Toolkit = "instagram" | "tiktok" | "linkedin";

interface ConnectedAccountRow {
  id: string;
  toolkit: Toolkit;
  alias: string;
  status: string;
  userHandle: string | null;
  displayName: string | null;
  connectedAt: string | null;
  lastSyncedAt: string | null;
}

const TOOLKIT_LABEL: Record<Toolkit, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
};

const TOOLKIT_OPTIONS: Toolkit[] = ["instagram", "tiktok", "linkedin"];
const ALIAS_OPTIONS = ["gruve", "sippy", "personal"];

export function ConnectedAccountsSection({
  tenantSlug,
  initial,
}: {
  tenantSlug: string;
  initial: ConnectedAccountRow[];
}) {
  const [rows, setRows] = useState(initial);
  const [toolkit, setToolkit] = useState<Toolkit>("instagram");
  const [alias, setAlias] = useState(ALIAS_OPTIONS[0]);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{
    type: "info" | "error";
    message: string;
  } | null>(null);

  const onConnect = () => {
    setFeedback(null);
    startTransition(async () => {
      const res = await initiateComposioConnection({
        tenantSlug,
        toolkit,
        alias,
      });
      if (!res.success) {
        setFeedback({ type: "error", message: res.error });
        return;
      }
      if (res.redirectUrl) {
        window.open(res.redirectUrl, "_blank", "noopener,noreferrer");
      }
      setFeedback({
        type: "info",
        message:
          "OAuth window opened. Authorize, then click 'Confirm' below to refresh status.",
      });
      setRows((prev) => [
        ...prev.filter(
          (r) => !(r.toolkit === toolkit && r.alias === alias)
        ),
        {
          id: res.connectionId,
          toolkit,
          alias,
          status: "pending",
          userHandle: null,
          displayName: null,
          connectedAt: null,
          lastSyncedAt: null,
        },
      ]);
    });
  };

  const onConfirm = (connectionId: string) => {
    setFeedback(null);
    startTransition(async () => {
      const res = await confirmComposioConnection(connectionId);
      if (!res.success) {
        setFeedback({ type: "error", message: res.error });
        return;
      }
      setFeedback({
        type: "info",
        message: `Connection status: ${res.status}`,
      });
      setRows((prev) =>
        prev.map((r) =>
          r.id === connectionId
            ? { ...r, status: res.status === "ACTIVE" ? "active" : r.status }
            : r
        )
      );
    });
  };

  const onDisconnect = (rowId: string) => {
    if (!confirm("Disconnect this account? Tools will stop working immediately.")) {
      return;
    }
    setFeedback(null);
    startTransition(async () => {
      const res = await disconnectComposioAccount(rowId);
      if (!res.success) {
        setFeedback({ type: "error", message: res.error });
        return;
      }
      setRows((prev) =>
        prev.map((r) => (r.id === rowId ? { ...r, status: "revoked" } : r))
      );
    });
  };

  return (
    <section className="bg-card border border-border rounded-2xl p-6">
      <header className="mb-4">
        <h2 className="text-base font-semibold text-foreground">
          Connected social accounts
        </h2>
        <p className="text-xs text-text-muted mt-1">
          Connect Instagram (Business/Creator), TikTok, and LinkedIn per
          alias. Each alias holds its own OAuth token via Composio. Use
          aliases to keep Gruve, Sippy, and personal identities separate.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-text-muted">Toolkit</span>
          <select
            value={toolkit}
            onChange={(e) => setToolkit(e.target.value as Toolkit)}
            className="text-sm rounded border border-border/50 bg-background px-2 py-1.5 text-foreground"
          >
            {TOOLKIT_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {TOOLKIT_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-text-muted">Alias</span>
          <select
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            className="text-sm rounded border border-border/50 bg-background px-2 py-1.5 text-foreground"
          >
            {ALIAS_OPTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={isPending}
          onClick={onConnect}
          className="text-sm px-4 py-1.5 rounded bg-primary-500 text-white hover:bg-primary-500/90 disabled:opacity-50 font-medium"
        >
          {isPending ? "Working…" : "Connect"}
        </button>
      </div>

      {feedback && (
        <p
          className={`text-xs mb-3 ${feedback.type === "error" ? "text-status-red" : "text-text-secondary"}`}
        >
          {feedback.message}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="text-xs text-text-muted">No connections yet.</p>
      ) : (
        <ul className="divide-y divide-border/40">
          {rows.map((r) => (
            <li
              key={r.id}
              className="py-3 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="text-sm text-foreground">
                  {TOOLKIT_LABEL[r.toolkit]}{" "}
                  <span className="text-text-muted">·</span> {r.alias}
                </p>
                <p className="text-xs text-text-muted">
                  {r.userHandle ?? "—"}{" "}
                  {r.displayName ? `(${r.displayName})` : ""}{" "}
                  {r.lastSyncedAt && (
                    <>
                      <span className="text-text-muted">·</span> last synced{" "}
                      {new Date(r.lastSyncedAt).toLocaleString()}
                    </>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span
                  className={`text-[11px] px-2 py-0.5 rounded ${
                    r.status === "active"
                      ? "bg-status-green/10 text-status-green"
                      : r.status === "pending"
                        ? "bg-status-yellow/10 text-status-yellow"
                        : "bg-border/50 text-text-muted"
                  }`}
                >
                  {r.status}
                </span>
                {r.status === "pending" && (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => onConfirm(r.id)}
                    className="text-[11px] px-2 py-1 rounded border border-border/50 text-foreground hover:border-primary-500/50"
                  >
                    Confirm
                  </button>
                )}
                {r.status !== "revoked" && (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => onDisconnect(r.id)}
                    className="text-[11px] px-2 py-1 rounded text-status-red hover:bg-status-red/10"
                  >
                    Disconnect
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
