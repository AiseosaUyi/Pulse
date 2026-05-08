// Pure slug helpers — extracted out of actions/content-pipeline.ts
// because Next/Turbopack rejects non-async exports from "use server"
// files. Same pattern as the recent blog-ideate / content-engine fixes
// (commits 5e2a4e4, dd0cefc).

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugifyContentType(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
