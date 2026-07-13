"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { approveAuthorization, denyAuthorization } from "./actions";

interface EligibleTenant {
  slug: string;
  name: string;
  role: string;
}

interface Props {
  clientName: string;
  userEmail: string;
  eligibleTenants: EligibleTenant[];
  clientId: string;
  redirectUri: string;
  scope: string;
  state?: string;
  codeChallenge: string;
  codeChallengeMethod: string;
}

export function AuthorizeConsent({
  clientName,
  userEmail,
  eligibleTenants,
  clientId,
  redirectUri,
  scope,
  state,
  codeChallenge,
  codeChallengeMethod,
}: Props) {
  const [tenantSlug, setTenantSlug] = useState(eligibleTenants[0]?.slug ?? "");

  const hiddenFields = (
    <>
      <input type="hidden" name="client_id" value={clientId} />
      <input type="hidden" name="redirect_uri" value={redirectUri} />
      <input type="hidden" name="scope" value={scope} />
      {state && <input type="hidden" name="state" value={state} />}
      <input type="hidden" name="code_challenge" value={codeChallenge} />
      <input type="hidden" name="code_challenge_method" value={codeChallengeMethod} />
      <input type="hidden" name="tenant_slug" value={tenantSlug} />
    </>
  );

  if (eligibleTenants.length === 0) {
    return (
      <div className="flex flex-col items-center text-center gap-4 pt-10">
        <h1 className="text-lg text-gray-1100 [font-family:'Satoshi-700',var(--font-sans)]">
          Nothing to connect
        </h1>
        <p className="text-sm text-gray-1000 max-w-sm">
          {clientName} needs owner or admin access to a Pulse workspace. {userEmail} isn&apos;t an
          owner or admin of any workspace yet.
        </p>
      </div>
    );
  }

  return (
    <div className="pt-6">
      <h1 className="text-lg text-gray-1100 mb-1 [font-family:'Satoshi-700',var(--font-sans)]">
        Connect {clientName}
      </h1>
      <p className="text-sm text-gray-1000 mb-6">
        Signed in as {userEmail}. Choose which workspace to connect.
      </p>

      <Card className="mb-6">
        <CardContent className="p-4 divide-y divide-border/60">
          {eligibleTenants.map((t) => (
            <label
              key={t.slug}
              className="flex items-center justify-between py-3 first:pt-0 last:pb-0 cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <input
                  type="radio"
                  name="tenant_picker"
                  checked={tenantSlug === t.slug}
                  onChange={() => setTenantSlug(t.slug)}
                  className="accent-primary-500"
                />
                <span className="text-sm text-gray-1200">{t.name}</span>
              </div>
              <span className="text-[11px] text-gray-1000 capitalize">{t.role}</span>
            </label>
          ))}
        </CardContent>
      </Card>

      <p className="text-xs text-gray-1000 mb-6">
        This grants {clientName} the ability to read and manage data in the selected workspace
        through Pulse&apos;s API, on your behalf, until you revoke access.
      </p>

      <div className="flex items-center gap-3">
        <form action={denyAuthorization}>
          {hiddenFields}
          <Button type="submit" variant="tertiary">
            Deny
          </Button>
        </form>
        <form action={approveAuthorization}>
          {hiddenFields}
          <Button type="submit">Authorize</Button>
        </form>
      </div>
    </div>
  );
}
