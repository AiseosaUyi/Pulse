"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Mic, Square, Loader2, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/Badge";
import { createClient } from "@/lib/supabase/client";
import {
  submitFeedback,
  createFeedbackUploadTarget,
  applyFeedback,
  rejectFeedback,
  updateFeedbackTranscription,
} from "@/lib/actions/blog-feedback";
import type { BlogPostFeedbackRecord } from "@/lib/types/blog-posts";

const AUDIO_BUCKET = "blog-feedback-audio";
const MAX_RECORDING_MS = 5 * 60_000; // 5 min

type PendingAudio = {
  blob: Blob;
  url: string;
  durationSec: number;
};

export function FeedbackPanel({
  postId,
  tenantSlug,
  feedback,
  onApplied,
}: {
  postId: string;
  tenantSlug: string;
  feedback: BlogPostFeedbackRecord[];
  /** Fires after a feedback row applies — parent should refetch data. */
  onApplied?: () => void;
}) {
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [pendingAudio, setPendingAudio] = useState<PendingAudio | null>(null);
  const [uploading, setUploading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startAtRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clean up recording state on unmount so the mic isn't left hot.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (timerRef.current) clearInterval(timerRef.current);
      if (pendingAudio) URL.revokeObjectURL(pendingAudio.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const rec = new MediaRecorder(stream, { mimeType });
      recorderRef.current = rec;
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const durationSec = Math.round((Date.now() - startAtRef.current) / 1000);
        setPendingAudio({
          blob,
          url: URL.createObjectURL(blob),
          durationSec,
        });
        streamRef.current?.getTracks().forEach((t) => t.stop());
      };
      rec.start(250);
      setRecording(true);
      startAtRef.current = Date.now();
      setElapsed(0);
      timerRef.current = setInterval(() => {
        const ms = Date.now() - startAtRef.current;
        setElapsed(Math.floor(ms / 1000));
        if (ms >= MAX_RECORDING_MS) stopRecording();
      }, 250);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mic permission denied");
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const discardAudio = () => {
    if (pendingAudio) URL.revokeObjectURL(pendingAudio.url);
    setPendingAudio(null);
  };

  const handleSubmit = async () => {
    setError(null);
    const trimmed = text.trim();
    if (!trimmed && !pendingAudio) {
      setError("Type something or record audio first.");
      return;
    }

    setUploading(true);
    try {
      let audioPath: string | undefined;
      if (pendingAudio) {
        const target = await createFeedbackUploadTarget(postId, tenantSlug);
        if (!target.success) throw new Error(target.error);

        const supabase = createClient();
        const up = await supabase.storage
          .from(AUDIO_BUCKET)
          .uploadToSignedUrl(target.path, target.token, pendingAudio.blob, {
            contentType: "audio/webm",
          });
        if (up.error) throw new Error(up.error.message);
        audioPath = target.path;
      }

      const res = await submitFeedback({
        postId,
        tenantSlug,
        feedbackText: trimmed || undefined,
        feedbackAudioPath: audioPath,
      });
      if (!res.success) throw new Error(res.error);

      setText("");
      if (pendingAudio) URL.revokeObjectURL(pendingAudio.url);
      setPendingAudio(null);
      onApplied?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setUploading(false);
    }
  };

  const handleApply = (id: string) => {
    setError(null);
    startTransition(async () => {
      const res = await applyFeedback(id, tenantSlug);
      if (!res.success) {
        setError(res.error);
        return;
      }
      onApplied?.();
    });
  };

  const handleReject = (id: string) => {
    if (!window.confirm("Reject this feedback?")) return;
    startTransition(async () => {
      const res = await rejectFeedback(id, tenantSlug);
      if (!res.success) setError(res.error);
      else onApplied?.();
    });
  };

  const pendingCount = feedback.filter((f) => f.status === "pending").length;

  return (
    <div className="border border-border rounded-lg bg-card">
      <div className="p-4 border-b border-border/30">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-foreground font-semibold text-sm">
            Feedback{" "}
            {pendingCount > 0 && (
              <span className="text-[10px] text-primary-500">
                ({pendingCount} pending)
              </span>
            )}
          </h3>
          <span className="text-[10px] text-text-muted">
            text or voice · max 5 min
          </span>
        </div>

        <Textarea
          placeholder="What should change? e.g. &quot;Make the intro punchier. Drop the third example.&quot;"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          disabled={uploading || recording}
          className="text-sm"
        />

        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {!recording && !pendingAudio && (
            <Button
              variant="ghost"
              size="sm"
              onClick={startRecording}
              disabled={uploading}
            >
              <Mic size={14} />
              Record voice
            </Button>
          )}
          {recording && (
            <Button
              variant="ghost"
              size="sm"
              onClick={stopRecording}
              className="text-red-500"
            >
              <Square size={14} />
              Stop · {formatElapsed(elapsed)}
            </Button>
          )}
          {pendingAudio && (
            <div className="flex items-center gap-2">
              <audio
                src={pendingAudio.url}
                controls
                className="h-8"
                preload="metadata"
              />
              <span className="text-[10px] text-text-muted">
                {pendingAudio.durationSec}s · will transcribe
              </span>
              <button
                onClick={discardAudio}
                className="text-text-muted hover:text-red-500"
                title="Discard recording"
              >
                <Trash2 size={14} />
              </button>
            </div>
          )}

          <div className="flex-1" />

          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={uploading || recording || (!text.trim() && !pendingAudio)}
          >
            {uploading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Submitting…
              </>
            ) : (
              <>
                <Send size={14} />
                Submit
              </>
            )}
          </Button>
        </div>

        {error && (
          <p className="text-xs text-red-500 mt-2" role="alert">
            {error}
          </p>
        )}
      </div>

      {feedback.length > 0 && (
        <ul className="divide-y divide-border/30 max-h-[320px] overflow-y-auto">
          {feedback.map((f) => (
            <FeedbackItem
              key={f.id}
              feedback={f}
              tenantSlug={tenantSlug}
              busy={isPending}
              onApply={() => handleApply(f.id)}
              onReject={() => handleReject(f.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function FeedbackItem({
  feedback,
  tenantSlug,
  busy,
  onApply,
  onReject,
}: {
  feedback: BlogPostFeedbackRecord;
  tenantSlug: string;
  busy: boolean;
  onApply: () => void;
  onReject: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [transcription, setTranscription] = useState(
    feedback.transcription ?? ""
  );
  const [saving, setSaving] = useState(false);

  const body =
    feedback.transcription ||
    feedback.feedbackText ||
    "(empty)";

  const statusVariant: Record<
    BlogPostFeedbackRecord["status"],
    "draft_status" | "published" | "dismissed"
  > = {
    pending: "draft_status",
    applied: "published",
    rejected: "dismissed",
  };

  const saveTranscription = async () => {
    setSaving(true);
    await updateFeedbackTranscription(feedback.id, tenantSlug, transcription);
    setSaving(false);
    setEditing(false);
  };

  return (
    <li className="p-4 text-sm">
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <div className="flex items-center gap-2 text-[10px] text-text-muted">
          {feedback.feedbackAudioPath && (
            <span title="Recorded via voice">
              <Mic size={10} />
            </span>
          )}
          <span>
            {new Date(feedback.createdAt).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
        </div>
        <Badge variant={statusVariant[feedback.status]}>
          {feedback.status}
        </Badge>
      </div>

      {editing ? (
        <div className="space-y-2">
          <Textarea
            value={transcription}
            onChange={(e) => setTranscription(e.target.value)}
            rows={3}
            className="text-sm"
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={saveTranscription} disabled={saving}>
              Save
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditing(false);
                setTranscription(feedback.transcription ?? "");
              }}
              disabled={saving}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-text-secondary whitespace-pre-wrap">{body}</p>
      )}

      {feedback.status === "pending" && !editing && (
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <Button size="sm" onClick={onApply} disabled={busy}>
            Apply
          </Button>
          {feedback.feedbackAudioPath && feedback.transcription && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditing(true)}
              disabled={busy}
            >
              Edit transcript
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onReject}
            disabled={busy}
            className="text-text-muted"
          >
            Reject
          </Button>
        </div>
      )}
    </li>
  );
}

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
