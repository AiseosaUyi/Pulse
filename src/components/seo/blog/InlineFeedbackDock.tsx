"use client";

// Compact feedback + regenerate dock for the sticky right column of
// the full-page editor. Two primary actions:
//
//   Save       → stashes the typed/recorded feedback as a pending
//                blog_post_feedback row (applied later from the
//                Past Feedback drawer)
//   Regenerate → opens RegenerateDialog, which is where the AI-
//                suggestions checkbox, the rejection handling, and
//                the iterate-to-90 call all live.

import { useEffect, useRef, useState } from "react";
import {
  Mic,
  Square,
  Loader2,
  Send,
  Trash2,
  Sparkles,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import {
  submitFeedback,
  createFeedbackUploadTarget,
  transcribeFeedbackAudioPath,
} from "@/lib/actions/blog-feedback";
import { RegenerateDialog } from "./RegenerateDialog";
import type { BlogPostRecord } from "@/lib/types/blog-posts";

const AUDIO_BUCKET = "blog-feedback-audio";
const MAX_RECORDING_MS = 5 * 60_000;

type PendingAudio = {
  blob: Blob;
  url: string;
  durationSec: number;
};

export function InlineFeedbackDock({
  post,
  tenantSlug,
  onAfterAction,
}: {
  post: BlogPostRecord;
  tenantSlug: string;
  onAfterAction?: () => void;
}) {
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [pendingAudio, setPendingAudio] = useState<PendingAudio | null>(null);
  const [busy, setBusy] = useState<"idle" | "submitting" | "preparing">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // When the user hits Regenerate, we open the dialog and pass a
  // pre-computed feedback string (typed + any transcribed audio).
  const [dialogState, setDialogState] = useState<
    | { open: false }
    | { open: true; initialFeedback: string }
  >({ open: false });

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startAtRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  /** Uploads pending audio → transcribes → returns merged text with
   *  the typed feedback. Used only by the Regenerate flow; Save uses
   *  submitFeedback directly (which does its own transcription
   *  server-side). */
  const uploadAndTranscribe = async (): Promise<string> => {
    const trimmed = text.trim();
    if (!pendingAudio) return trimmed;

    const target = await createFeedbackUploadTarget(post.id, tenantSlug);
    if (!target.success) throw new Error(target.error);

    const supabase = createClient();
    const up = await supabase.storage
      .from(AUDIO_BUCKET)
      .uploadToSignedUrl(target.path, target.token, pendingAudio.blob, {
        contentType: "audio/webm",
      });
    if (up.error) throw new Error(up.error.message);

    const t = await transcribeFeedbackAudioPath(target.path, tenantSlug);
    if (!t.success) throw new Error(t.error);
    return [trimmed, t.text].filter(Boolean).join("\n").trim();
  };

  const handleSubmit = async () => {
    setError(null);
    setNotice(null);
    if (!text.trim() && !pendingAudio) {
      setError("Type or record something first.");
      return;
    }
    setBusy("submitting");
    try {
      let audioPath: string | undefined;
      if (pendingAudio) {
        const target = await createFeedbackUploadTarget(post.id, tenantSlug);
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
        postId: post.id,
        tenantSlug,
        feedbackText: text.trim() || undefined,
        feedbackAudioPath: audioPath,
      });
      if (!res.success) throw new Error(res.error);

      setText("");
      if (pendingAudio) URL.revokeObjectURL(pendingAudio.url);
      setPendingAudio(null);
      setNotice("Feedback saved — review it in the Past Feedback drawer.");
      onAfterAction?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setBusy("idle");
    }
  };

  const handleOpenRegenerate = async () => {
    setError(null);
    setNotice(null);
    try {
      setBusy("preparing");
      const initialFeedback = pendingAudio
        ? await uploadAndTranscribe()
        : text.trim();
      setDialogState({ open: true, initialFeedback });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not prepare feedback");
    } finally {
      setBusy("idle");
    }
  };

  const handleRegenerateSuccess = (note: string) => {
    setDialogState({ open: false });
    setText("");
    if (pendingAudio) URL.revokeObjectURL(pendingAudio.url);
    setPendingAudio(null);
    setNotice(note);
    onAfterAction?.();
  };

  const disabled = busy !== "idle" || recording;
  const hasInput = Boolean(text.trim()) || Boolean(pendingAudio);

  return (
    <>
      <div className="border-t border-border/50 bg-card/80 backdrop-blur-sm p-4 space-y-3">
        <Textarea
          placeholder="Scan the post and tell us what to change — or leave blank to regenerate cold."
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          disabled={disabled}
          className="text-sm"
        />

        <div className="flex items-center gap-2 flex-wrap">
          {!recording && !pendingAudio && (
            <Button
              variant="ghost"
              size="sm"
              onClick={startRecording}
              disabled={disabled}
            >
              <Mic size={14} />
              Voice
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
              {formatElapsed(elapsed)}
            </Button>
          )}
          {pendingAudio && (
            <div className="flex items-center gap-2">
              <audio
                src={pendingAudio.url}
                controls
                className="h-7"
                preload="metadata"
              />
              <span className="text-[10px] text-text-muted">
                {pendingAudio.durationSec}s
              </span>
              <button
                onClick={discardAudio}
                className="text-text-muted hover:text-red-500"
                title="Discard recording"
                disabled={disabled}
              >
                <Trash2 size={14} />
              </button>
            </div>
          )}

          <div className="flex-1" />

          <Button
            variant="ghost"
            size="sm"
            onClick={handleSubmit}
            disabled={disabled || !hasInput}
            title="Save as feedback to apply later"
          >
            {busy === "submitting" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Send size={14} />
            )}
            Save
          </Button>
          <Button
            size="sm"
            onClick={handleOpenRegenerate}
            disabled={disabled}
            title="Rewrite the post (opens a confirmation with AI suggestions)"
          >
            {busy === "preparing" ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Preparing…
              </>
            ) : (
              <>
                <Sparkles size={14} />
                Regenerate…
              </>
            )}
          </Button>
        </div>

        {error && (
          <p className="text-xs text-red-500 flex items-center gap-1" role="alert">
            <AlertTriangle size={12} />
            {error}
          </p>
        )}
        {notice && !error && (
          <p className="text-xs text-status-green" role="status">
            {notice}
          </p>
        )}
      </div>

      {dialogState.open && (
        <RegenerateDialog
          post={post}
          initialFeedback={dialogState.initialFeedback}
          onClose={() => setDialogState({ open: false })}
          onSuccess={handleRegenerateSuccess}
        />
      )}
    </>
  );
}

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
