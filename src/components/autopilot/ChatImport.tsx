"use client";

// Bring a WhatsApp / Instagram conversation into Pulse so it can draft the
// reply. Two ways in: upload WhatsApp's "Export chat" file, or paste what the
// lead just wrote. Nothing is sent: the draft waits for approval, then the
// person sends it from their own phone.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, Upload } from "lucide-react";
import { toast } from "@/components/ui/Toaster";
import { importChatAction, searchLeadsForChatAction } from "@/lib/actions/outreach-autopilot";
import {
  guessLeadSender,
  parseWhatsAppExport,
  phoneFromSender,
  toImportMessages,
  type ParsedChat,
} from "@/lib/outreach-autopilot/whatsapp-export";

type Channel = "whatsapp" | "instagram";
type Source = "export" | "paste";
type Lead = { id: string; name: string; handle: string | null; phone: string | null };

// The server keeps the latest 400; sending more only makes the request bigger.
const MAX_MESSAGES = 400;
const MAX_TEXT = 3000;

const input =
  "mt-1 w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-gray-1100 dark:text-foreground";
const chip = (on: boolean) =>
  `rounded-full border px-3 py-1.5 text-sm ${
    on ? "border-primary-500 bg-primary-50 text-primary-500" : "border-border text-gray-1000 dark:text-text-muted"
  }`;

