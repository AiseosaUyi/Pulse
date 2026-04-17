import { test, expect } from "@playwright/test";

// Auth gate smoke: the proxy middleware should bounce any unauthed
// request to a protected page back to /login with ?next=<original path>.

test.describe("auth gate", () => {
  test("unauthed /dashboard redirects to /login with ?next set", async ({ page }) => {
    const res = await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    expect(res?.status()).toBeLessThan(400);
    await expect(page).toHaveURL(/\/login(\?|$)/);
    const url = new URL(page.url());
    expect(url.searchParams.get("next")).toBe("/dashboard");
  });

  test("unauthed deep route redirects too", async ({ page }) => {
    await page.goto("/seo-tracker/programmatic");
    await expect(page).toHaveURL(/\/login(\?|$)/);
    const url = new URL(page.url());
    expect(url.searchParams.get("next")).toBe("/seo-tracker/programmatic");
  });

  test("/login renders the login form", async ({ page }) => {
    await page.goto("/login");
    await expect(
      page.getByRole("button", { name: /sign in|log in/i }).first()
    ).toBeVisible();
  });

  test("/signup renders the signup form", async ({ page }) => {
    await page.goto("/signup");
    await expect(
      page.getByRole("button", { name: /sign up|create account/i }).first()
    ).toBeVisible();
  });
});
