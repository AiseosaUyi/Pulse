import Link from "next/link";
import { Mail } from "lucide-react";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; verify?: string }>;
}) {
  const params = await searchParams;

  return (
    <div className="bg-card border border-white-200 rounded-2xl p-8">
      <h2
        className="text-xl text-gray-1100 mb-1"
        style={{ fontFamily: "'Satoshi-900', var(--font-sans)" }}
      >
        Welcome back
      </h2>
      <p className="text-sm text-gray-1000 mb-6">Sign in to your workspace.</p>

      {params.verify === "email" && (
        <div className="mb-4 p-3 rounded-lg bg-blue-50 border border-blue-500/20 text-sm text-blue-600 flex items-start gap-2">
          <Mail size={16} className="mt-0.5 flex-shrink-0" />
          <span>Check your email to confirm your account before signing in.</span>
        </div>
      )}
      {params.error && (
        <div className="mb-4 p-3 rounded-lg bg-primary-50 border border-primary-500/20 text-sm text-primary-500">
          {decodeURIComponent(params.error)}
        </div>
      )}

      <form action={login} className="space-y-5">
        <input type="hidden" name="next" value={params.next ?? "/dashboard"} />
        <div>
          <Label htmlFor="login-email">Email</Label>
          <Input
            id="login-email"
            type="email"
            name="email"
            required
            autoComplete="email"
            placeholder="you@company.com"
          />
        </div>
        <div>
          <Label htmlFor="login-password">Password</Label>
          <PasswordInput name="password" required autoComplete="current-password" placeholder="Enter your password" />
        </div>
        <Button type="submit" size="xl" className="w-full">
          Sign in
        </Button>
      </form>

      <p className="mt-6 text-sm text-gray-1000 text-center">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="text-primary-500 hover:text-primary-600 [font-family:'Satoshi-500',var(--font-sans)]">
          Create one
        </Link>
      </p>
    </div>
  );
}
