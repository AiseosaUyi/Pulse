import { defineConfig, devices } from "@playwright/test";

// Playwright config — spins up `pnpm dev` for the duration of the run
// and hits http://localhost:3000 with chromium. Keep the first run to
// the smoke layer (auth gate + a couple unauthed pages). Authed flows
// need a seed-user login helper, which we'll add in a follow-up pass.

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
