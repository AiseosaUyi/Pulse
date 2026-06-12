"use client";

// Pick a reusable author → fills the post's author name, avatar, bio, title and
// url in one click. "+ Create new author" opens a modal (with AI bio). Empty
// state = the "select author → none → create one" flow.

import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Label } from "@/components/ui/label";
import { CreateAuthorModal } from "@/components/seo/blog/CreateAuthorModal";
import type { AuthorRecord } from "@/lib/types/authors";

const CREATE_VALUE = "__create__";
const NONE_VALUE = "";

export function AuthorPicker({
  tenantSlug,
  postId,
  authors: initialAuthors,
  selectedName,
  disabled,
  onSelect,
}: {
  tenantSlug: string;
  postId: string;
  authors: AuthorRecord[];
  /** Current post author name, to reflect the active selection. */
  selectedName: string;
  disabled?: boolean;
  /** Called with the chosen author, or null when "None" is picked. */
  onSelect: (author: AuthorRecord | null) => void;
}) {
  const [authors, setAuthors] = useState<AuthorRecord[]>(initialAuthors);
  const [modalOpen, setModalOpen] = useState(false);

  const current = authors.find(
    (a) => a.name.toLowerCase() === selectedName.trim().toLowerCase()
  );

  const handleChange = (value: string) => {
    if (value === CREATE_VALUE) {
      setModalOpen(true);
      return;
    }
    if (value === NONE_VALUE) {
      onSelect(null);
      return;
    }
    const author = authors.find((a) => a.id === value) ?? null;
    onSelect(author);
  };

  return (
    <div>
      <Label htmlFor="bp-author-picker">Author *</Label>
      <div className="flex gap-2">
        <select
          id="bp-author-picker"
          value={current?.id ?? NONE_VALUE}
          onChange={(e) => handleChange(e.target.value)}
          disabled={disabled}
          className="flex-1 h-11 px-3 rounded-lg border border-border bg-card text-sm text-foreground"
        >
          <option value={NONE_VALUE}>
            {selectedName && !current
              ? `${selectedName} (unsaved)`
              : "— none —"}
          </option>
          {authors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.title ? ` · ${a.title}` : ""}
            </option>
          ))}
          <option value={CREATE_VALUE}>+ Create new author…</option>
        </select>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          disabled={disabled}
          aria-label="Create author"
          className="h-11 px-3 rounded-lg border border-border bg-card text-text-muted hover:text-primary-500 inline-flex items-center"
        >
          <UserPlus size={15} />
        </button>
      </div>

      <CreateAuthorModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        tenantSlug={tenantSlug}
        postId={postId}
        onCreated={(author) => {
          setAuthors((prev) => [...prev, author].sort((a, b) =>
            a.name.localeCompare(b.name)
          ));
          onSelect(author);
        }}
      />
    </div>
  );
}
