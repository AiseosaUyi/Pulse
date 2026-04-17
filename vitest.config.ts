import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
    env: loadEnvLocal(),
    testTimeout: 15_000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});

function loadEnvLocal(): Record<string, string> {
  const fs = require("node:fs");
  const file = path.resolve(__dirname, ".env.local");
  if (!fs.existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
