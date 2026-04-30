import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { OtpInput } from "./OtpInput";
import { verifyPasswordOtp, requestPasswordReset } from "../actions";

export default async function VerifyOtpPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; error?: string }>;
}) {
  const params = await searchParams;
  const email = params.email?.trim().toLowerCase();
  if (!email) redirect("/forgot-password");

  return (
    <div className="bg-card border border-white-200 rounded-2xl p-8">
      <h2
        className="text-xl text-gray-1100 mb-1"
        style={{ fontFamily: "'Satoshi-900', var(--font-sans)" }}
      >
        Check your email
      </h2>
      <p className="text-sm text-gray-1000 mb-6">
        We sent a 6-digit code to <span className="text-gray-1100 [font-family:'Satoshi-500',var(--font-sans)]">{email}</span>. Enter it below to continue.
      </p>

      {params.error && (
        <div className="mb-4 p-3 rounded-lg bg-primary-50 border border-primary-500/20 text-sm text-primary-500">
          {decodeURIComponent(params.error)}
        </div>
      )}

      <form action={verifyPasswordOtp} className="space-y-6">
        <input type="hidden" name="email" value={email} />
        <div>
          <Label className="mb-3 block">Verification code</Label>
          <OtpInput name="otp" length={6} />
        </div>
        <Button type="submit" size="xl" className="w-full">
          Verify code
        </Button>
      </form>

      <div className="mt-6 flex items-center justify-center gap-3 text-sm">
        <form action={requestPasswordReset}>
          <input type="hidden" name="email" value={email} />
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 text-gray-1000 hover:text-primary-500 transition-colors cursor-pointer [font-family:'Satoshi-500',var(--font-sans)]"
          >
            <Mail size={14} />
            Resend code
          </button>
        </form>
        <span className="text-white-200">·</span>
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-gray-1000 hover:text-primary-500 transition-colors [font-family:'Satoshi-500',var(--font-sans)]"
        >
          <ArrowLeft size={14} />
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
