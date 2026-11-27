import { requireTenantRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMailbox } from "@/lib/outreach-autopilot/mailbox";
import { SettingsPageHeading } from "../_shared";
import { bannedWordsFromRegex } from "@/lib/outreach-autopilot/templates";
import { MailboxForm, CopyEditor } from "./client";

export const dynamic = "force-dynamic";

export default async function OutreachSettingsPage() {
  const tenant = await requireTenantRole(["owner", "admin"]);
  const admin = createAdminClient();
  const [mailbox, cfg] = await Promise.all([
    getMailbox(admin, tenant.slug),
    admin.from("outreach_configs").select("*").eq("workspace", tenant.slug).maybeSingle(),
  ]);
  const c = cfg.data as Record<string, unknown> | null;

  return (
    <div className="max-w-[760px] space-y-6">
      <SettingsPageHeading
        title="Outreach autopilot"
        subtitle={`The mailbox ${tenant.name} sends from, when it sends, and the words it uses. Nothing is sent until you approve it.`}
      />

      <section className="bg-card border border-border rounded-2xl p-6">
        <h2 className="text-base font-semibold text-gray-1100 dark:text-foreground mb-1">Sending mailbox</h2>
        <p className="text-sm text-gray-1000 dark:text-text-muted mb-5">
          Send from this workspace&apos;s own mailbox so replies come back to it. Pulse reads replies from the same
          mailbox to stop follow-ups.
        </p>
        <MailboxForm initial={mailbox} />
      </section>

      <section className="bg-card border border-border rounded-2xl p-6">
        <h2 className="text-base font-semibold text-gray-1100 dark:text-foreground mb-1">What Pulse writes</h2>
        <p className="text-sm text-gray-1000 dark:text-text-muted mb-5">
          Each workspace has its own lead types. A lead&apos;s type picks which lines its first email uses, and
          Pulse rotates between them. Use {"{greeting}"}, {"{company}"}, {"{first_name}"} and {"{signature}"} in
          follow-ups.
        </p>
        <CopyEditor
          initial={{
            defaultSegment: (c?.default_segment as string) ?? "general",
            segments: (c?.segments as Record<string, { proof: string[]; offer: string[]; ask: string[] }>) ?? {
              general: { proof: [], offer: [], ask: [] },
            },
            signature: (c?.signature as string) ?? tenant.name,
            ideaPrefix: (c?.idea_prefix as string) ?? "What if there was",
            followUp1Body: (c?.follow_up_1_body as string) ?? "{greeting}\n\nBringing this back to the top of your inbox.\n\n{signature}",
            followUp2Body: (c?.follow_up_2_body as string) ?? "{greeting}\n\nLast note from me on this.\n\n{signature}",
            bannedWords: bannedWordsFromRegex(c?.banned_regex as string | undefined),
          }}
        />
      </section>
    </div>
  );
}
