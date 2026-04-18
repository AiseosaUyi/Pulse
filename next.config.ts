import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The blog/SERP/scoring AI prompts live as markdown files under
  // `prompts/` and are read at runtime via `src/lib/ai/prompts.ts
  // loadPrompt()`. Next's file tracer follows imports, not arbitrary
  // fs reads, so we have to force-include the directory in every
  // server function bundle.
  outputFileTracingIncludes: {
    "/**/*": ["./prompts/**/*"],
  },
};

export default nextConfig;
