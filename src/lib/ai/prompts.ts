// Minimal prompt loader.
//
// Each prompt lives as a Markdown file under `prompts/<area>/<name>.md`
// with YAML frontmatter:
//
//   ---
//   name: blog/expand
//   version: 1
//   model: gpt-4.1
//   temperature: 0.4
//   ---
//
//   ## System
//   ...system prompt...
//
//   ## User template
//   ...user template with {placeholders}...
//
// Templates use `{variable}` interpolation. Unknown variables stay as-is
// so typos surface early.
//
// Reads are synchronous and cached after first access — safe for server
// code paths. `prompts/` must be included in the Vercel deployment; we
// copy the directory at build time via `serverExternalPackages` + a
// no-op (Next ships everything under the workspace root by default).

import fs from "node:fs";
import path from "node:path";

export interface LoadedPrompt {
  name: string;
  version: number;
  model: string;
  temperature: number;
  system: string;
  userTemplate: string;
}

const cache = new Map<string, LoadedPrompt>();

function promptsRoot(): string {
  return path.join(process.cwd(), "prompts");
}

function parseFrontmatter(raw: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw };

  const frontmatter: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^([a-zA-Z_]+):\s*>?\s*(.*)$/);
    if (!kv) continue;
    frontmatter[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return { frontmatter, body: match[2] };
}

function splitBody(body: string): { system: string; userTemplate: string } {
  // Matches "## System" and "## User template" (case-insensitive, any suffix).
  const sysMatch = body.match(
    /##\s*System\s*\n([\s\S]*?)(?=\n##\s+User(?:\s+template)?\b|\n*$)/i
  );
  const userMatch = body.match(/##\s*User(?:\s+template)?\s*\n([\s\S]*)$/i);
  return {
    system: sysMatch ? sysMatch[1].trim() : "",
    userTemplate: userMatch ? userMatch[1].trim() : body.trim(),
  };
}

export function loadPrompt(name: string): LoadedPrompt {
  const cached = cache.get(name);
  if (cached) return cached;

  const filePath = path.join(promptsRoot(), `${name}.md`);
  const raw = fs.readFileSync(filePath, "utf8");
  const { frontmatter, body } = parseFrontmatter(raw);
  const { system, userTemplate } = splitBody(body);

  const loaded: LoadedPrompt = {
    name: frontmatter.name || name,
    version: Number(frontmatter.version ?? 1),
    model: frontmatter.model || "gpt-4.1",
    temperature: Number(frontmatter.temperature ?? 0.4),
    system,
    userTemplate,
  };

  cache.set(name, loaded);
  return loaded;
}

/**
 * Simple `{key}` → value interpolation. Unknown keys are left in place
 * ("{key}") so missing variables surface at runtime instead of silently
 * rendering to an empty string.
 */
export function renderTemplate(
  template: string,
  vars: Record<string, string | number>
): string {
  return template.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_, key) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      return String(vars[key]);
    }
    return `{${key}}`;
  });
}

/** Clear the cache — used in tests + hot-reload scenarios. */
export function _resetPromptCache(): void {
  cache.clear();
}
