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
  // Serve the Pulse JWKS at the canonical /.well-known/jwks.json that Gruve
  // fetches (PULSE-ASK.md §1), plus the MCP OAuth server's RFC 8414/9728
  // metadata at the two other standard .well-known paths. Defined here
  // (not only vercel.json) so these apply under `next dev` too —
  // vercel.json rewrites run only on the Vercel platform, which made this
  // path unverifiable locally and masked whether it resolved at all.
  // beforeFiles runs before the auth proxy; the proxy then sees /api/...
  // (isApi → passes through un-gated).
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/.well-known/jwks.json", destination: "/api/jwks" },
        {
          source: "/.well-known/oauth-authorization-server",
          destination: "/api/oauth/authorization-server-metadata",
        },
        {
          source: "/.well-known/oauth-protected-resource",
          destination: "/api/oauth/protected-resource-metadata",
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
