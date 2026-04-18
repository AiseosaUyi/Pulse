"use client";

// Compact feedback + regenerate dock for the side panel. Exists so
// the user can scan the blog content and talk/type feedback in the
// same surface — the full-history FeedbackPanel still lives on the
// editor modal for longer reviews.
//
// Two primary actions:
//   Submit       → stashes as pending feedback (user applies later
//                  from the editor's Feedback tab)
//   Regenerate   → runs the iterate-to-90 loop again, optionally
//                  seeded with the typed/transcribed feedback.
//                  A plain button click with empty text is a "plain
//                  retry"; text in the box makes it "retry with
//                  feedback" per the two-mode UX.

import { useEffect, useRef, useState, useTransition } from "react";
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
import { regenerateBlogPost } from "@/lib/actions/blog-posts";

const AUDIO_BUCKET = "blog-feedback-audio";
const MAX_RECORDING_MS = 5 * 60_000;

type PendingAudio = {
  blob: Blob;
  url: string;
  durationSec: number;
};

export function InlineFeedbackDock({
  postId,
  tenantSlug,
  onAfterAction,
}: {
  postId: string;
  tenantSlug: string;
  onAfterAction?: () => void;
}) {
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [pendingAudio, setPendingAudio] = useState<PendingAudio | null>(null);
  const [busy, setBusy] = useState<
    "idle" | "submitting" | "regenerating" | "transcribing"
  >("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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

  /** Shared helper: uploads pending audio + transcribes it so
   *  submitFeedback / regenerate can both consume the text. */
  const ensureText = async (): Promise<{
    text: string;
    audioPath?: string;
  }> => {
    const trimmed = text.trim();
    if (!pendingAudio) return { text: trimmed };

    setBusy("transcribing");
    const target = await createFeedbackUploadTarget(postId, tenantSlug);
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
    const merged = [trimmed, t.text].filter(Boolean).join("\n").trim();
    return { text: merged, audioPath: target.path };
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
        feedbackText: text.trim() || undefined,
        feedbackAudioPath: audioPath,
      });
      if (!res.success) throw new Error(res.error);

      setText("");
      if (pendingAudio) URL.revokeObjectURL(pendingAudio.url);
      setPendingAudio(null);
      setNotice("Feedback saved — apply it from the editor's Feedback tab.");
      onAfterAction?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setBusy("idle");
    }
  };

  const handleRegenerate = () => {
    setError(null);
    setNotice(null);
    if (
      !window.confirm(
        pendingAudio || text.trim()
          ? "Regenerate this post using your feedback? The current version is archived."
          : "Regenerate this post from scratch? The current version is archived."
      )
    ) {
      return;
    }

    startTransition(async () => {
      setBusy("regenerating");
      try {
        let combined: string | undefined;
        if (pendingAudio) {
          const { text: merged } = await ensureText();
          combined = merged || undefined;
        } else {
          combined = text.trim() || undefined;
        }

        const res = await regenerateBlogPost(postId, tenantSlug, {
          extraFeedback: combined,
        });
        if (!res.success) throw new Error(res.error);

        setText("");
        if (pendingAudio) URL.revokeObjectURL(pendingAudio.url);
        setPendingAudio(null);
        setNotice(
          res.contentScore != null
            ? `Regenerated · score ${res.contentScore}`
            : "Regenerated"
        );
        onAfterAction?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Regenerate failed");
      } finally {
        setBusy("idle");
      }
    });
  };

  const disabled = busy !== "idle" || recording || isPending;
  const hasInput = Boolean(text.trim()) || Boolean(pendingAudio);

  return (
    <div className="border-t border-border/50 bg-card/80 backdrop-blur-sm p-4 space-y-3">
      <Textarea
        placeholder="Scan the post above and tell us what to change — or leave blank to regenerate cold."
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
          onClick={handleRegenerate}
          disabled={disabled}
          title={
            hasInput
              ? "Rewrite the post using your feedback"
              : "Rewrite the post from scratch (same inputs)"
          }
        >
          {busy === "regenerating" || busy === "transcribing" ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              {busy === "transcribing" ? "Transcribing…" : "Regenerating…"}
            </>
          ) : (
            <>
              <Sparkles size={14} />
              Regenerate
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
  );
}

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
