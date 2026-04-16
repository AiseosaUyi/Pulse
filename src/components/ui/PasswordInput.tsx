"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface PasswordInputProps {
  name: string;
  autoComplete?: "current-password" | "new-password";
  minLength?: number;
  required?: boolean;
  className?: string;
}

export function PasswordInput({
  name,
  autoComplete = "current-password",
  minLength,
  required,
  className,
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className={cn("relative", className)}>
      <input
        type={visible ? "text" : "password"}
        name={name}
        required={required}
        minLength={minLength}
        autoComplete={autoComplete}
        className={cn(
          "flex h-12 w-full rounded-lg border border-white-200 bg-transparent px-4 pr-12 py-3 text-sm",
          "placeholder:text-gray-1000 text-gray-1200 outline-none transition-colors duration-200",
          "focus-visible:border-blue-500 focus-visible:ring-1 focus-visible:ring-blue-500/30"
        )}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        className="absolute right-0 top-0 h-full px-4 flex items-center text-gray-500 hover:text-gray-1200 cursor-pointer transition-colors"
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}
