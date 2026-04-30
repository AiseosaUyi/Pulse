"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { randomInt, createHash, randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendBrevoEmail, buildPasswordOtpEmail } from "@/lib/integrations/brevo";

const OTP_TTL_MINUTES = 10;
const RESET_TOKEN_TTL_MINUTES = 15;
const MAX_OTP_ATTEMPTS = 5;
const RESET_COOKIE = "pwreset";

function hashOtp(otp: string): string {
  return createHash("sha256").update(otp).digest("hex");
}

function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function buildUrl(path: string, params: Record<string, string>): string {
  const [base, existing = ""] = path.split("?");
  const search = new URLSearchParams(existing);
  for (const [k, v] of Object.entries(params)) search.set(k, v);
  const qs = search.toString();
  return qs ? `${base}?${qs}` : base;
}

function failTo(path: string, message: string): never {
  redirect(buildUrl(path, { error: message }));
}

function verifyUrl(email: string, extra: Record<string, string> = {}): string {
  return buildUrl("/forgot-password/verify", { email, ...extra });
}

// ──────────────────────────────────────────────────────────────────────
// Step 1: request OTP (also handles "resend" from the verify page)
// ──────────────────────────────────────────────────────────────────────
export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const fromVerify = String(formData.get("from") ?? "") === "verify";

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    failTo("/forgot-password", "Enter a valid email.");
  }

  const admin = createAdminClient();

  // Look the user up. We always show the same success state regardless
  // (don't leak which emails are registered), but we only actually send
  // the email + write a row when the user exists.
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const user = list?.users.find((u) => u.email?.toLowerCase() === email);

  if (user) {
    // Invalidate any prior unused OTPs for this email so a stale code
    // can't compete with the fresh one.
    await admin
      .from("password_reset_otps")
      .update({ used_at: new Date().toISOString() })
      .ilike("email", email)
      .is("used_at", null);

    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000).toISOString();

    await admin.from("password_reset_otps").insert({
      email,
      otp_hash: hashOtp(otp),
      expires_at: expiresAt,
    });

    const { subject, html, text } = buildPasswordOtpEmail({
      to: email,
      otp,
      expiresInMinutes: OTP_TTL_MINUTES,
    });
    await sendBrevoEmail({
      to: { email },
      subject,
      htmlContent: html,
      textContent: text,
      tags: ["password-reset"],
    });
  }

  redirect(verifyUrl(email, fromVerify ? { resent: "1" } : {}));
}

// ──────────────────────────────────────────────────────────────────────
// Step 2: verify OTP
// ──────────────────────────────────────────────────────────────────────
export async function verifyPasswordOtp(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const otp = String(formData.get("otp") ?? "").replace(/\s+/g, "");

  if (!email) failTo("/forgot-password", "Missing email.");
  if (!/^\d{6}$/.test(otp)) {
    failTo(verifyUrl(email), "Enter all 6 digits.");
  }

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("password_reset_otps")
    .select("id, otp_hash, attempts, expires_at, used_at")
    .ilike("email", email)
    .is("used_at", null)
    .not("otp_hash", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row) {
    failTo(verifyUrl(email), "That code expired. Tap resend to get a fresh one.");
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await admin.from("password_reset_otps").update({ used_at: new Date().toISOString() }).eq("id", row.id);
    failTo(verifyUrl(email), "That code expired. Tap resend to get a fresh one.");
  }

  if (hashOtp(otp) !== row.otp_hash) {
    const attempts = (row.attempts ?? 0) + 1;
    if (attempts >= MAX_OTP_ATTEMPTS) {
      await admin.from("password_reset_otps").update({ used_at: new Date().toISOString() }).eq("id", row.id);
      failTo("/forgot-password", "Too many tries. Start over to get a fresh code.");
    }
    await admin.from("password_reset_otps").update({ attempts }).eq("id", row.id);
    const remaining = MAX_OTP_ATTEMPTS - attempts;
    const tries = remaining === 1 ? "1 try" : `${remaining} tries`;
    failTo(verifyUrl(email), `That code didn't match. ${tries} left.`);
  }

  // OTP correct: mint a reset token and stash it on the row + an httpOnly cookie.
  const resetToken = randomBytes(32).toString("hex");
  const resetExpires = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000).toISOString();

  await admin
    .from("password_reset_otps")
    .update({
      otp_hash: null,
      reset_token: resetToken,
      expires_at: resetExpires,
    })
    .eq("id", row.id);

  const cookieStore = await cookies();
  cookieStore.set(RESET_COOKIE, resetToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: RESET_TOKEN_TTL_MINUTES * 60,
  });

  redirect("/forgot-password/reset");
}

// ──────────────────────────────────────────────────────────────────────
// Step 3: set new password
// ──────────────────────────────────────────────────────────────────────
export async function resetPassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8) failTo("/forgot-password/reset", "Password must be at least 8 characters.");
  if (password !== confirm) failTo("/forgot-password/reset", "Those passwords don't match.");

  const cookieStore = await cookies();
  const resetToken = cookieStore.get(RESET_COOKIE)?.value;
  if (!resetToken) failTo("/forgot-password", "Your reset session expired. Start over to get a fresh code.");

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("password_reset_otps")
    .select("id, email, expires_at, used_at")
    .eq("reset_token", resetToken)
    .is("used_at", null)
    .maybeSingle();

  if (!row) failTo("/forgot-password", "Your reset session expired. Start over to get a fresh code.");
  if (new Date(row.expires_at).getTime() < Date.now()) {
    failTo("/forgot-password", "Your reset session expired. Start over to get a fresh code.");
  }

  const email = row.email.toLowerCase();
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const user = list?.users.find((u) => u.email?.toLowerCase() === email);
  if (!user) failTo("/forgot-password", "Account not found.");

  // Update password.
  const { error: updateErr } = await admin.auth.admin.updateUserById(user.id, {
    password,
    email_confirm: true,
  });
  if (updateErr) failTo("/forgot-password/reset", updateErr.message);

  // Consume the reset row and clear the cookie.
  await admin
    .from("password_reset_otps")
    .update({ used_at: new Date().toISOString(), reset_token: null })
    .eq("id", row.id);
  cookieStore.delete(RESET_COOKIE);

  // Sign the user in on this browser. signOut first so any stale cookies
  // are wiped before the new session is written (same fix as the invite flow).
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
  if (signInErr) {
    failTo("/login", `Password updated. Sign in with your new password. ${signInErr.message}`);
  }

  // Make sure tenant cookie points at one of the user's tenants.
  const { data: memberships } = await supabase
    .from("memberships")
    .select("tenant_slug")
    .order("created_at", { ascending: true });
  const slugs = (memberships ?? []).map((m) => m.tenant_slug);
  if (slugs.length > 0) {
    const current = cookieStore.get("tenant")?.value;
    if (!current || !slugs.includes(current)) {
      cookieStore.set("tenant", slugs[0], {
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
        sameSite: "lax",
      });
    }
  }

  redirect("/dashboard");
}