export function ChatImport() {
  const router = useRouter();
  const [openPanel, setOpenPanel] = useState(false);
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [source, setSource] = useState<Source>("export");
  const [chat, setChat] = useState<ParsedChat | null>(null);
  const [fileName, setFileName] = useState("");
  const [leadSender, setLeadSender] = useState("");
  const [pasted, setPasted] = useState("");
  const [contact, setContact] = useState("");
  const [query, setQuery] = useState("");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [lead, setLead] = useState<Lead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [searching, startSearch] = useTransition();

  const fromExport = channel === "whatsapp" && source === "export";

  const reset = () => {
    setChat(null);
    setFileName("");
    setLeadSender("");
    setPasted("");
    setContact("");
    setLead(null);
    setLeads([]);
    setQuery("");
    setError(null);
  };

  const onFile = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".txt")) {
      setError('Pick the .txt file. In WhatsApp choose "Without media" when you export.');
      return;
    }
    const parsed = parseWhatsAppExport(await file.text());
    if (!parsed.lines.length) {
      setError("Could not read any messages in this file. Is it a WhatsApp chat export?");
      return;
    }
    setChat(parsed);
    setFileName(file.name);
    const guess = guessLeadSender(parsed.senders, []) ?? (parsed.senders.length === 1 ? parsed.senders[0] : "");
    pickSender(guess);
  };

  // An unsaved contact shows as a number, which is the phone we need.
  const pickSender = (sender: string) => {
    setLeadSender(sender);
    const phone = sender ? phoneFromSender(sender) : null;
    if (phone) setContact(phone);
  };

  const search = (q: string) => {
    setQuery(q);
    if (q.trim().length < 2) {
      setLeads([]);
      return;
    }
    startSearch(async () => {
      const r = await searchLeadsForChatAction(q);
      setLeads(r.ok ? r.leads : []);
    });
  };

  const chooseLead = (l: Lead) => {
    setLead(l);
    setLeads([]);
    setQuery("");
    if (!contact) setContact((channel === "whatsapp" ? l.phone : l.handle) ?? "");
  };

  const messages = (): Array<{ from: "them" | "us"; text: string; at: string }> => {
    if (fromExport) {
      if (!chat || !leadSender) return [];
      return toImportMessages(chat, leadSender)
        .slice(-MAX_MESSAGES)
        .map((m) => ({ ...m, text: m.text.slice(0, MAX_TEXT) }));
    }
    const text = pasted.trim().slice(0, MAX_TEXT);
    return text ? [{ from: "them", text, at: new Date().toISOString() }] : [];
  };

  const submit = () =>
    start(async () => {
      setError(null);
      const list = messages();
      if (!list.length) {
        setError(fromExport ? "Upload the chat and pick which person is the lead." : "Paste what the lead wrote.");
        return;
      }
      const r = await importChatAction({ channel, contact: contact.trim(), prospectId: lead?.id ?? null, messages: list });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const who = r.company ?? "the lead";
      const saved = r.stored === 1 ? "1 new message" : `${r.stored} new messages`;
      if (r.dmId) toast.success(`Reply drafted for ${who}`, `Saved ${saved}. Check it below, approve, then send it from your phone.`);
      else toast.info(`Saved ${saved} from ${who}`, r.noDraftReason ?? undefined);
      reset();
      setOpenPanel(false);
      router.refresh();
    });

  if (!openPanel) {
    return (
      <section className="bg-card border border-border rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-gray-1000 dark:text-text-muted max-w-[560px]">
          Talking to a lead on WhatsApp or Instagram? Bring the chat in and Pulse drafts your reply. You approve it and
          send it from your own phone.
        </p>
        <button
          type="button"
          onClick={() => setOpenPanel(true)}
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm text-gray-1100 dark:text-foreground"
        >
          <MessageCircle className="h-4 w-4" /> Add a chat
        </button>
      </section>
    );
  }

  return (
    <section className="bg-card border border-border rounded-2xl p-5 space-y-4">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-gray-1100 dark:text-foreground">Add a chat</h2>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpenPanel(false);
          }}
          className="text-sm text-gray-1000 dark:text-text-muted underline"
        >
          Cancel
        </button>
      </header>

      <div className="flex flex-wrap gap-2">
        {(["whatsapp", "instagram"] as const).map((c) => (
          <button
            key={c}
            type="button"
            className={chip(channel === c)}
            onClick={() => {
              reset();
              setChannel(c);
              setSource(c === "whatsapp" ? "export" : "paste");
            }}
          >
            {c === "whatsapp" ? "WhatsApp" : "Instagram"}
          </button>
        ))}
      </div>

      {channel === "whatsapp" && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={chip(source === "export")} onClick={() => setSource("export")}>
            Upload the chat
          </button>
          <button type="button" className={chip(source === "paste")} onClick={() => setSource("paste")}>
            Paste their message
          </button>
        </div>
      )}

      {fromExport ? (
        <div className="space-y-3">
          <p className="text-xs text-gray-1000 dark:text-text-muted">
            In WhatsApp open the chat, tap the name, then Export chat, Without media. Save the file and pick it here.
            Uploading the same chat again only adds the new messages.
          </p>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm text-gray-1100 dark:text-foreground">
            <Upload className="h-4 w-4" /> {fileName || "Choose the .txt file"}
            <input type="file" accept=".txt,text/plain" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          {chat && (
            <label className="block">
              <span className="text-xs font-medium text-gray-1000 dark:text-text-muted">
                Which one is the lead? ({chat.lines.length} messages)
              </span>
              <select value={leadSender} onChange={(e) => pickSender(e.target.value)} className={input}>
                <option value="">Pick a person</option>
                {chat.senders.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      ) : (
        <label className="block">
          <span className="text-xs font-medium text-gray-1000 dark:text-text-muted">What the lead wrote</span>
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={4}
            maxLength={MAX_TEXT}
            className={input}
          />
        </label>
      )}

      <label className="block">
        <span className="text-xs font-medium text-gray-1000 dark:text-text-muted">
          {channel === "whatsapp" ? "Their WhatsApp number, with country code" : "Their Instagram handle"}
        </span>
        <input
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          placeholder={channel === "whatsapp" ? "+234 802 000 0000" : "@theirhandle"}
          maxLength={80}
          className={input}
        />
      </label>

      <div className="space-y-2">
        <span className="text-xs font-medium text-gray-1000 dark:text-text-muted">
          Lead (Pulse finds it by {channel === "whatsapp" ? "number" : "handle"} if you leave this empty)
        </span>
        {lead ? (
          <p className="text-sm text-gray-1100 dark:text-foreground">
            {lead.name}{" "}
            <button type="button" onClick={() => setLead(null)} className="text-primary-500 underline">
              change
            </button>
          </p>
        ) : (
          <>
            <input
              value={query}
              onChange={(e) => search(e.target.value)}
              placeholder="Search your leads by name"
              className={input}
            />
            {searching && <p className="text-xs text-gray-1000 dark:text-text-muted">Searching...</p>}
            {leads.length > 0 && (
              <ul className="rounded-lg border border-border divide-y divide-border">
                {leads.map((l) => (
                  <li key={l.id}>
                    <button
                      type="button"
                      onClick={() => chooseLead(l)}
                      className="w-full px-3 py-2 text-left text-sm text-gray-1100 dark:text-foreground hover:bg-gray-500/5"
                    >
                      {l.name}
                      <span className="text-xs text-gray-1000 dark:text-text-muted">
                        {[l.handle && `@${l.handle}`, l.phone].filter(Boolean).map((x) => ` · ${x}`)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="button"
        disabled={pending}
        onClick={submit}
        className="inline-flex items-center gap-1.5 rounded-full bg-primary-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Drafting..." : "Save and draft a reply"}
      </button>
    </section>
  );
}
