"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Copy, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/Toaster";
import { draftEngagement, discoverEngageCandidates, dismissCandidate } from "@/lib/actions/engage";
import type { EngageCandidate } from "@/lib/services/engage";
import { PLATFORM_LABEL } from "@/lib/cadence/types";

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied.");
  } catch {
    toast.error("Couldn't copy — select and copy manually.");
  }
}

function DraftCards({ quote, reply }: { quote: string; reply: string }) {
  return (
    <div className="mt-3 grid gap-3">
      {([
        { key: "quote", title: "Quote-post", text: quote },
        { key: "reply", title: "Reply", text: reply },
      ] as const).map(({ key, title, text }) => (
        <div key={key} className="rounded-xl border border-white-200 bg-white-50 p-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wide text-gray-1000">{title}</span>
            <Button type="button" size="xs" variant="tertiary" onClick={() => copyText(text)}>
              <Copy /> Copy
            </Button>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-1200">{text}</p>
        </div>
      ))}
    </div>
  );
}

function CandidateCard({
  tenantSlug,
  candidate,
}: {
  tenantSlug: string;
  candidate: EngageCandidate;
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<{ quote: string; reply: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function draft() {
    startTransition(async () => {
      const res = await draftEngagement(tenantSlug, {
        postText: candidate.content,
        fromHandle: candidate.authorHandle ?? undefined,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      setDrafts({ quote: res.quote, reply: res.reply });
    });
  }
  function dismiss() {
    startTransition(async () => {
      const res = await dismissCandidate(tenantSlug, candidate.id);
      if (!res.success) toast.error(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="rounded-2xl border border-white-200 bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-gray-1000">
          {PLATFORM_LABEL[candidate.platform]}
          {candidate.authorHandle ? ` · ${candidate.authorHandle}` : ""}
        </span>
        <button
          type="button"
          onClick={dismiss}
          disabled={pending}
          aria-label="Dismiss"
          className="grid size-7 place-items-center rounded-full text-gray-1000 hover:bg-gray-50 hover:text-gray-1200 disabled:opacity-50"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-1200">{candidate.content}</p>
      {candidate.externalUrl && (
        <a
          href={candidate.externalUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block text-xs text-primary-500 hover:text-primary-600"
        >
          View original →
        </a>
      )}
      {!drafts ? (
        <div className="mt-3">
          <Button type="button" size="sm" variant="tertiary" onClick={draft} disabled={pending}>
            {pending ? <><Loader2 className="animate-spin" /> Drafting…</> : "Draft quote & reply"}
          </Button>
        </div>
      ) : (
        <DraftCards quote={drafts.quote} reply={drafts.reply} />
      )}
    </div>
  );
}

export function EngageClient({
  tenantSlug,
  candidates,
}: {
  tenantSlug: string;
  candidates: EngageCandidate[];
}) {
  const router = useRouter();
  const [post, setPost] = useState("");
  const [handle, setHandle] = useState("");
  const [manual, setManual] = useState<{ quote: string; reply: string } | null>(null);
  const [drafting, startDraft] = useTransition();
  const [finding, startFind] = useTransition();

  function find() {
    startFind(async () => {
      const res = await discoverEngageCandidates(tenantSlug);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success(res.found > 0 ? `Found ${res.found} new posts.` : "No new posts right now.");
      router.refresh();
    });
  }

  function generate() {
    if (!post.trim()) {
      toast.error("Paste the post you want to engage with.");
      return;
    }
    startDraft(async () => {
      const res = await draftEngagement(tenantSlug, { postText: post, fromHandle: handle || undefined });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      setManual({ quote: res.quote, reply: res.reply });
    });
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 md:py-12">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-1100 [font-family:'Satoshi-700',var(--font-sans)]">
            Engage
          </h1>
          <p className="mt-1 text-sm text-gray-1000">
            Posts worth reacting to in your space — get a quote-take and a reply in your voice.
          </p>
        </div>
        <Button type="button" size="sm" variant="tertiary" onClick={find} disabled={finding}>
          {finding ? <><Loader2 className="animate-spin" /> Finding…</> : <><Search /> Find posts</>}
        </Button>
      </div>

      {/* Discovered feed */}
      {candidates.length > 0 && (
        <div className="mt-6 flex flex-col gap-3">
          {candidates.map((c) => (
            <CandidateCard key={c.id} tenantSlug={tenantSlug} candidate={c} />
          ))}
        </div>
      )}

      {/* Manual paste */}
      <div className="mt-8 border-t border-white-200 pt-6">
        <h2 className="text-sm font-bold text-gray-1100">Or paste a post</h2>
        <div className="mt-3 flex flex-col gap-3">
          <textarea
            value={post}
            onChange={(e) => setPost(e.target.value)}
            rows={4}
            placeholder="Paste the post (or thread) you want to react to…"
            className="w-full resize-y rounded-2xl border border-white-200 bg-card px-4 py-3 text-base text-gray-1200 outline-none placeholder:text-gray-400 focus-visible:ring-[3px] focus-visible:ring-blue-500/30"
          />
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="Author handle (optional) — @someone"
            className="w-full rounded-lg border border-white-200 bg-card px-3 py-2 text-sm text-gray-1200 outline-none focus-visible:ring-[3px] focus-visible:ring-blue-500/30"
          />
          <div>
            <Button type="button" onClick={generate} disabled={drafting}>
              {drafting ? <><Loader2 className="animate-spin" /> Drafting…</> : "Draft quote & reply"}
            </Button>
          </div>
          {manual && <DraftCards quote={manual.quote} reply={manual.reply} />}
        </div>
      </div>
    </div>
  );
}
