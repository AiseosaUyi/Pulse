import { redirect } from "next/navigation";
import { Users, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, getCurrentTenant } from "@/lib/auth";
import { Avatar } from "@/components/ui/Avatar";
import { Input } from "@/components/ui/input";
import { SettingsForm } from "@/components/settings/SettingsForm";
import { InviteLink } from "@/components/settings/InviteLink";
import { inviteTeammate, revokeInvitation, removeMember } from "../actions";
import { SettingsPageHeading } from "../_shared";

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

async function loadTeam(
  tenantSlug: string
): Promise<{ members: Member[]; invites: PendingInvite[] }> {
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

export default async function TeamSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const tenant = await getCurrentTenant();
  if (!tenant) redirect("/signup?step=company");

  const { members, invites } = await loadTeam(tenant.slug);
  const canInvite = tenant.role === "owner" || tenant.role === "admin";

  return (
    <div>
      <SettingsPageHeading
        icon={Users}
        title="Team"
        subtitle={`Who can access ${tenant.name}. Owners can invite, remove, and change roles.`}
      />

      <section className="bg-card border border-border rounded-2xl p-6">
        <ul className="divide-y divide-white-200 mb-6">
          {members.map((m) => (
            <li key={m.userId} className="py-3 flex items-center gap-3">
              <Avatar url={m.avatarUrl} name={m.displayName} size="md" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-1200 dark:text-foreground truncate [font-family:'Satoshi-500',var(--font-sans)]">
                  {m.displayName}
                </p>
                {m.username && (
                  <p className="text-xs text-gray-1000 dark:text-text-muted truncate">
                    @{m.username}
                  </p>
                )}
              </div>
              <span className="text-xs text-gray-1000 dark:text-text-muted capitalize">
                {m.role}
              </span>
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
                  className="h-12 px-4 rounded-lg border border-white-200 bg-transparent text-sm text-gray-1200 dark:text-foreground outline-none focus-visible:border-blue-500 focus-visible:ring-1 focus-visible:ring-blue-500/30 cursor-pointer"
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
                        <p className="text-sm text-gray-1200 dark:text-foreground truncate">
                          {inv.email}
                        </p>
                        <div className="flex items-center gap-3 mt-0.5">
                          <span className="text-xs text-gray-1000 dark:text-text-muted capitalize">
                            {inv.role}
                          </span>
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
          <p className="text-xs text-gray-1000 dark:text-text-muted italic">
            Only owners and admins can invite teammates.
          </p>
        )}
      </section>
    </div>
  );
}
