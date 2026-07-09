import fs from "fs";
import { defineConfig, devices } from "@playwright/test";

// Playwright config — spins up `pnpm dev` for the duration of the run
// and hits http://localhost:3000 with chromium.
//
// Authed flows (see tests/e2e/helpers/auth.ts) need SEED_EMAIL/
// SEED_PASSWORD in process.env. The Next dev server (spawned below) loads
// .env.local for itself automatically, but the Playwright test-runner
// process does not — and shell `export`/`source` of these specific names
// doesn't reliably propagate through this environment's sandboxing, so
// load them directly from the file instead of relying on either.
for (const key of ["SEED_EMAIL", "SEED_PASSWORD"]) {
  if (process.env[key]) continue;
  try {
    const match = fs
      .readFileSync(".env.local", "utf8")
      .split("\n")
      .find((line) => line.startsWith(`${key}=`));
    if (match) process.env[key] = match.slice(key.length + 1).trim();
  } catch {
    // .env.local missing entirely — authed e2e specs will report their own
    // clear error when SEED_EMAIL/SEED_PASSWORD turn out to be unset.
  }
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["list"]],
  use: {
    // Port 3001 avoids collisions with the Sippy Webapp (next-server) which
    // binds :3000 in local dev. Playwright would otherwise reuse that server
    // and run tests against the wrong app entirely.
    baseURL: "http://localhost:3001",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm dev --port 3001",
    url: "http://localhost:3001",
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120_000,
  },
});
