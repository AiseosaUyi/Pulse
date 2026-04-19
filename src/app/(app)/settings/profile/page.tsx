import { redirect } from "next/navigation";
import { UserCircle, Mail } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsForm } from "@/components/settings/SettingsForm";
import { AvatarUpload } from "@/components/settings/AvatarUpload";
import { updateProfile } from "../actions";
import { SettingsPageHeading } from "../_shared";

export default async function ProfileSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div>
      <SettingsPageHeading
        icon={UserCircle}
        title="Profile"
        subtitle="Your display name, username, and avatar. Visible to teammates."
      />

      <section className="bg-card border border-border rounded-2xl p-6">
        <div className="mb-6 pb-6 border-b border-white-200 space-y-4">
          <AvatarUpload
            userId={user.id}
            currentUrl={user.avatarUrl}
            displayName={user.displayName ?? user.email}
          />
          <p className="text-xs text-gray-1000 dark:text-text-muted flex items-center gap-1.5">
            <Mail size={12} />
            {user.email}
          </p>
        </div>

        <SettingsForm
          action={updateProfile}
          submitLabel="Save profile"
          className="space-y-5"
        >
          <div>
            <Label htmlFor="p-name">Display name</Label>
            <Input
              id="p-name"
              type="text"
              name="displayName"
              defaultValue={user.displayName ?? ""}
              required
              placeholder="Your full name"
            />
          </div>
          <div>
            <Label htmlFor="p-user">Username</Label>
            <Input
              id="p-user"
              type="text"
              name="username"
              defaultValue={user.username ?? ""}
              pattern="[a-z0-9_-]{2,40}"
              required
              placeholder="lowercase-handle"
            />
          </div>
        </SettingsForm>
      </section>
    </div>
  );
}
