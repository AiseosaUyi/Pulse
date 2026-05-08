"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, FolderOpen, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDialogs } from "@/components/ui/Dialog";
import { disconnectDriveAction } from "@/lib/actions/drive-connections";
import type { DriveConnectionStatus } from "@/lib/services/drive-connections";

export function DriveSection({
  status,
  flash,
}: {
  status: DriveConnectionStatus;
  flash: { kind: "success" | "error"; message: string } | null;
}) {
  const dialogs = useDialogs();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const [localStatus, setLocalStatus] = useState(status);

  const onConnect = () => {
    setBusy(true);
    window.location.href = "/api/integrations/drive/connect";
  };

  const onDisconnect = async () => {
    const ok = await dialogs.confirm({
      title: "Disconnect Google Drive?",
      subtitle:
        "Pulse will stop syncing files. Existing rows will mark themselves 'missing' on next reconcile. Drive files themselves are not deleted.",
      confirmLabel: "Disconnect",
      tone: "destructive",
    });
    if (!ok) return;

    startTransition(async () => {
      const res = await disconnectDriveAction();
      if (res.ok) {
        setLocalStatus({
          connected: false,
          status: null,
          rootFolderId: null,
          connectedAt: null,
          lastError: null,
        });
      } else {
        await dialogs.alert({
          title: "Disconnect failed",
          subtitle: res.error,
        });
      }
    });
  };

  return (
    <section className="bg-card border border-border rounded-2xl p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center flex-shrink-0">
            <FolderOpen size={18} className="text-primary-600" />
          </div>
          <div>
            <h3
              className="text-base text-foreground"
              style={{ fontFamily: "'Satoshi-700', var(--font-sans)" }}
            >
              Google Drive
            </h3>
            <p className="text-sm text-text-muted mt-0.5">
              Storage backbone for Content Pipeline. Pulse creates a /Pulse
              folder in your Drive and tracks metadata locally.
            </p>
          </div>
        </div>
        {localStatus.connected ? (
          <div className="flex items-center gap-2 text-status-green text-sm flex-shrink-0">
            <CheckCircle2 size={14} />
            Connected
          </div>
        ) : null}
      </div>

      {flash ? (
        <div
          className={`mt-4 p-3 rounded-lg text-sm ${
            flash.kind === "success"
              ? "bg-status-green/10 text-status-green"
              : "bg-red-500/10 text-red-600"
          }`}
        >
          {flash.message}
        </div>
      ) : null}

      {localStatus.lastError ? (
        <div className="mt-4 p-3 rounded-lg bg-red-500/10 text-red-600 text-sm">
          {localStatus.lastError}
        </div>
      ) : null}

      <div className="mt-5 flex items-center gap-3">
        {localStatus.connected ? (
          <>
            <span className="text-xs text-text-muted">
              Connected{" "}
              {localStatus.connectedAt
                ? new Date(localStatus.connectedAt).toLocaleDateString()
                : ""}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onDisconnect}
            >
              <Trash2 size={14} className="mr-1.5" />
              Disconnect
            </Button>
          </>
        ) : (
          <Button type="button" onClick={onConnect} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin mr-1.5" /> : null}
            Connect Google Drive
          </Button>
        )}
      </div>
    </section>
  );
}
