import type { Page, BrowserContext } from "@playwright/test";

// Real UI login against the seed founder account (SEED_EMAIL/SEED_PASSWORD),
// same account used by pnpm db:seed. No login helper existed yet for authed
// e2e flows (playwright.config.ts's own comment flagged this as a follow-up).
export async function loginAsSeedUser(page: Page): Promise<void> {
  const email = process.env.SEED_EMAIL;
  const password = process.env.SEED_PASSWORD;
  if (!email || !password) {
    throw new Error("SEED_EMAIL/SEED_PASSWORD must be set in .env.local for authed e2e tests");
  }

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
}

// Switches the active tenant via the same "tenant" cookie getCurrentTenant()
// reads (src/lib/auth.ts) — faster and more reliable than driving the
// tenant-switcher UI for tests that are about a specific tenant's feature,
// not about the switcher itself.
export async function switchToTenant(
  context: BrowserContext,
  page: Page,
  tenantSlug: string
): Promise<void> {
  const url = new URL(page.url());
  await context.addCookies([
    {
      name: "tenant",
      value: tenantSlug,
      domain: url.hostname,
      path: "/",
    },
  ]);
}
