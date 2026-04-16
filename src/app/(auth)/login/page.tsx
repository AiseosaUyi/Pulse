import Link from "next/link";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { login } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; verify?: string }>;
}) {
  const params = await searchParams;

  return (
    <div className="bg-card border border-border rounded-2xl p-8">
      <h2 className="text-xl font-bold mb-1">Sign in</h2>
      <p className="text-sm text-text-muted mb-6">Welcome back.</p>

      {params.verify === "email" && (
        <div className="mb-4 p-3 rounded-lg bg-accent-purple/10 border border-accent-purple/20 text-sm text-text-secondary">
          Check your email to confirm your account before signing in.
        </div>
      )}
      {params.error && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-300">
          {decodeURIComponent(params.error)}
        </div>
      )}

      <form action={login} className="space-y-4">
        <input type="hidden" name="next" value={params.next ?? "/dashboard"} />
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1.5 uppercase tracking-wide">
            Email
          </label>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            className="w-full px-3 py-2.5 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-accent-purple"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1.5 uppercase tracking-wide">
            Password
          </label>
          <PasswordInput name="password" required autoComplete="current-password" />
        </div>
        <button
          type="submit"
          className="w-full py-2.5 rounded-lg text-sm font-semibold text-white gradient-purple-pink hover:opacity-90 transition-opacity cursor-pointer"
        >
          Sign in
        </button>
      </form>

      <p className="mt-6 text-sm text-text-muted text-center">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="text-accent-purple hover:underline">
          Sign up
        </Link>
      </p>
    </div>
  );
}
