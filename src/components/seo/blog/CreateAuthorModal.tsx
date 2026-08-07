"use client";

// Create a reusable author. Enter a name + role + a few facts → AI rewrites an
// authority/E-E-A-T bio (enriched from brand positioning) you can edit → save →
// it becomes selectable on every post.

import { useState, useTransition } from "react";
import { Loader2, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogHeader,
  DialogBody,
  DialogFooter,
} from "@/components/ui/Dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ImageUploadField } from "@/components/seo/blog/ImageUploadField";
import { createAuthor, generateAuthorBio } from "@/lib/actions/authors";
import type { AuthorRecord } from "@/lib/types/authors";

export function CreateAuthorModal({
  open,
  onClose,
  tenantSlug,
  postId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  tenantSlug: string;
  postId: string;
  onCreated: (author: AuthorRecord) => void;
}) {
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [facts, setFacts] = useState("");
  const [bio, setBio] = useState("");
  const [url, setUrl] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, startGenerate] = useTransition();
  const [isSaving, startSave] = useTransition();

  const handleGenerate = () => {
    if (!name.trim()) {
      setError("Enter the author's name first.");
      return;
    }
    setError(null);
    startGenerate(async () => {
      const res = await generateAuthorBio({ name, title, facts });
      if (!res.success) {
        setError(res.error);
        return;
      }
      setBio(res.bio);
    });
  };

  const handleSave = () => {
    if (!name.trim()) {
      setError("Author name is required.");
      return;
    }
    setError(null);
    startSave(async () => {
      const res = await createAuthor({
        name,
        title,
        bio,
        imageUrl,
        url,
      });
      if (!res.success) {
        setError(res.error);
        return;
      }
      onCreated(res.author);
      onClose();
    });
  };

  const busy = isGenerating || isSaving;

  return (
    <Dialog open={open} onClose={onClose} size="lg" locked={busy}>
      <DialogHeader
        title="Create author"
        subtitle="Saved once, reusable on every post."
      />
      <DialogBody>
        <div className="space-y-3">
          <div className="grid grid-cols-[1fr_88px] gap-2 items-center overflow-hidden">
            <div className="space-y-3">
              <div>
                <Label htmlFor="ca-name">Name *</Label>
                <Input
                  id="ca-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ada Obi"
                  disabled={busy}
                />
              </div>
              <div>
                <Label htmlFor="ca-title">Role / title</Label>
                <Input
                  id="ca-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Events Editor"
                  disabled={busy}
                />
              </div>
            </div>
            <ImageUploadField
              label="Avatar"
              kind="author"
              aspect="square"
              value={imageUrl}
              tenantSlug={tenantSlug}
              postId={postId}
              disabled={busy}
              onChange={setImageUrl}
            />
          </div>

          <div>
            <Label htmlFor="ca-facts">A few facts (for the AI bio)</Label>
            <Textarea
              id="ca-facts"
              value={facts}
              onChange={(e) => setFacts(e.target.value)}
              rows={2}
              placeholder="What they cover, years in the space, anything credible — rough notes are fine."
              disabled={busy}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <Label htmlFor="ca-bio">Bio</Label>
              <Button
                variant="ghost"
                size="xs"
                onClick={handleGenerate}
                disabled={busy}
                className="gap-1"
              >
                {isGenerating ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Sparkles size={12} />
                )}
                {isGenerating ? "Writing…" : "Generate with AI"}
              </Button>
            </div>
            <Textarea
              id="ca-bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              placeholder="Authority-commanding bio — generate then tweak."
              disabled={busy}
            />
          </div>

          <div>
            <Label htmlFor="ca-url">Profile URL</Label>
            <Input
              id="ca-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              disabled={busy}
            />
          </div>

          {error && (
            <p className="text-sm text-red-500" role="alert">
              {error}
            </p>
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={busy}>
          {isSaving ? <Loader2 size={14} className="animate-spin" /> : null}
          Save author
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
