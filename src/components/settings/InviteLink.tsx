"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

export function InviteLink({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== "undefined"
    ? `${window.location.origin}/signup?invite=${token}`
    : `/signup?invite=${token}`;

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1.5 text-xs text-primary-500 hover:text-primary-600 cursor-pointer [font-family:'Satoshi-500',var(--font-sans)]"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? "Copied" : "Copy invite link"}
    </button>
  );
}
