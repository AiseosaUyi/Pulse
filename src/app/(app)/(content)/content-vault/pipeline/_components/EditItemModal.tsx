"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDialogs } from "@/components/ui/Dialog";
import { updateContentItem } from "@/lib/actions/content-pipeline";
import {
  CONTENT_PLATFORMS,
  type ContentItemWithDisplay,
  type ContentPlatform,
  type ContentType,
} from "@/lib/types/content-pipeline";
import { MenuSelect } from "./MenuSelect";

const PLATFORM_LABELS: Record<ContentPlatform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  x: "X",
  facebook: "Facebook",
  whatsapp: "WhatsApp",
  email: "Email",
};

interface Props {
  item: ContentItemWithDisplay;
  contentTypes: ContentType[];
  members: Array<{ id: string; name: string }>;
  onClose: () => void;
}

function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  // datetime-local needs YYYY-MM-DDTHH:mm in local TZ
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export function EditItemModal({
  item,
  contentTypes,
  members,
  onClose,
}: Props) {
  const router = useRouter();
  const dialogs = useDialogs();
  const [title, setTitle] = useState(item.title);
  const [contentTypeSlug, setContentTypeSlug] = useState(
    item.contentTypeSlug ?? ""
  );
  const [platforms, setPlatforms] = useState<ContentPlatform[]>(item.platforms);
  const [scheduledAt, setScheduledAt] = useState(
    isoToLocalInput(item.scheduledAt)
  );
  const [assignedTo, setAssignedTo] = useState(item.assignedTo ?? "");
  const [busy, setBusy] = useState(false);

  const togglePlatform = (p: ContentPlatform) => {
    setPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );
  };

  const save = async () => {
    setBusy(true);
    const res = await updateContentItem({
      id: item.id,
      title: title.trim() || item.title,
      contentTypeSlug: contentTypeSlug || null,
      platforms,
      scheduledAt: scheduledAt
        ? new Date(scheduledAt).toISOString()
        : null,
      assignedTo: assignedTo || null,
    });
    setBusy(false);
    if (!res.ok) {
      await dialogs.alert({ title: "Couldn't save", subtitle: res.error });
      return;
    }
    router.refresh();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="bg-card border border-border rounded-2xl w-full max-w-lg flex flex-col overflow-hidden max-h-[90vh]">
        <header className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">Edit</h2>
          <button
            type="button"
            onClick={() => !busy && onClose()}
            className="p-1 rounded-md text-text-muted hover:text-foreground"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <Label htmlFor="edit-title">Title</Label>
            <Input
              id="edit-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div>
            <Label>Platforms</Label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {CONTENT_PLATFORMS.map((p) => {
                const on = platforms.includes(p);
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => togglePlatform(p)}
                    className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                      on
                        ? "bg-primary-500 text-white border-primary-500"
                        : "bg-card text-foreground border-border hover:border-primary-300 hover:text-primary-600"
                    }`}
                  >
                    {PLATFORM_LABELS[p]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="edit-type">Type</Label>
              <div className="mt-1">
                <MenuSelect
                  id="edit-type"
                  value={contentTypeSlug}
                  onChange={setContentTypeSlug}
                  options={contentTypes.map((t) => ({
                    value: t.slug,
                    label: t.label,
                  }))}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="edit-scheduled">Post schedule</Label>
              <Input
                id="edit-scheduled"
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="[&::-webkit-calendar-picker-indicator]:cursor-pointer"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="edit-assignee">Assigned to</Label>
            <div className="mt-1">
              <MenuSelect
                id="edit-assignee"
                value={assignedTo}
                onChange={setAssignedTo}
                options={members.map((m) => ({
                  value: m.id,
                  label: m.name,
                }))}
              />
            </div>
          </div>
        </div>

        <footer className="border-t border-border px-5 py-3 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button type="button" size="sm" disabled={busy} onClick={save}>
            {busy ? <Loader2 size={14} className="animate-spin mr-1.5" /> : null}
            Save
          </Button>
        </footer>
      </div>
    </div>
  );
}
