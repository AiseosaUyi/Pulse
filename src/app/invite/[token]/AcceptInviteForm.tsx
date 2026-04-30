import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { acceptInvite } from "./actions";

export function AcceptInviteForm({ token, email }: { token: string; email: string }) {
  return (
    <form action={acceptInvite} className="space-y-5">
      <input type="hidden" name="token" value={token} />

      <div>
        <Label htmlFor="iv-email">Email</Label>
        <Input
          id="iv-email"
          type="email"
          defaultValue={email}
          readOnly
          className="opacity-70 cursor-not-allowed"
        />
      </div>

      <div>
        <Label htmlFor="iv-name">Full name</Label>
        <Input
          id="iv-name"
          name="displayName"
          type="text"
          required
          autoComplete="name"
          placeholder="Jane Doe"
        />
      </div>

      <div>
        <Label htmlFor="iv-pass">Password</Label>
        <PasswordInput
          name="password"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder="At least 8 characters"
        />
        <p className="mt-1 text-xs text-gray-500">8 characters minimum.</p>
      </div>

      <Button type="submit" size="xl" className="w-full">
        Accept invitation
      </Button>
    </form>
  );
}
