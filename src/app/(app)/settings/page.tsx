import { redirect } from "next/navigation";
import Link from "next/link";
import { UserCircle, Users, Lock, Bell, Mail, Trash2, Palette, Sparkles, ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, getCurrentTenant } from "@/lib/auth";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsForm } from "@/components/settings/SettingsForm";
import { InviteLink } from "@/components/settings/InviteLink";
import { AvatarUpload } from "@/components/settings/AvatarUpload";
import { ThemeSwitcher } from "@/components/theme/ThemeSwitcher";
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
  avatarUrl: string | null;
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
  const profileMap = new Map<
    string,
    { display_name: string | null; username: string | null; avatar_url: string | null }
  >();

  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name, username, avatar_url")
      .in("id", userIds);
    for (const p of profiles ?? []) {
      profileMap.set(p.id, {
        display_name: p.display_name,
        username: p.username,
        avatar_url: p.avatar_url,
      });
    }
  }

  const members: Member[] = (memberships ?? []).map((m) => {
    const profile = profileMap.get(m.user_id);
    return {
      userId: m.user_id,
      role: m.role,
      displayName: profile?.display_name ?? "—",
      username: profile?.username ?? "",
      avatarUrl: profile?.avatar_url ?? null,
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

function SectionHeading({ icon: Icon, title }: { icon: typeof UserCircle; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-5">
      <Icon size={16} className="text-gray-500" />
      <h2
        className="text-xs uppercase tracking-[0.14em] text-gray-500"
        style={{ fontFamily: "'Satoshi-700', var(--font-sans)" }}
      >
        {title}
      </h2>
    </div>
  );
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
        <h1
          className="text-2_5xl text-gray-1100 tracking-tight"
          style={{ fontFamily: "'Satoshi-900', var(--font-sans)" }}
        >
          Settings
        </h1>
        <p className="text-sm text-gray-1000 mt-2">
          Manage your profile, team, and security for{" "}
          <span className="text-gray-1200 [font-family:'Satoshi-500',var(--font-sans)]">
            {tenant.name}
          </span>
          .
        </p>
      </header>

      {/* Profile */}
      <section className="bg-card border border-border rounded-2xl p-6">
        <SectionHeading icon={UserCircle} title="Profile" />

        <div className="mb-6 pb-6 border-b border-white-200 space-y-4">
          <AvatarUpload
            userId={user.id}
            currentUrl={user.avatarUrl}
            displayName={user.displayName ?? user.email}
          />
          <p className="text-xs text-gray-1000 flex items-center gap-1.5">
            <Mail size={12} />
            {user.email}
          </p>
        </div>

        <SettingsForm action={updateProfile} submitLabel="Save profile" className="space-y-5">
          <div>
            <Label htmlFor="p-name">Display name</Label>
            <Input
              id="p-name"
              type="text"
              name="displayName"
              defaultValue={user.displayName ?? ""}
              required
              placeholder="Your full name"
            />
          </div>
          <div>
            <Label htmlFor="p-user">Username</Label>
            <Input
              id="p-user"
              type="text"
              name="username"
              defaultValue={user.username ?? ""}
              pattern="[a-z0-9_-]{2,40}"
              required
              placeholder="lowercase-handle"
            />
          </div>
        </SettingsForm>
      </section>

      {/* Team */}
      <section className="bg-card border border-border rounded-2xl p-6">
        <SectionHeading icon={Users} title="Team" />

        <ul className="divide-y divide-white-200 mb-6">
          {members.map((m) => (
            <li key={m.userId} className="py-3 flex items-center gap-3">
              <Avatar url={m.avatarUrl} name={m.displayName} size="md" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-1200 truncate [font-family:'Satoshi-500',var(--font-sans)]">
                  {m.displayName}
                </p>
                {m.username && <p className="text-xs text-gray-1000 truncate">@{m.username}</p>}
              </div>
              <span className="text-xs text-gray-1000 capitalize">{m.role}</span>
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
                    className="p-2 rounded-full text-gray-500 hover:text-error-500 hover:bg-gray-50 transition-colors cursor-pointer"
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
            <h3
              className="text-xs uppercase tracking-[0.14em] text-gray-500 mb-3"
              style={{ fontFamily: "'Satoshi-700', var(--font-sans)" }}
            >
              Invite teammate
            </h3>
            <SettingsForm
              action={inviteTeammate}
              submitLabel="Send invite"
              resetOnSuccess
              className="space-y-0"
            >
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  type="email"
                  name="email"
                  required
                  placeholder="teammate@example.com"
                  className="flex-1"
                />
                <select
                  name="role"
                  defaultValue="member"
                  className="h-12 px-4 rounded-lg border border-white-200 bg-transparent text-sm text-gray-1200 outline-none focus-visible:border-blue-500 focus-visible:ring-1 focus-visible:ring-blue-500/30 cursor-pointer"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                  {tenant.role === "owner" && <option value="owner">Owner</option>}
                </select>
              </div>
            </SettingsForm>

            {invites.length > 0 && (
              <div className="mt-8">
                <h3
                  className="text-xs uppercase tracking-[0.14em] text-gray-500 mb-3"
                  style={{ fontFamily: "'Satoshi-700', var(--font-sans)" }}
                >
                  Pending invites
                </h3>
                <ul className="divide-y divide-white-200">
                  {invites.map((inv) => (
                    <li key={inv.id} className="py-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-1200 truncate">{inv.email}</p>
                        <div className="flex items-center gap-3 mt-0.5">
                          <span className="text-xs text-gray-1000 capitalize">{inv.role}</span>
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
                          className="p-2 rounded-full text-gray-500 hover:text-error-500 hover:bg-gray-50 transition-colors cursor-pointer"
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
          <p className="text-xs text-gray-1000 italic">Only owners and admins can invite teammates.</p>
        )}
      </section>

      {/* Brand voice */}
      <section className="bg-card border border-border rounded-2xl p-6">
        <SectionHeading icon={Sparkles} title="Brand voice" />
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <p
              className="text-sm text-gray-1200 dark:text-foreground"
              style={{ fontFamily: "'Satoshi-500', var(--font-sans)" }}
            >
              How the AI sounds when it writes for {tenant.name}
            </p>
            <p className="text-xs text-gray-1000 dark:text-text-muted mt-1">
              Tone, audience, do&apos;s and don&apos;ts, and example posts.
              Grounds every generated content brief.
            </p>
          </div>
          <Link
            href="/settings/brand-voice"
            className="inline-flex items-center gap-1.5 text-sm text-primary-500 hover:text-primary-600 whitespace-nowrap shrink-0"
          >
            Edit
            <ArrowRight size={14} />
          </Link>
        </div>
      </section>

      {/* Appearance */}
      <section className="bg-card border border-border rounded-2xl p-6">
        <SectionHeading icon={Palette} title="Appearance" />
        <div className="flex items-start justify-between gap-6">
          <div>
            <p
              className="text-sm text-gray-1200 dark:text-foreground"
              style={{ fontFamily: "'Satoshi-500', var(--font-sans)" }}
            >
              Theme
            </p>
            <p className="text-xs text-gray-1000 dark:text-text-muted mt-1">
              Choose how PULSE looks. Applies only to this device.
            </p>
          </div>
          <ThemeSwitcher />
        </div>
      </section>

      {/* Security */}
      <section className="bg-card border border-border rounded-2xl p-6">
        <SectionHeading icon={Lock} title="Security" />

        <SettingsForm
          action={changePassword}
          submitLabel="Change password"
          resetOnSuccess
          className="space-y-5"
        >
          <div>
            <Label htmlFor="s-current">Current password</Label>
            <PasswordInput
              name="currentPassword"
              required
              autoComplete="current-password"
              placeholder="Your current password"
            />
          </div>
          <div>
            <Label htmlFor="s-new">New password</Label>
            <PasswordInput
              name="newPassword"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="At least 8 characters"
            />
            <p className="mt-1 text-xs text-gray-500">8 characters minimum.</p>
          </div>
          <div>
            <Label htmlFor="s-confirm">Confirm new password</Label>
            <PasswordInput
              name="confirmPassword"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="Repeat new password"
            />
          </div>
        </SettingsForm>
      </section>

      {/* Notifications */}
      <section className="bg-card border border-border rounded-2xl p-6">
        <SectionHeading icon={Bell} title="Email notifications" />
        <div className="space-y-3 opacity-60 pointer-events-none">
          {[
            { id: "weekly", label: "Weekly report", desc: "Monday morning digest of the week's metrics." },
            { id: "morning", label: "Morning intel brief", desc: "Top competitor moves from overnight, delivered at 7am." },
            { id: "anomalies", label: "Anomaly alerts", desc: "Real-time alerts when competitors go viral or shift strategy." },
            { id: "mentions", label: "@mentions & replies", desc: "When someone engages with your content across platforms." },
          ].map((pref) => (
            <label
              key={pref.id}
              className="flex items-start gap-3 p-3 rounded-lg bg-white-50 border border-white-200"
            >
              <input
                type="checkbox"
                defaultChecked
                disabled
                className="mt-0.5 h-4 w-4 rounded border-white-200 accent-primary-500"
              />
              <div>
                <p className="text-sm text-gray-1200 [font-family:'Satoshi-500',var(--font-sans)]">
                  {pref.label}
                </p>
                <p className="text-xs text-gray-1000 mt-0.5">{pref.desc}</p>
              </div>
            </label>
          ))}
        </div>
        <p className="text-xs text-gray-500 italic mt-3">
          Notification preferences — coming with the Resend + cron integration.
        </p>
      </section>
    </div>
  );
}
