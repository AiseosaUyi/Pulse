"use client";

import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

interface OtpInputProps {
  name: string;
  length?: number;
  autoFocus?: boolean;
  defaultValue?: string;
}

export function OtpInput({ name, length = 6, autoFocus = true, defaultValue = "" }: OtpInputProps) {
  const initial = Array.from({ length }, (_, i) => defaultValue[i] ?? "");
  const [digits, setDigits] = useState<string[]>(initial);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (autoFocus) inputs.current[0]?.focus();
  }, [autoFocus]);

  function setAt(i: number, val: string) {
    setDigits((prev) => {
      const next = [...prev];
      next[i] = val;
      return next;
    });
  }

  function handleChange(i: number, raw: string) {
    const digitsOnly = raw.replace(/\D/g, "");
    if (!digitsOnly) {
      setAt(i, "");
      return;
    }
    // Multi-char input (e.g. paste into the middle): spread across boxes.
    if (digitsOnly.length > 1) {
      const chars = digitsOnly.slice(0, length - i).split("");
      setDigits((prev) => {
        const next = [...prev];
        chars.forEach((c, idx) => (next[i + idx] = c));
        return next;
      });
      const target = Math.min(i + chars.length, length - 1);
      inputs.current[target]?.focus();
      return;
    }
    setAt(i, digitsOnly);
    if (i < length - 1) inputs.current[i + 1]?.focus();
  }

  function handleKeyDown(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      e.preventDefault();
      setAt(i - 1, "");
      inputs.current[i - 1]?.focus();
      return;
    }
    if (e.key === "ArrowLeft" && i > 0) {
      e.preventDefault();
      inputs.current[i - 1]?.focus();
    }
    if (e.key === "ArrowRight" && i < length - 1) {
      e.preventDefault();
      inputs.current[i + 1]?.focus();
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    if (!text) return;
    e.preventDefault();
    const chars = text.split("");
    setDigits(() => {
      const next = Array.from({ length }, (_, i) => chars[i] ?? "");
      return next;
    });
    const target = Math.min(chars.length, length - 1);
    inputs.current[target]?.focus();
  }

  const value = digits.join("");

  return (
    <div>
      <input type="hidden" name={name} value={value} />
      <div className="flex items-center justify-between gap-2 sm:gap-3">
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              inputs.current[i] = el;
            }}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={1}
            value={d}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={handlePaste}
            aria-label={`Digit ${i + 1}`}
            className={cn(
              "flex-1 min-w-0 h-14 sm:h-16 text-center rounded-xl border bg-transparent",
              "[font-family:'Satoshi-700',var(--font-sans)] text-2xl sm:text-3xl text-gray-1200",
              "outline-none transition-all duration-150",
              d
                ? "border-primary-500/40 bg-primary-50/50"
                : "border-white-200",
              "focus-visible:border-primary-500 focus-visible:ring-2 focus-visible:ring-primary-500/20"
            )}
          />
        ))}
      </div>
    </div>
  );
}
