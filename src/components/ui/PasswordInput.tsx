"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

interface PasswordInputProps {
  name: string;
  autoComplete?: "current-password" | "new-password";
  minLength?: number;
  required?: boolean;
}

export function PasswordInput({
  name,
  autoComplete = "current-password",
  minLength,
  required,
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        type={visible ? "text" : "password"}
        name={name}
        required={required}
        minLength={minLength}
        autoComplete={autoComplete}
        className="w-full px-3 py-2.5 pr-10 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-accent-purple"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        className="absolute right-0 top-0 h-full px-3 flex items-center text-text-muted hover:text-text-secondary cursor-pointer transition-colors"
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}
