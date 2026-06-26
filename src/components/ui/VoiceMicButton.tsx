"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Mic, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/Toaster";

interface SpeechResultItem {
  isFinal: boolean;
  0: { transcript: string };
  length: number;
}

interface SpeechEvent {
  resultIndex: number;
  results: ArrayLike<SpeechResultItem>;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: SpeechEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const emptySubscribe = () => () => {};
const BAR_COUNT = 28;

export function VoiceMicButton({
  onTranscript,
  className,
}: {
  onTranscript: (text: string) => void;
  className?: string;
}) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Stable ref so onresult closure never captures a stale callback
  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  const voiceSupported = useSyncExternalStore(
    emptySubscribe,
    () => getSpeechRecognition() !== null,
    () => false
  );

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);

    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    const barW = (width / BAR_COUNT) * 0.55;
    const gap = (width / BAR_COUNT) * 0.45;
    const step = Math.max(1, Math.floor(data.length / BAR_COUNT));
    const cy = height / 2;

    for (let i = 0; i < BAR_COUNT; i++) {
      const value = data[i * step] / 255;
      const bh = Math.max(3, value * height * 0.88);
      const x = i * (barW + gap);
      const y = cy - bh / 2;
      const r = 1.5;
      ctx.fillStyle = "#ad112c";
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + barW - r, y);
      ctx.arcTo(x + barW, y, x + barW, y + r, r);
      ctx.lineTo(x + barW, y + bh - r);
      ctx.arcTo(x + barW, y + bh, x + barW - r, y + bh, r);
      ctx.lineTo(x + r, y + bh);
      ctx.arcTo(x, y + bh, x, y + bh - r, r);
      ctx.lineTo(x, y + r);
      ctx.arcTo(x, y, x + r, y, r);
      ctx.closePath();
      ctx.fill();
    }

    rafRef.current = requestAnimationFrame(drawWaveform);
  }, []);

  const stopRecording = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;

    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;

    const canvas = canvasRef.current;
    if (canvas) canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);

    setListening(false);
  }, []);

  useEffect(() => () => stopRecording(), [stopRecording]);

  async function startRecording() {
    const Recognition = getSpeechRecognition();
    if (!Recognition) {
      toast.error("Voice input isn't supported in this browser — type instead.");
      return;
    }

    // Get mic stream for waveform — best-effort, transcription works without it
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.8;
      analyserRef.current = analyser;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
      rafRef.current = requestAnimationFrame(drawWaveform);
    } catch {
      // mic permission denied — recording still works, just no waveform
    }

    const rec = new Recognition();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.continuous = true; // keep listening until the user explicitly stops
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          onTranscriptRef.current(e.results[i][0].transcript);
        }
      }
    };
    rec.onerror = () => {
      toast.error("Mic blocked or unavailable — type instead.");
      stopRecording();
    };
    rec.onend = () => stopRecording();
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  }

  if (!voiceSupported) return null;

  if (listening) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <canvas
          ref={canvasRef}
          width={120}
          height={28}
          className="shrink-0 rounded-sm"
          aria-label="Voice waveform"
        />
        <button
          type="button"
          onClick={stopRecording}
          aria-label="Stop recording"
          className="grid size-7 shrink-0 place-items-center rounded-full bg-primary-500 text-white transition hover:bg-primary-600"
        >
          <Square className="size-3 fill-current" />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={startRecording}
      aria-label="Start voice input"
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-full text-gray-1000 transition hover:bg-gray-50 hover:text-gray-1200",
        className
      )}
    >
      <Mic className="size-4" />
    </button>
  );
}
