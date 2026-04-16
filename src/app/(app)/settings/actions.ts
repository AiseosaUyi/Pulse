"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentTenant } from "@/lib/auth";

function result(success: boolean, message: string) {
  return { success, message };
}

export async function updateProfile(formData: FormData) {
  const displayName = String(formData.get("displayName") ?? "").trim();
  const username = String(formData.get("username") ?? "").trim().toLowerCase();

  if (!displayName) return result(false, "Display name is required");
  if (!username || !/^[a-z0-9_-]{2,40}$/.test(username)) {
    return result(false, "Username must be 2-40 lowercase letters, numbers, _ or -");
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("profiles")
    .update({ display_name: displayName, username })
    .eq("id", user.id);

  if (error) return result(false, error.message);

  revalidatePath("/settings");
  return result(true, "Profile updated");
}

export async function changePassword(formData: FormData) {
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!currentPassword || !newPassword) return result(false, "Fill all fields");
  if (newPassword.length < 8) return result(false, "New password must be at least 8 characters");
  if (newPassword !== confirmPassword) return result(false, "New passwords don't match");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) redirect("/login");

  // Verify current password by re-signing-in.
  const { error: verifyErr } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (verifyErr) return result(false, "Current password is incorrect");

  const { error: updateErr } = await supabase.auth.updateUser({ password: newPassword });
  if (updateErr) return result(false, updateErr.message);

  return result(true, "Password updated");
}

export async function inviteTeammate(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "member");

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return result(false, "Enter a valid email");
  }
  if (!["owner", "admin", "member"].includes(role)) {
    return result(false, "Invalid role");
  }

  const tenant = await getCurrentTenant();
  if (!tenant) return result(false, "No active tenant");
  if (tenant.role !== "owner" && tenant.role !== "admin") {
    return result(false, "Only owners and admins can invite");
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.from("invitations").insert({
    email,
    tenant_slug: tenant.slug,
    role,
    invited_by: user.id,
  });

  if (error) return result(false, error.message);

  revalidatePath("/settings");
  return result(true, `Invite sent to ${email}`);
}

export async function revokeInvitation(formData: FormData) {
  const invitationId = String(formData.get("invitationId") ?? "");
  if (!invitationId) return result(false, "Missing invitation ID");

  const tenant = await getCurrentTenant();
  if (!tenant || (tenant.role !== "owner" && tenant.role !== "admin")) {
    return result(false, "Not authorized");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("invitations")
    .delete()
    .eq("id", invitationId)
    .eq("tenant_slug", tenant.slug);

  if (error) return result(false, error.message);

  revalidatePath("/settings");
  return result(true, "Invitation revoked");
}

export async function removeMember(formData: FormData) {
  const userId = String(formData.get("userId") ?? "");
  if (!userId) return result(false, "Missing user ID");

  const tenant = await getCurrentTenant();
  if (!tenant || tenant.role !== "owner") {
    return result(false, "Only owners can remove members");
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user?.id === userId) return result(false, "Use sign-out to leave your own account");

  const admin = createAdminClient();
  // Prevent removing the last owner.
  const { data: owners } = await admin
    .from("memberships")
    .select("user_id")
    .eq("tenant_slug", tenant.slug)
    .eq("role", "owner");
  if ((owners ?? []).length <= 1 && owners?.[0]?.user_id === userId) {
    return result(false, "Can't remove the last owner");
  }

  const { error } = await admin
    .from("memberships")
    .delete()
    .eq("tenant_slug", tenant.slug)
    .eq("user_id", userId);

  if (error) return result(false, error.message);

  revalidatePath("/settings");
  return result(true, "Member removed");
}
