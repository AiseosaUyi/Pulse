import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { signup, completeCompany } from "./actions";

interface InviteContext {
  email: string;
  tenantName: string;
  role: string;
}

async function loadInvite(token: string): Promise<InviteContext | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("invitations")
    .select("email, role, tenant_slug, tenants(name)")
    .eq("token", token)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .single();

  if (!data) return null;
  const tenant = Array.isArray(data.tenants) ? data.tenants[0] : data.tenants;
  return {
    email: data.email,
    tenantName: tenant?.name ?? data.tenant_slug,
    role: data.role,
  };
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string; step?: string; error?: string }>;
}) {
  const params = await searchParams;
  const invite = params.invite ? await loadInvite(params.invite) : null;
  const isInvalidInvite = params.invite && !invite;
  const isCompanyStep = params.step === "company";

  if (isCompanyStep) {
    return (
      <div className="bg-card border border-border rounded-2xl p-8">
        <h2 className="text-xl font-bold mb-1">Create a company</h2>
        <p className="text-sm text-text-muted mb-6">
          Your account exists but isn&apos;t attached to a company yet.
        </p>

        {params.error && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-300">
            {decodeURIComponent(params.error)}
          </div>
        )}

        <form action={completeCompany} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5 uppercase tracking-wide">
              Company name
            </label>
            <input
              type="text"
              name="companyName"
              required
              className="w-full px-3 py-2.5 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-accent-purple"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5 uppercase tracking-wide">
              Company handle (used in URLs)
            </label>
            <input
              type="text"
              name="companySlug"
              required
              pattern="[a-z0-9-]+"
              placeholder="acme-co"
              className="w-full px-3 py-2.5 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-accent-purple"
            />
            <p className="mt-1 text-xs text-text-muted">Lowercase letters, numbers, and hyphens only.</p>
          </div>
          <button
            type="submit"
            className="w-full py-2.5 rounded-lg text-sm font-semibold text-white gradient-purple-pink hover:opacity-90 transition-opacity"
          >
            Create company
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-2xl p-8">
      <h2 className="text-xl font-bold mb-1">
        {invite ? `Join ${invite.tenantName}` : "Create account"}
      </h2>
      <p className="text-sm text-text-muted mb-6">
        {invite
          ? `You were invited as a ${invite.role}. Create your account to join.`
          : "Start your marketing OS."}
      </p>

      {isInvalidInvite && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-300">
          This invite link is invalid or expired.
        </div>
      )}
      {params.error && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-300">
          {decodeURIComponent(params.error)}
        </div>
      )}

      <form action={signup} className="space-y-4">
        {params.invite && <input type="hidden" name="invite" value={params.invite} />}
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1.5 uppercase tracking-wide">
            Email
          </label>
          <input
            type="email"
            name="email"
            required
            defaultValue={invite?.email ?? ""}
            readOnly={Boolean(invite)}
            autoComplete="email"
            className="w-full px-3 py-2.5 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-accent-purple read-only:opacity-70"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1.5 uppercase tracking-wide">
            Password
          </label>
          <input
            type="password"
            name="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="w-full px-3 py-2.5 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-accent-purple"
          />
          <p className="mt-1 text-xs text-text-muted">8 characters minimum.</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1.5 uppercase tracking-wide">
            Display name
          </label>
          <input
            type="text"
            name="displayName"
            required
            className="w-full px-3 py-2.5 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-accent-purple"
          />
        </div>

        {!invite && (
          <>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1.5 uppercase tracking-wide">
                Company name
              </label>
              <input
                type="text"
                name="companyName"
                required
                className="w-full px-3 py-2.5 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-accent-purple"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1.5 uppercase tracking-wide">
                Company handle
              </label>
              <input
                type="text"
                name="companySlug"
                required
                pattern="[a-z0-9-]+"
                placeholder="acme-co"
                className="w-full px-3 py-2.5 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-accent-purple"
              />
              <p className="mt-1 text-xs text-text-muted">Lowercase letters, numbers, and hyphens.</p>
            </div>
          </>
        )}

        <button
          type="submit"
          className="w-full py-2.5 rounded-lg text-sm font-semibold text-white gradient-purple-pink hover:opacity-90 transition-opacity"
        >
          {invite ? "Join company" : "Create account"}
        </button>
      </form>

      <p className="mt-6 text-sm text-text-muted text-center">
        Already have an account?{" "}
        <Link href="/login" className="text-accent-purple hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
