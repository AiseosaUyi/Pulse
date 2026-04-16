import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
      <div className="bg-white border border-white-200 rounded-2xl p-8">
        <h2
          className="text-xl text-gray-1100 mb-1"
          style={{ fontFamily: "'Satoshi-900', var(--font-sans)" }}
        >
          Create a company
        </h2>
        <p className="text-sm text-gray-1000 mb-6">
          Your account isn&apos;t attached to a company yet.
        </p>

        {params.error && (
          <div className="mb-4 p-3 rounded-lg bg-primary-50 border border-primary-500/20 text-sm text-primary-500">
            {decodeURIComponent(params.error)}
          </div>
        )}

        <form action={completeCompany} className="space-y-5">
          <div>
            <Label htmlFor="sc-name">Company name</Label>
            <Input id="sc-name" type="text" name="companyName" required placeholder="Acme Co." />
          </div>
          <div>
            <Label htmlFor="sc-slug">Company handle</Label>
            <Input
              id="sc-slug"
              type="text"
              name="companySlug"
              required
              pattern="[a-z0-9-]+"
              placeholder="acme-co"
            />
            <p className="mt-1 text-xs text-gray-500">Lowercase letters, numbers, and hyphens.</p>
          </div>
          <Button type="submit" size="xl" className="w-full">
            Create company
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="bg-white border border-white-200 rounded-2xl p-8">
      <h2
        className="text-xl text-gray-1100 mb-1"
        style={{ fontFamily: "'Satoshi-900', var(--font-sans)" }}
      >
        {invite ? `Join ${invite.tenantName}` : "Create account"}
      </h2>
      <p className="text-sm text-gray-1000 mb-6">
        {invite
          ? `You were invited as a ${invite.role}.`
          : "Start your marketing OS."}
      </p>

      {isInvalidInvite && (
        <div className="mb-4 p-3 rounded-lg bg-primary-50 border border-primary-500/20 text-sm text-primary-500">
          This invite link is invalid or expired.
        </div>
      )}
      {params.error && (
        <div className="mb-4 p-3 rounded-lg bg-primary-50 border border-primary-500/20 text-sm text-primary-500">
          {decodeURIComponent(params.error)}
        </div>
      )}

      <form action={signup} className="space-y-5">
        {params.invite && <input type="hidden" name="invite" value={params.invite} />}
        <div>
          <Label htmlFor="su-email">Email</Label>
          <Input
            id="su-email"
            type="email"
            name="email"
            required
            defaultValue={invite?.email ?? ""}
            readOnly={Boolean(invite)}
            autoComplete="email"
            placeholder="you@company.com"
            className={invite ? "opacity-70 cursor-not-allowed" : ""}
          />
        </div>
        <div>
          <Label htmlFor="su-password">Password</Label>
          <PasswordInput name="password" required minLength={8} autoComplete="new-password" placeholder="At least 8 characters" />
          <p className="mt-1 text-xs text-gray-500">8 characters minimum.</p>
        </div>
        <div>
          <Label htmlFor="su-display">Display name</Label>
          <Input id="su-display" type="text" name="displayName" required placeholder="Your full name" />
        </div>

        {!invite && (
          <>
            <div className="pt-2 border-t border-white-200" />
            <div>
              <Label htmlFor="su-cname">Company name</Label>
              <Input id="su-cname" type="text" name="companyName" required placeholder="Acme Co." />
            </div>
            <div>
              <Label htmlFor="su-cslug">Company handle</Label>
              <Input
                id="su-cslug"
                type="text"
                name="companySlug"
                required
                pattern="[a-z0-9-]+"
                placeholder="acme-co"
              />
              <p className="mt-1 text-xs text-gray-500">Lowercase letters, numbers, and hyphens.</p>
            </div>
          </>
        )}

        <Button type="submit" size="xl" className="w-full">
          {invite ? "Join company" : "Create account"}
        </Button>
      </form>

      <p className="mt-6 text-sm text-gray-1000 text-center">
        Already have an account?{" "}
        <Link href="/login" className="text-primary-500 hover:text-primary-600 [font-family:'Satoshi-500',var(--font-sans)]">
          Sign in
        </Link>
      </p>
    </div>
  );
}
