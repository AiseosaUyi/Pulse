import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordReset } from "./actions";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; email?: string }>;
}) {
  const params = await searchParams;

  return (
    <div className="bg-card border border-white-200 rounded-2xl p-8">
      <h2
        className="text-xl text-gray-1100 mb-1"
        style={{ fontFamily: "'Satoshi-900', var(--font-sans)" }}
      >
        Forgot your password?
      </h2>
      <p className="text-sm text-gray-1000 mb-6">
        Enter the email tied to your account and we&apos;ll send you a 6-digit code to verify it&apos;s you.
      </p>

      {params.error && (
        <div className="mb-4 p-3 rounded-lg bg-primary-50 border border-primary-500/20 text-sm text-primary-500">
          {decodeURIComponent(params.error)}
        </div>
      )}

      <form action={requestPasswordReset} className="space-y-5">
        <div>
          <Label htmlFor="fp-email">Email</Label>
          <Input
            id="fp-email"
            type="email"
            name="email"
            required
            autoComplete="email"
            placeholder="you@company.com"
            defaultValue={params.email ?? ""}
          />
        </div>
        <Button type="submit" size="xl" className="w-full">
          Send code
        </Button>
      </form>

      <p className="mt-6 text-sm text-gray-1000 text-center">
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-primary-500 hover:text-primary-600 [font-family:'Satoshi-500',var(--font-sans)]"
        >
          <ArrowLeft size={14} />
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
