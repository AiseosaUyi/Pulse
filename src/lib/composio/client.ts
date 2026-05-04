import { Composio } from "@composio/core";

// Factory function — never instantiate at module load (Vercel page-data
// collection runs before env vars are guaranteed to be injected).
export function createComposioClient() {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) {
    throw new Error("COMPOSIO_API_KEY is not set");
  }
  return new Composio({ apiKey });
}

export function isComposioConfigured(): boolean {
  return !!process.env.COMPOSIO_API_KEY;
}

// Pulse uses each alias as its own Composio user_id. Aliases are short
// identity labels (gruve | sippy | personal). One Composio org owns all
// three; each (alias, toolkit) pair holds a distinct OAuth connection.
export type Alias = string;

export type Toolkit = "instagram" | "tiktok" | "linkedin";
