import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { Logo } from "@/components/ui/Logo";
import { AcceptInviteForm } from "./AcceptInviteForm";
import { Mail, Building2 } from "lucide-react";

interface InviteContext {
  email: string;
  tenantName: string;
  tenantSlug: string;
  role: string;
  inviterName: string | null;
}

async function loadInvite(token: string): Promise<InviteContext | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("invitations")
    .select("email, role, tenant_slug, invited_by, tenants(name)")
    .eq("token", token)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (!data) return null;

  let inviterName: string | null = null;
  if (data.invited_by) {
    const { data: prof } = await admin
      .from("profiles")
      .select("display_name, username")
      .eq("id", data.invited_by)
      .maybeSingle();
    inviterName = prof?.display_name || prof?.username || null;
  }

  const tenant = Array.isArray(data.tenants) ? data.tenants[0] : data.tenants;
  return {
    email: data.email,
    tenantName: tenant?.name ?? data.tenant_slug,
    tenantSlug: data.tenant_slug,
    role: data.role,
    inviterName,
  };
}

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  const invite = await loadInvite(token);

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-white-50 dark:bg-background">
      <div className="w-full max-w-md">
        <div className="mb-10 text-center">
          <Logo size="lg" />
        </div>

        {!invite ? (
          <div className="bg-card border border-white-200 rounded-2xl p-8 text-center">
            <h2
              className="text-xl text-gray-1100 mb-2"
              style={{ fontFamily: "'Satoshi-900', var(--font-sans)" }}
            >
              Invitation not found
            </h2>
            <p className="text-sm text-gray-1000 mb-6">
              This invite link is invalid, has already been accepted, or has expired.
            </p>
            <Link
              href="/login"
              className="inline-block text-sm text-primary-500 hover:text-primary-600 [font-family:'Satoshi-500',var(--font-sans)]"
            >
              Go to sign in
            </Link>
          </div>
        ) : (
          <div className="bg-card border border-white-200 rounded-2xl overflow-hidden">
            <div className="h-1.5 bg-gradient-to-r from-primary-600 to-primary-500" />
            <div className="p-8">
              <p className="text-xs font-semibold tracking-wide uppercase text-primary-500 mb-2">
                You&apos;re invited
              </p>
              <h2
                className="text-2xl text-gray-1100 mb-2"
                style={{ fontFamily: "'Satoshi-900', var(--font-sans)" }}
              >
                Join {invite.tenantName}
              </h2>
              <p className="text-sm text-gray-1000 mb-6">
                {invite.inviterName ? (
                  <>
                    <span className="text-gray-1100 [font-family:'Satoshi-500',var(--font-sans)]">
                      {invite.inviterName}
                    </span>{" "}
                    invited you as a{" "}
                  </>
                ) : (
                  <>You&apos;ve been invited as a </>
                )}
                <span className="text-gray-1100 [font-family:'Satoshi-500',var(--font-sans)]">
                  {invite.role}
                </span>
                . Set your name and password below to get started.
              </p>

              <div className="mb-6 space-y-2.5 p-4 rounded-xl bg-white-100 dark:bg-white-50 border border-white-200">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary-50 flex items-center justify-center text-primary-500">
                    <Building2 size={16} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold tracking-wide uppercase text-gray-500">
                      Organization
                    </p>
                    <p className="text-sm text-gray-1100 truncate [font-family:'Satoshi-500',var(--font-sans)]">
                      {invite.tenantName}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary-50 flex items-center justify-center text-primary-500">
                    <Mail size={16} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold tracking-wide uppercase text-gray-500">
                      Email
                    </p>
                    <p className="text-sm text-gray-1100 truncate [font-family:'Satoshi-500',var(--font-sans)]">
                      {invite.email}
                    </p>
                  </div>
                </div>
              </div>

              {error && (
                <div className="mb-4 p-3 rounded-lg bg-primary-50 border border-primary-500/20 text-sm text-primary-500">
                  {decodeURIComponent(error)}
                </div>
              )}

              <AcceptInviteForm token={token} email={invite.email} />

              <p className="mt-6 text-sm text-gray-1000 text-center">
                Already have an account?{" "}
                <Link
                  href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}
                  className="text-primary-500 hover:text-primary-600 [font-family:'Satoshi-500',var(--font-sans)]"
                >
                  Sign in
                </Link>
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
