import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { resetPassword } from "../actions";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;

  // Make sure they verified an OTP before landing here.
  const cookieStore = await cookies();
  if (!cookieStore.get("pwreset")?.value) {
    redirect("/forgot-password");
  }

  return (
    <div className="bg-card border border-white-200 rounded-2xl p-8">
      <div className="inline-flex items-center gap-1.5 text-success-500 text-xs font-semibold tracking-wide uppercase mb-3">
        <CheckCircle2 size={14} />
        Email verified
      </div>
      <h2
        className="text-xl text-gray-1100 mb-1"
        style={{ fontFamily: "'Satoshi-900', var(--font-sans)" }}
      >
        Set a new password
      </h2>
      <p className="text-sm text-gray-1000 mb-6">
        Pick a new password to finish signing back in.
      </p>

      {params.error && (
        <div className="mb-4 p-3 rounded-lg bg-primary-50 border border-primary-500/20 text-sm text-primary-500">
          {decodeURIComponent(params.error)}
        </div>
      )}

      <form action={resetPassword} className="space-y-5">
        <div>
          <Label htmlFor="rp-password">New password</Label>
          <PasswordInput
            name="password"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="At least 8 characters"
          />
          <p className="mt-1 text-xs text-gray-500">8 characters minimum.</p>
        </div>
        <div>
          <Label htmlFor="rp-confirm">Confirm password</Label>
          <PasswordInput
            name="confirm"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="Re-enter your password"
          />
        </div>
        <Button type="submit" size="xl" className="w-full">
          Save and sign in
        </Button>
      </form>
    </div>
  );
}
