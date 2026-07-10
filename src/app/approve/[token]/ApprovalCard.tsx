"use client";

import { useState } from "react";
import { Pencil, CircleCheck, X, AlertTriangle, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogHeader,
  DialogBody,
  DialogFooter,
} from "@/components/ui/Dialog";
import type { ApprovalTarget } from "@/lib/services/approvals";

type ViewState =
  | { kind: "reviewing" }
  | { kind: "editing" }
  | { kind: "approved"; target: ApprovalTarget }
  | { kind: "rejected" }
  | { kind: "error"; message: string };

function targetLabel(target: ApprovalTarget): string {
  return target.type === "scheduled_post"
    ? `${target.platform[0].toUpperCase()}${target.platform.slice(1)} post`
    : "Content brief";
}

function targetContent(target: ApprovalTarget): string {
  return target.type === "scheduled_post" ? target.content : target.draftContent;
}

function formatScheduledFor(iso: string): string {
  const date = new Date(iso);
  const isDue = date.getTime() <= Date.now();
  // Explicit locale — this component renders on the server for the
  // initial HTML; an environment-default toLocaleString() reads whatever
  // locale Node happens to be configured with, which can differ from the
  // browser's, causing a hydration mismatch on first paint.
  return isDue ? "publishing now" : `scheduled for ${date.toLocaleString("en-US")}`;
}

export function ApprovalCard({ token, target: initialTarget }: { token: string; target: ApprovalTarget }) {
  const [view, setView] = useState<ViewState>({ kind: "reviewing" });
  const [draft, setDraft] = useState(targetContent(initialTarget));
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);

  const editedFromOriginal = draft.trim() !== targetContent(initialTarget).trim();

  async function submitApprove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/approvals/${token}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(editedFromOriginal ? { editedContent: draft } : {}),
      });
      const body = await res.json();
      if (!res.ok) {
        setView({ kind: "error", message: body.error ?? "Something went wrong" });
        return;
      }
      setView({ kind: "approved", target: body.target as ApprovalTarget });
    } catch {
      setView({ kind: "error", message: "Something went wrong" });
    } finally {
      setBusy(false);
    }
  }

  async function submitReject() {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/approvals/${token}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: rejectReason }),
      });
      const body = await res.json();
      if (!res.ok) {
        setView({ kind: "error", message: body.error ?? "Something went wrong" });
        return;
      }
      setRejecting(false);
      setView({ kind: "rejected" });
    } catch {
      setView({ kind: "error", message: "Something went wrong" });
    } finally {
      setBusy(false);
    }
  }

  if (view.kind === "approved") {
    const target = view.target;
    return (
      <div className="flex flex-col items-center text-center gap-4 pt-10">
        <CircleCheck size={48} strokeWidth={1.75} className="text-success-500" />
        <div>
          <h1 className="text-lg text-gray-1100 [font-family:'Satoshi-700',var(--font-sans)]">
            {editedFromOriginal ? "Approved with your edits" : "Approved"}
          </h1>
          <p className="text-sm text-gray-1000 mt-1">
            {target.type === "scheduled_post"
              ? `You'll see it live on ${target.platform} — ${formatScheduledFor(target.scheduledFor)}.`
              : "Marked approved."}
          </p>
        </div>
      </div>
    );
  }

  if (view.kind === "rejected") {
    return (
      <div className="flex flex-col items-center text-center gap-4 pt-10">
        <X size={48} strokeWidth={1.75} className="text-gray-500" />
        <div>
          <h1 className="text-lg text-gray-1100 [font-family:'Satoshi-700',var(--font-sans)]">Rejected</h1>
          <p className="text-sm text-gray-1000 mt-1">This won&apos;t go out.</p>
        </div>
      </div>
    );
  }

  if (view.kind === "error") {
    return (
      <div className="flex flex-col items-center text-center gap-4 pt-10">
        <AlertTriangle size={48} strokeWidth={1.75} className="text-warning-500" />
        <div>
          <h1 className="text-lg text-gray-1100 [font-family:'Satoshi-700',var(--font-sans)]">
            Something went wrong
          </h1>
          <p className="text-sm text-gray-1000 mt-1">{view.message}</p>
        </div>
        <Button variant="tertiary" onClick={() => setView({ kind: "reviewing" })}>
          Try again
        </Button>
      </div>
    );
  }

  const isEditing = view.kind === "editing";

  return (
    <>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <p className="text-xs text-gray-1000">{targetLabel(initialTarget)}</p>
              {initialTarget.type === "scheduled_post" && (
                <p className="text-xs text-gray-1000 mt-0.5">{formatScheduledFor(initialTarget.scheduledFor)}</p>
              )}
            </div>
            {!isEditing && (
              <button
                type="button"
                onClick={() => setView({ kind: "editing" })}
                className="shrink-0 h-8 w-8 rounded-full flex items-center justify-center text-gray-1000 hover:bg-gray-50 hover:text-gray-1200 transition-colors duration-200"
                aria-label="Edit"
              >
                <Pencil size={18} strokeWidth={1.75} />
              </button>
            )}
          </div>

          {initialTarget.type === "content_brief" && initialTarget.outline.length > 0 && (
            <ul className="mb-3 pl-4 list-disc space-y-1">
              {initialTarget.outline.map((point, i) => (
                <li key={i} className="text-sm text-gray-1200">
                  {point}
                </li>
              ))}
            </ul>
          )}

          {isEditing ? (
            <Textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-40"
            />
          ) : (
            <p className="text-base text-gray-1200 whitespace-pre-wrap">{draft}</p>
          )}

          {initialTarget.type === "scheduled_post" && initialTarget.mediaPaths.length > 0 && !isEditing && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {initialTarget.mediaPaths.map((path) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={path} src={path} alt="" className="rounded-lg aspect-square object-cover w-full" />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="fixed bottom-0 left-0 right-0 z-40 bg-card h-20 pb-[env(safe-area-inset-bottom)] px-4 shadow-[0_-1px_0_0_var(--border)] flex items-center justify-end gap-3">
        {isEditing ? (
          <>
            <Button variant="tertiary" disabled={busy} onClick={() => { setDraft(targetContent(initialTarget)); setView({ kind: "reviewing" }); }}>
              Cancel edit
            </Button>
            <Button disabled={busy} onClick={submitApprove}>
              {busy && <Loader2 size={16} className="animate-spin" />}
              Save &amp; approve
            </Button>
          </>
        ) : (
          <>
            <Button variant="tertiary" disabled={busy} onClick={() => setRejecting(true)}>
              Reject
            </Button>
            <Button disabled={busy} onClick={submitApprove}>
              {busy && <Loader2 size={16} className="animate-spin" />}
              Approve
            </Button>
          </>
        )}
      </div>

      <Dialog open={rejecting} onClose={() => !busy && setRejecting(false)} locked={busy}>
        <DialogHeader title="Reject this?" subtitle="Why? (optional)" tone="default" icon={null} />
        <DialogBody>
          <Textarea
            autoFocus
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Not on-brand, wrong timing, needs a rewrite..."
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => setRejecting(false)}>
            Cancel
          </Button>
          <Button variant="tertiary" disabled={busy} onClick={submitReject}>
            {busy && <Loader2 size={16} className="animate-spin" />}
            Confirm reject
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
