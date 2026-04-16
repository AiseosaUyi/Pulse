"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

async function setTenantCookie(slug: string) {
  const cookieStore = await cookies();
  cookieStore.set("tenant", slug, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}

export async function signup(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const displayName = String(formData.get("displayName") ?? "").trim();
  const inviteToken = String(formData.get("invite") ?? "").trim() || null;
  const companyName = String(formData.get("companyName") ?? "").trim();
  const companySlug = String(formData.get("companySlug") ?? "").trim().toLowerCase();

  if (!email || !password || !displayName) {
    fail("/signup", "Email, password, and display name are required");
  }
  if (password.length < 8) {
    fail("/signup", "Password must be at least 8 characters");
  }

  const admin = createAdminClient();
  let tenantSlug: string;
  let role: "owner" | "admin" | "member" = "owner";

  // Validate flow inputs BEFORE creating the user to avoid orphan accounts.
  if (inviteToken) {
    const { data: invite } = await admin
      .from("invitations")
      .select("email, role, tenant_slug, expires_at, accepted_at")
      .eq("token", inviteToken)
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (!invite) fail("/signup", "Invite is invalid or expired");
    if (invite.email.toLowerCase() !== email) {
      fail("/signup", "Email must match the invited address");
    }
    tenantSlug = invite.tenant_slug;
    role = invite.role;
  } else {
    if (!companyName || !companySlug) {
      fail("/signup", "Company name and handle are required");
    }
    if (!/^[a-z0-9-]+$/.test(companySlug)) {
      fail("/signup", "Company handle may only contain lowercase letters, numbers, and hyphens");
    }
    const { data: existing } = await admin
      .from("tenants")
      .select("slug")
      .eq("slug", companySlug)
      .maybeSingle();
    if (existing) fail("/signup", "That company handle is already taken");
    tenantSlug = companySlug;
  }

  // Create the auth user.
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        username: email.split("@")[0],
        display_name: displayName,
      },
    },
  });

  if (authError) fail("/signup" + (inviteToken ? `?invite=${inviteToken}` : ""), authError.message);
  const userId = authData.user?.id;
  if (!userId) fail("/signup", "Sign-up failed");

  // Update profile with display name (trigger already inserted the row).
  await admin.from("profiles").upsert({
    id: userId,
    username: email.split("@")[0],
    display_name: displayName,
  });

  if (inviteToken) {
    await admin.from("memberships").insert({
      user_id: userId,
      tenant_slug: tenantSlug,
      role,
    });
    await admin
      .from("invitations")
      .update({ accepted_at: new Date().toISOString(), accepted_by: userId })
      .eq("token", inviteToken);
  } else {
    await admin.from("tenants").insert({
      slug: tenantSlug,
      name: companyName,
      created_by: userId,
    });
    await admin.from("memberships").insert({
      user_id: userId,
      tenant_slug: tenantSlug,
      role: "owner",
    });
  }

  await setTenantCookie(tenantSlug);

  // If Supabase has email confirmation enabled, session will be null here.
  if (!authData.session) {
    redirect("/login?verify=email");
  }

  redirect("/dashboard");
}

export async function completeCompany(formData: FormData) {
  const companyName = String(formData.get("companyName") ?? "").trim();
  const companySlug = String(formData.get("companySlug") ?? "").trim().toLowerCase();

  if (!companyName || !companySlug) {
    fail("/signup?step=company", "Both fields are required");
  }
  if (!/^[a-z0-9-]+$/.test(companySlug)) {
    fail("/signup?step=company", "Handle may only contain lowercase letters, numbers, and hyphens");
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("tenants")
    .select("slug")
    .eq("slug", companySlug)
    .maybeSingle();
  if (existing) fail("/signup?step=company", "That handle is taken");

  await admin.from("tenants").insert({
    slug: companySlug,
    name: companyName,
    created_by: user.id,
  });
  await admin.from("memberships").insert({
    user_id: user.id,
    tenant_slug: companySlug,
    role: "owner",
  });

  await setTenantCookie(companySlug);
  redirect("/dashboard");
}
