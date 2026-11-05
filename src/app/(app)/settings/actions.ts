"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentTenant, getCurrentUser } from "@/lib/auth";
import { sendBrevoEmail, buildInviteEmail, getAppBaseUrl } from "@/lib/integrations/brevo";

function result(success: boolean, message: string) {
  return { success, message };
}

export async function saveAvatarUrl(url: string | null) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("profiles")
    .update({ avatar_url: url })
    .eq("id", user.id);

  if (error) return result(false, error.message);

  revalidatePath("/settings");
  return result(true, url ? "Avatar updated" : "Avatar removed");
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

  const { data: invite, error } = await supabase
    .from("invitations")
    .insert({
      email,
      tenant_slug: tenant.slug,
      role,
      invited_by: user.id,
    })
    .select("token")
    .single();

  if (error || !invite) return result(false, error?.message ?? "Could not create invite");

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("display_name, username")
    .eq("id", user.id)
    .maybeSingle();
  const inviterName = profile?.display_name || profile?.username || user.email || "A teammate";

  const acceptUrl = `${getAppBaseUrl()}/invite/${encodeURIComponent(invite.token)}`;
  const { subject, html, text } = buildInviteEmail({
    to: email,
    tenantName: tenant.name,
    inviterName,
    role,
    acceptUrl,
  });

  const sendRes = await sendBrevoEmail({
    to: { email },
    subject,
    htmlContent: html,
    textContent: text,
    replyTo: user.email ? { email: user.email, name: inviterName } : undefined,
    tags: ["invitation", `tenant:${tenant.slug}`],
  });

  revalidatePath("/settings");
  if (!sendRes.ok) {
    return result(false, `Email failed (${sendRes.error}). Invite link: ${acceptUrl}`);
  }
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
  if (!user) return result(false, "Unauthorized");
  if (user.id === userId) return result(false, "Use sign-out to leave your own account");

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

  // Unassign open work for the departing team member
  const { data: person } = await admin
    .from("team_people")
    .select("id")
    .eq("tenant_slug", tenant.slug)
    .eq("user_id", userId)
    .maybeSingle();

  if (person) {
    const { unassignDepartedPerson } = await import("@/lib/services/tasks");
    await unassignDepartedPerson(admin, tenant.slug, person.id, user.id);
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

export async function saveTeamMember(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) return result(false, "Not authenticated");
  const tenant = await getCurrentTenant();
  if (!tenant) return result(false, "No active tenant");
  if (tenant.role !== "owner" && tenant.role !== "admin") {
    return result(false, "Only owners and admins can manage people");
  }

  const name = String(formData.get("name") ?? "").trim();
  const role = String(formData.get("role") ?? "").trim();
  const active = formData.get("active") !== "false";
  const eventsCreated = Number(formData.get("eventsCreated") ?? 0);
  const conversations = Number(formData.get("conversations") ?? 0);
  const reachOuts = Number(formData.get("reachOuts") ?? 0);
  const organicDms = Number(formData.get("organicDms") ?? 0);
  const tagsRaw = String(formData.get("tags") ?? "").trim();
  const tags = tagsRaw
    ? tagsRaw.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean)
    : undefined;
  const email = String(formData.get("email") ?? "").trim() || null;

  if (!name) return result(false, "Name is required");
  if (!role) return result(false, "Role is required");

  const admin = createAdminClient();
  const { upsertTeamMember } = await import("@/lib/services/team");
  const res = await upsertTeamMember(admin, tenant.slug, {
    name,
    role,
    roleTitle: role,
    tags,
    email,
    active,
    weeklyTargets: { eventsCreated, conversations, reachOuts, organicDms },
  });

  if (!res.ok) return result(false, res.error);

  revalidatePath("/settings/team");
  revalidatePath("/dashboard");
  return result(true, "Team member saved");
}

export async function updateTeamMemberTargetsAction(
  memberId: string,
  targets: import("@/lib/types/team").WeeklyTargets
) {
  const user = await getCurrentUser();
  if (!user) return result(false, "Not authenticated");
  const tenant = await getCurrentTenant();
  if (!tenant) return result(false, "No active tenant");
  if (tenant.role !== "owner" && tenant.role !== "admin") {
    return result(false, "Only owners and admins can manage people");
  }

  const admin = createAdminClient();
  const { updateTeamMember } = await import("@/lib/services/team");
  const res = await updateTeamMember(admin, tenant.slug, memberId, { weeklyTargets: targets });

  if (!res.ok) return result(false, res.error);

  revalidatePath("/settings/team");
  revalidatePath("/dashboard");
  return result(true, "Targets updated");
}

export async function toggleTeamMemberActiveAction(memberId: string, active: boolean) {
  const user = await getCurrentUser();
  if (!user) return result(false, "Not authenticated");
  const tenant = await getCurrentTenant();
  if (!tenant) return result(false, "No active tenant");
  if (tenant.role !== "owner" && tenant.role !== "admin") {
    return result(false, "Only owners and admins can manage people");
  }

  const admin = createAdminClient();
  const { updateTeamMember } = await import("@/lib/services/team");
  const res = await updateTeamMember(admin, tenant.slug, memberId, { active }, user.id);

  if (!res.ok) return result(false, res.error);

  revalidatePath("/settings/team");
  revalidatePath("/dashboard");
  return result(true, active ? "Activated" : "Deactivated");
}

export async function deleteTeamMemberAction(memberId: string) {
  const user = await getCurrentUser();
  if (!user) return result(false, "Not authenticated");
  const tenant = await getCurrentTenant();
  if (!tenant) return result(false, "No active tenant");
  if (tenant.role !== "owner" && tenant.role !== "admin") {
    return result(false, "Only owners and admins can manage people");
  }

  const admin = createAdminClient();
  const { deleteTeamMember } = await import("@/lib/services/team");
  const res = await deleteTeamMember(admin, tenant.slug, memberId, user.id);

  if (!res.ok) return result(false, res.error);

  revalidatePath("/settings/team");
  revalidatePath("/dashboard");
  return result(true, "Team member removed");
}

export async function linkPersonToUserAction(personId: string, userId: string | null) {
  const user = await getCurrentUser();
  if (!user) return result(false, "Not authenticated");
  const tenant = await getCurrentTenant();
  if (!tenant) return result(false, "No active tenant");
  if (tenant.role !== "owner" && tenant.role !== "admin") {
    return result(false, "Only owners and admins can link people to logins");
  }

  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();

  if (userId) {
    // Check if user is already linked to another person
    const { data: existing } = await admin
      .from("team_people")
      .select("id, name")
      .eq("tenant_slug", tenant.slug)
      .eq("user_id", userId)
      .neq("id", personId)
      .maybeSingle();

    if (existing) {
      return result(false, `This user is already linked to ${existing.name}`);
    }

    const { data: userData } = await admin.auth.admin.getUserById(userId);
    const userEmail = userData?.user?.email ?? null;

    const { error } = await admin
      .from("team_people")
      .update({
        user_id: userId,
        email: userEmail,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_slug", tenant.slug)
      .eq("id", personId);

    if (error) return result(false, error.message);
  } else {
    const { error } = await admin
      .from("team_people")
      .update({
        user_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_slug", tenant.slug)
      .eq("id", personId);

    if (error) return result(false, error.message);
  }

  revalidatePath("/settings/team");
  revalidatePath("/dashboard");
  return result(true, userId ? "Linked to login" : "Unlinked from login");
}
