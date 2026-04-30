"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function setTenantCookie(slug: string) {
  const cookieStore = await cookies();
  cookieStore.set("tenant", slug, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}

function tokenCandidates(raw: string): string[] {
  const out = new Set<string>([raw]);
  try {
    out.add(decodeURIComponent(raw));
  } catch {}
  return [...out];
}

export async function acceptInvite(formData: FormData) {
  const rawToken = String(formData.get("token") ?? "").trim();
  const displayName = String(formData.get("displayName") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  function fail(message: string): never {
    const path = rawToken ? `/invite/${encodeURIComponent(rawToken)}` : "/login";
    redirect(`${path}?error=${encodeURIComponent(message)}`);
  }

  if (!rawToken) redirect("/login?error=" + encodeURIComponent("Missing invite token"));
  if (!displayName) fail("Full name is required");
  if (password.length < 8) fail("Password must be at least 8 characters");

  const admin = createAdminClient();

  const candidates = tokenCandidates(rawToken);
  const { data: invite } = await admin
    .from("invitations")
    .select("token, email, role, tenant_slug")
    .in("token", candidates)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (!invite) fail("This invite is invalid or expired");
  const token = invite.token;

  const email = invite.email.toLowerCase();

  // Auto-confirm the email — receipt of the invite link proves ownership of the address.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      display_name: displayName,
      username: email.split("@")[0],
    },
  });

  let userId: string | null = created?.user?.id ?? null;

  if (createErr || !userId) {
    const message = createErr?.message?.toLowerCase() ?? "";
    const alreadyExists = message.includes("already") || message.includes("registered") || message.includes("exists");

    if (!alreadyExists) {
      fail(createErr?.message ?? "Could not create account");
    }

    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const existing = list?.users.find((u) => u.email?.toLowerCase() === email);
    if (!existing) {
      fail("An account with this email exists. Sign in, then reopen the invite link.");
    }

    userId = existing.id;
    await admin.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
      user_metadata: {
        ...(existing.user_metadata ?? {}),
        display_name: displayName,
      },
    });
  }

  await admin.from("profiles").upsert({
    id: userId,
    username: email.split("@")[0],
    display_name: displayName,
  });

  const { data: existingMembership } = await admin
    .from("memberships")
    .select("user_id")
    .eq("user_id", userId)
    .eq("tenant_slug", invite.tenant_slug)
    .maybeSingle();

  if (!existingMembership) {
    await admin.from("memberships").insert({
      user_id: userId,
      tenant_slug: invite.tenant_slug,
      role: invite.role,
    });
  }

  await admin
    .from("invitations")
    .update({ accepted_at: new Date().toISOString(), accepted_by: userId })
    .eq("token", token);

  const supabase = await createClient();
  // Clear any pre-existing session (e.g. the inviter testing their own invite)
  // so the chunked auth cookies are wiped before the invitee's session is
  // written. scope:'local' only touches this browser.
  await supabase.auth.signOut({ scope: "local" });

  const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
  if (signInErr) {
    fail(`Account ready but sign-in failed: ${signInErr.message}. Try the login page.`);
  }

  await setTenantCookie(invite.tenant_slug);
  redirect("/dashboard");
}
