import { redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Label } from "@/components/ui/label";
import { SettingsForm } from "@/components/settings/SettingsForm";
import { changePassword } from "../actions";
import { SettingsPageHeading } from "../_shared";

export default async function SecuritySettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div>
      <SettingsPageHeading
        icon={Lock}
        title="Security"
        subtitle="Change your password. Two-factor auth is coming later."
      />

      <section className="bg-card border border-border rounded-2xl p-6">
        <SettingsForm
          action={changePassword}
          submitLabel="Change password"
          resetOnSuccess
          className="space-y-5"
        >
          <div>
            <Label htmlFor="s-current">Current password</Label>
            <PasswordInput
              id="s-current"
              name="currentPassword"
              required
              autoComplete="current-password"
              placeholder="Your current password"
            />
          </div>
          <div>
            <Label htmlFor="s-new">New password</Label>
            <PasswordInput
              id="s-new"
              name="newPassword"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="At least 8 characters"
            />
            <p className="mt-1 text-xs text-gray-500">8 characters minimum.</p>
          </div>
          <div>
            <Label htmlFor="s-confirm">Confirm new password</Label>
            <PasswordInput
              id="s-confirm"
              name="confirmPassword"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="Repeat new password"
            />
          </div>
        </SettingsForm>
      </section>
    </div>
  );
}
