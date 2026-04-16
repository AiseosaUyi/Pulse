import { redirect } from "next/navigation";
import { UserCircle, Users, Lock, Bell, Mail, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, getCurrentTenant } from "@/lib/auth";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { SettingsForm } from "@/components/settings/SettingsForm";
import { InviteLink } from "@/components/settings/InviteLink";
import {
  updateProfile,
  changePassword,
  inviteTeammate,
  revokeInvitation,
  removeMember,
} from "./actions";

interface Member {
  userId: string;
  role: "owner" | "admin" | "member";
  displayName: string;
  username: string;
  joinedAt: string;
}

interface PendingInvite {
  id: string;
  email: string;
  role: string;
  token: string;
  expiresAt: string;
  createdAt: string;
}

async function loadTeam(tenantSlug: string): Promise<{ members: Member[]; invites: PendingInvite[] }> {
  const supabase = await createClient();

  const { data: memberships } = await supabase
    .from("memberships")
    .select("user_id, role, created_at")
    .eq("tenant_slug", tenantSlug)
    .order("created_at", { ascending: true });

  const userIds = (memberships ?? []).map((m) => m.user_id);
  const profileMap = new Map<string, { display_name: string | null; username: string | null }>();

  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name, username")
      .in("id", userIds);
    for (const p of profiles ?? []) {
      profileMap.set(p.id, { display_name: p.display_name, username: p.username });
    }
  }

  const members: Member[] = (memberships ?? []).map((m) => {
    const profile = profileMap.get(m.user_id);
    return {
      userId: m.user_id,
      role: m.role,
      displayName: profile?.display_name ?? "—",
      username: profile?.username ?? "",
      joinedAt: m.created_at,
    };
  });

  const { data: invData } = await supabase
    .from("invitations")
    .select("id, email, role, token, expires_at, created_at")
    .eq("tenant_slug", tenantSlug)
    .is("accepted_at", null)
    .order("created_at", { ascending: false });

  const invites: PendingInvite[] = (invData ?? []).map((i) => ({
    id: i.id,
    email: i.email,
    role: i.role,
    token: i.token,
    expiresAt: i.expires_at,
    createdAt: i.created_at,
  }));

  return { members, invites };
}

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const tenant = await getCurrentTenant();
  if (!tenant) redirect("/signup?step=company");

  const { members, invites } = await loadTeam(tenant.slug);
  const canInvite = tenant.role === "owner" || tenant.role === "admin";

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-8 py-8 md:py-12 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-text-muted mt-1">
          Manage your profile, team, and security for <span className="text-white">{tenant.name}</span>.
        </p>
      </header>

      {/* Profile */}
      <section className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <UserCircle size={18} className="text-text-muted" />
          <h2 className="text-sm font-semibold uppercase tracking-wide">Profile</h2>
        </div>

        <div className="mb-5 pb-5 border-b border-border flex items-center gap-4">
          <div className="w-14 h-14 rounded-full gradient-purple-pink flex items-center justify-center text-lg font-bold text-white">
            {(user.displayName ?? user.email).charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{user.displayName ?? user.email}</p>
            <p className="text-xs text-text-muted truncate flex items-center gap-1">
              <Mail size={12} />
              {user.email}
            </p>
          </div>
          <span className="text-xs text-text-muted italic">Avatar upload — coming soon</span>
        </div>

        <SettingsForm action={updateProfile} submitLabel="Save profile" className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5 uppercase tracking-wide">
              Display name
            </label>
            <input
              type="text"
              name="displayName"
              defaultValue={user.displayName ?? ""}
              required
              className="w-full px-3 py-2.5 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-accent-purple"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5 uppercase tracking-wide">
              Username
            </label>
            <input
              type="text"
              name="username"
              defaultValue={user.username ?? ""}
              pattern="[a-z0-9_-]{2,40}"
              required
              className="w-full px-3 py-2.5 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-accent-purple"
            />
          </div>
        </SettingsForm>
      </section>

      {/* Team */}
      <section className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <Users size={18} className="text-text-muted" />
          <h2 className="text-sm font-semibold uppercase tracking-wide">Team</h2>
        </div>

        <ul className="divide-y divide-border mb-6">
          {members.map((m) => (
            <li key={m.userId} className="py-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-background border border-border flex items-center justify-center text-sm font-semibold">
                {m.displayName.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{m.displayName}</p>
                {m.username && <p className="text-xs text-text-muted truncate">@{m.username}</p>}
              </div>
              <span className="text-xs text-text-muted capitalize">{m.role}</span>
              {tenant.role === "owner" && m.userId !== user.id && (
                <form
                  action={async (fd: FormData) => {
                    "use server";
                    await removeMember(fd);
                  }}
                >
                  <input type="hidden" name="userId" value={m.userId} />
                  <button
                    type="submit"
                    aria-label={`Remove ${m.displayName}`}
                    className="p-1.5 rounded-lg hover:bg-card-hover text-text-muted hover:text-red-400 transition-colors cursor-pointer"
                  >
                    <Trash2 size={14} />
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>

        {canInvite ? (
          <>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-3">
              Invite teammate
            </h3>
            <SettingsForm
              action={inviteTeammate}
              submitLabel="Send invite"
              resetOnSuccess
              className="space-y-3"
            >
              <div className="flex gap-2">
                <input
                  type="email"
                  name="email"
                  required
                  placeholder="teammate@example.com"
                  className="flex-1 px-3 py-2.5 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-accent-purple"
                />
                <select
                  name="role"
                  defaultValue="member"
                  className="px-3 py-2.5 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-accent-purple cursor-pointer"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                  {tenant.role === "owner" && <option value="owner">Owner</option>}
                </select>
              </div>
            </SettingsForm>

            {invites.length > 0 && (
              <div className="mt-6">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-3">
                  Pending invites
                </h3>
                <ul className="divide-y divide-border">
                  {invites.map((inv) => (
                    <li key={inv.id} className="py-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{inv.email}</p>
                        <div className="flex items-center gap-3 mt-0.5">
                          <span className="text-xs text-text-muted capitalize">{inv.role}</span>
                          <InviteLink token={inv.token} />
                        </div>
                      </div>
                      <form
                        action={async (fd: FormData) => {
                          "use server";
                          await revokeInvitation(fd);
                        }}
                      >
                        <input type="hidden" name="invitationId" value={inv.id} />
                        <button
                          type="submit"
                          aria-label={`Revoke invite to ${inv.email}`}
                          className="p-1.5 rounded-lg hover:bg-card-hover text-text-muted hover:text-red-400 transition-colors cursor-pointer"
                        >
                          <Trash2 size={14} />
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          <p className="text-xs text-text-muted italic">Only owners and admins can invite teammates.</p>
        )}
      </section>

      {/* Security */}
      <section className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <Lock size={18} className="text-text-muted" />
          <h2 className="text-sm font-semibold uppercase tracking-wide">Security</h2>
        </div>

        <SettingsForm
          action={changePassword}
          submitLabel="Change password"
          resetOnSuccess
          className="space-y-4"
        >
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5 uppercase tracking-wide">
              Current password
            </label>
            <PasswordInput name="currentPassword" required autoComplete="current-password" />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5 uppercase tracking-wide">
              New password
            </label>
            <PasswordInput name="newPassword" required minLength={8} autoComplete="new-password" />
            <p className="mt-1 text-xs text-text-muted">8 characters minimum.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5 uppercase tracking-wide">
              Confirm new password
            </label>
            <PasswordInput name="confirmPassword" required minLength={8} autoComplete="new-password" />
          </div>
        </SettingsForm>
      </section>

      {/* Notifications */}
      <section className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <Bell size={18} className="text-text-muted" />
          <h2 className="text-sm font-semibold uppercase tracking-wide">Email notifications</h2>
        </div>
        <div className="space-y-3 opacity-60 pointer-events-none">
          {[
            { id: "weekly", label: "Weekly report", desc: "Monday morning digest of the week's metrics." },
            { id: "morning", label: "Morning intel brief", desc: "Top competitor moves from overnight, delivered at 7am." },
            { id: "anomalies", label: "Anomaly alerts", desc: "Real-time alerts when competitors go viral or shift strategy." },
            { id: "mentions", label: "@mentions & replies", desc: "When someone engages with your content across platforms." },
          ].map((pref) => (
            <label key={pref.id} className="flex items-start gap-3 p-3 rounded-lg bg-background border border-border">
              <input
                type="checkbox"
                defaultChecked
                disabled
                className="mt-0.5 h-4 w-4 rounded border-border"
              />
              <div>
                <p className="text-sm font-medium">{pref.label}</p>
                <p className="text-xs text-text-muted mt-0.5">{pref.desc}</p>
              </div>
            </label>
          ))}
        </div>
        <p className="text-xs text-text-muted italic mt-3">
          Notification preferences — coming with the cron + Resend integration.
        </p>
      </section>
    </div>
  );
}
