// Reached only when client_id/redirect_uri fail validation — the one case
// where we can't safely redirect back to the client at all (that's the
// exact open-redirect risk the redirect_uri exact-match check prevents).

import { ShieldAlert } from "lucide-react";
import { PublicPageShell } from "@/components/layout/PublicPageShell";

export default function InvalidAuthorizeRequestPage() {
  return (
    <PublicPageShell>
      <div className="flex flex-col items-center text-center gap-4 pt-10">
        <ShieldAlert size={48} strokeWidth={1.75} className="text-gray-500" />
        <div>
          <h1 className="text-lg text-gray-1100 [font-family:'Satoshi-700',var(--font-sans)]">
            This connection request isn&apos;t valid
          </h1>
          <p className="text-sm text-gray-1000 mt-1">
            The app trying to connect isn&apos;t registered correctly. Ask them to try again.
          </p>
        </div>
      </div>
    </PublicPageShell>
  );
}
