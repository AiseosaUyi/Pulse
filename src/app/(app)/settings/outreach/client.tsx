"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "@/components/ui/Toaster";
import {
  saveMailboxAction,
  saveOutreachCopyAction,
  sendTestEmailAction,
  type OutreachCopyInput,
} from "@/lib/actions/outreach-autopilot";
import type { MailboxConfig, MailboxInput } from "@/lib/outreach-autopilot/mailbox";

const inputCls =
  "mt-1 w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-gray-1100 dark:text-foreground";
const labelCls = "block text-xs font-medium text-gray-1000 dark:text-text-muted";
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-gray-1000 dark:text-text-muted">{hint}</span>}
    </label>
  );
}

export function MailboxForm({ initial }: { initial: MailboxConfig | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [testing, startTest] = useTransition();
  const [v, setV] = useState<MailboxInput>({
    fromEmail: initial?.fromEmail ?? "",
    fromName: initial?.fromName ?? "",
    replyTo: initial?.replyTo ?? null,
    smtpHost: initial?.smtpHost ?? "",
    smtpPort: initial?.smtpPort ?? 587,
    smtpUser: initial?.smtpUser ?? "",
    smtpPassword: "",
    imapHost: initial?.imapHost ?? "",
    imapPort: initial?.imapPort ?? 993,
    enabled: initial?.enabled ?? false,
    dailyCap: initial?.dailyCap ?? 30,
    sendWindowStart: initial?.sendWindowStart ?? 9,
    sendWindowEnd: initial?.sendWindowEnd ?? 17,
    sendWeekdays: initial?.sendWeekdays ?? [1, 2, 3, 4, 5],
    autoFollowUps: initial?.autoFollowUps ?? true,
    followUp1Days: initial?.followUp1Days ?? 3,
    followUp2Days: initial?.followUp2Days ?? 7,
    approverEmail: initial?.approverEmail ?? "",
    digestHour: initial?.digestHour ?? 8,
    autoCompose: initial?.autoCompose ?? true,
  });
  const set = <K extends keyof MailboxInput>(k: K, val: MailboxInput[K]) => setV((p) => ({ ...p, [k]: val }));
  const num = (k: keyof MailboxInput) => (e: React.ChangeEvent<HTMLInputElement>) =>
    set(k, Number(e.target.value) as never);

  const save = () =>
    start(async () => {
      const r = await saveMailboxAction(v);
      if (r.ok) {
        toast.success("Mailbox saved", v.enabled ? "Autopilot is on." : "Autopilot is off until you turn it on.");
        set("smtpPassword", "");
        router.refresh();
      } else toast.error("Could not save", r.error);
    });

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Send from (email)">
          <input className={inputCls} value={v.fromEmail} onChange={(e) => set("fromEmail", e.target.value)} placeholder="hello@yourcompany.com" />
        </Field>
        <Field label="Sender name">
          <input className={inputCls} value={v.fromName} onChange={(e) => set("fromName", e.target.value)} placeholder="Jane from Your Company" />
        </Field>
        <Field label="Reply-to (optional)" hint="Leave empty to get replies at the send-from address.">
          <input className={inputCls} value={v.replyTo ?? ""} onChange={(e) => set("replyTo", e.target.value || null)} placeholder="sales@yourcompany.com" />
        </Field>
        <Field label="Send me the approval email at">
          <input className={inputCls} value={v.approverEmail} onChange={(e) => set("approverEmail", e.target.value)} placeholder="you@yourcompany.com" />
        </Field>
        <Field label="Mail server (SMTP)">
          <input className={inputCls} value={v.smtpHost} onChange={(e) => set("smtpHost", e.target.value)} placeholder="mail.yourcompany.com" />
        </Field>
        <Field label="SMTP port">
          <input className={inputCls} type="number" value={v.smtpPort} onChange={num("smtpPort")} />
        </Field>
        <Field label="Mailbox login">
          <input className={inputCls} value={v.smtpUser} onChange={(e) => set("smtpUser", e.target.value)} autoComplete="off" placeholder="hello@yourcompany.com" />
        </Field>
        <Field label="Mailbox password" hint={initial?.hasPassword ? "Saved. Leave empty to keep it." : "Stored encrypted. Never shown again."}>
          <input
            className={inputCls}
            type="password"
            value={v.smtpPassword}
            onChange={(e) => set("smtpPassword", e.target.value)}
            autoComplete="new-password"
            placeholder="••••••••"
          />
        </Field>
        <Field label="Read replies from (IMAP)" hint="Same mailbox and login. Empty turns reply reading off.">
          <input className={inputCls} value={v.imapHost ?? ""} onChange={(e) => set("imapHost", e.target.value || null)} placeholder="mail.yourcompany.com" />
        </Field>
        <Field label="IMAP port">
          <input className={inputCls} type="number" value={v.imapPort} onChange={num("imapPort")} />
        </Field>
      </div>

      <hr className="border-border" />

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Max emails per day">
          <input className={inputCls} type="number" min={1} max={200} value={v.dailyCap} onChange={num("dailyCap")} />
        </Field>
        <Field label="Send from (hour)">
          <input className={inputCls} type="number" min={0} max={23} value={v.sendWindowStart} onChange={num("sendWindowStart")} />
        </Field>
        <Field label="Send until (hour)">
          <input className={inputCls} type="number" min={1} max={24} value={v.sendWindowEnd} onChange={num("sendWindowEnd")} />
        </Field>
        <Field label="Approval email at (hour)">
          <input className={inputCls} type="number" min={0} max={23} value={v.digestHour} onChange={num("digestHour")} />
        </Field>
        <Field label="Follow-up 1 after (days)">
          <input className={inputCls} type="number" min={1} max={30} value={v.followUp1Days} onChange={num("followUp1Days")} />
        </Field>
        <Field label="Follow-up 2 after (days)">
          <input className={inputCls} type="number" min={2} max={60} value={v.followUp2Days} onChange={num("followUp2Days")} />
        </Field>
      </div>

      <div>
        <span className={labelCls}>Send on</span>
        <div className="mt-1 flex flex-wrap gap-2">
          {DAYS.map((d, i) => {
            const day = i + 1;
            const on = v.sendWeekdays.includes(day);
            return (
              <button
                key={d}
                type="button"
                onClick={() =>
                  set("sendWeekdays", on ? v.sendWeekdays.filter((x) => x !== day) : [...v.sendWeekdays, day])
                }
                className={
                  on
                    ? "rounded-full bg-primary-500 px-3 py-1 text-xs font-semibold text-white"
                    : "rounded-full border border-border px-3 py-1 text-xs text-gray-1000 dark:text-text-muted"
                }
              >
                {d}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2 text-sm text-gray-1100 dark:text-foreground">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={v.autoCompose} onChange={(e) => set("autoCompose", e.target.checked)} />
          Draft first emails for new verified leads every day
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={v.autoFollowUps} onChange={(e) => set("autoFollowUps", e.target.checked)} />
          Draft follow-ups when there is no reply
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={v.enabled} onChange={(e) => set("enabled", e.target.checked)} />
          <strong>Autopilot on</strong> (sends only what you approve)
        </label>
      </div>

      <div className="flex flex-wrap gap-2 pt-2">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-full bg-primary-500 px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? "Saving..." : "Save mailbox"}
        </button>
        <button
          type="button"
          disabled={testing || !initial}
          onClick={() =>
            startTest(async () => {
              const r = await sendTestEmailAction();
              if (r.ok) toast.success("Test email sent", `Check ${r.to}`);
              else toast.error("Test failed", r.error);
            })
          }
          className="rounded-full border border-border px-5 py-2 text-sm text-gray-1100 dark:text-foreground disabled:opacity-60"
        >
          {testing ? "Sending..." : "Send me a test"}
        </button>
      </div>
    </div>
  );
}

type Seg = { proof: string[]; offer: string[]; ask: string[] };

function LinesField({ label, value, onChange }: { label: string; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <Field label={label} hint="One per line. Pulse rotates between them.">
      <textarea
        className={inputCls}
        rows={Math.max(2, value.length + 1)}
        value={value.join("\n")}
        onChange={(e) => onChange(e.target.value.split("\n"))}
      />
    </Field>
  );
}

export function CopyEditor({ initial }: { initial: OutreachCopyInput }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [v, setV] = useState<OutreachCopyInput>(initial);
  const [newSeg, setNewSeg] = useState("");
  const segNames = Object.keys(v.segments);

  const setSeg = (name: string, patch: Partial<Seg>) =>
    setV((p) => ({ ...p, segments: { ...p.segments, [name]: { ...p.segments[name], ...patch } } }));

  const save = () =>
    start(async () => {
      const clean = (l: string[]) => l.map((x) => x.trim()).filter(Boolean);
      const payload: OutreachCopyInput = {
        ...v,
        segments: Object.fromEntries(
          Object.entries(v.segments).map(([k, s]) => [k, { proof: clean(s.proof), offer: clean(s.offer), ask: clean(s.ask) }])
        ),
        bannedWords: clean(v.bannedWords),
      };
      const r = await saveOutreachCopyAction(payload);
      if (r.ok) {
        toast.success("Copy saved", "New drafts use it from now on.");
        router.refresh();
      } else toast.error("Could not save", r.error);
    });

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Signature">
          <textarea className={inputCls} rows={2} value={v.signature} onChange={(e) => setV({ ...v, signature: e.target.value })} />
        </Field>
        <Field label="Default segment">
          <select className={inputCls} value={v.defaultSegment} onChange={(e) => setV({ ...v, defaultSegment: e.target.value })}>
            {segNames.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {segNames.map((name) => (
        <fieldset key={name} className="rounded-xl border border-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <legend className="text-sm font-semibold text-gray-1100 dark:text-foreground">Segment: {name}</legend>
            {segNames.length > 1 && (
              <button
                type="button"
                aria-label={`Remove segment ${name}`}
                onClick={() =>
                  setV((p) => {
                    const rest = Object.fromEntries(Object.entries(p.segments).filter(([k]) => k !== name));
                    return {
                      ...p,
                      segments: rest,
                      defaultSegment: p.defaultSegment === name ? Object.keys(rest)[0] : p.defaultSegment,
                    };
                  })
                }
                className="text-gray-1000 dark:text-text-muted"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
          <LinesField label="Proof lines (facts that are true)" value={v.segments[name].proof} onChange={(x) => setSeg(name, { proof: x })} />
          <LinesField label="Offers" value={v.segments[name].offer} onChange={(x) => setSeg(name, { offer: x })} />
          <LinesField label="Asks (end with a question)" value={v.segments[name].ask} onChange={(x) => setSeg(name, { ask: x })} />
        </fieldset>
      ))}

      <div className="flex gap-2">
        <input className={inputCls + " mt-0"} placeholder="New segment name, e.g. hotels" value={newSeg} onChange={(e) => setNewSeg(e.target.value)} />
        <button
          type="button"
          onClick={() => {
            const n = newSeg.trim().toLowerCase();
            if (!n || v.segments[n]) return;
            setV((p) => ({ ...p, segments: { ...p.segments, [n]: { proof: [], offer: [], ask: [] } } }));
            setNewSeg("");
          }}
          className="shrink-0 inline-flex items-center gap-1 rounded-full border border-border px-4 py-2 text-sm text-gray-1100 dark:text-foreground"
        >
          <Plus className="h-4 w-4" /> Add
        </button>
      </div>

      <Field label="Follow-up 1">
        <textarea className={inputCls} rows={6} value={v.followUp1Body} onChange={(e) => setV({ ...v, followUp1Body: e.target.value })} />
      </Field>
      <Field label="Follow-up 2">
        <textarea className={inputCls} rows={6} value={v.followUp2Body} onChange={(e) => setV({ ...v, followUp2Body: e.target.value })} />
      </Field>
      <Field label="Words drafts must never use" hint="One per line. A draft that uses one gets flagged in the approval email.">
        <textarea
          className={inputCls}
          rows={6}
          value={v.bannedWords.join("\n")}
          onChange={(e) => setV({ ...v, bannedWords: e.target.value.split("\n") })}
        />
      </Field>
      <Field label="Idea opener" hint='How the idea sentence starts, e.g. "What if there was".'>
        <input className={inputCls} value={v.ideaPrefix} onChange={(e) => setV({ ...v, ideaPrefix: e.target.value })} />
      </Field>

      <button
        type="button"
        onClick={save}
        disabled={pending}
        className="rounded-full bg-primary-500 px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Saving..." : "Save copy"}
      </button>
    </div>
  );
}
