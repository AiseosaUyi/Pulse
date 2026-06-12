"use client";

// Tag editor as removable chips. Pre-filled with the AI-generated SEO tags;
// the user trims what they don't want (x) and types to add more. Commits on
// Enter or comma; de-dupes (case-insensitive) and trims.

import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";

export function TagChips({
  value,
  onChange,
  disabled,
  placeholder = "Add a tag and press Enter",
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  const add = (raw: string) => {
    const t = raw.trim().replace(/,+$/, "").trim();
    if (!t) return;
    const exists = value.some((v) => v.toLowerCase() === t.toLowerCase());
    if (!exists) onChange([...value, t]);
    setDraft("");
  };

  const removeAt = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
      removeAt(value.length - 1);
    }
  };

  return (
    <div
      className={`flex flex-wrap gap-1.5 rounded-lg border border-border bg-card px-2 py-2 ${
        disabled ? "opacity-60" : ""
      }`}
    >
      {value.map((tag, i) => (
        <span
          key={`${tag}-${i}`}
          className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-primary-50 border border-primary-500/20 text-primary-500"
        >
          {tag}
          <button
            type="button"
            onClick={() => removeAt(i)}
            disabled={disabled}
            aria-label={`Remove ${tag}`}
            className="hover:text-red-500"
          >
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => add(draft)}
        disabled={disabled}
        placeholder={value.length === 0 ? placeholder : ""}
        className="flex-1 min-w-[120px] bg-transparent text-sm text-foreground outline-none placeholder:text-text-muted"
      />
    </div>
  );
}
