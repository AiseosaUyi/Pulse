"use client";

/* eslint-disable @next/next/no-img-element */
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Users, Plus, Upload, X } from "lucide-react";
import {
  createCharacter,
  addCharacterReference,
  removeCharacterReference,
  archiveCharacter,
} from "@/lib/actions/video-characters";
import { toast } from "@/components/ui/Toaster";
import type { VideoCharacter } from "@/lib/types/video";

export function CharactersClient({
  characters,
  assetUrls,
}: {
  characters: VideoCharacter[];
  assetUrls: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, startT] = useTransition();
  const [open, setOpen] = useState(false);

  function createNew(formData: FormData) {
    startT(async () => {
      const r = await createCharacter({
        name: String(formData.get("name") ?? ""),
        description: String(formData.get("description") ?? ""),
        identityPrompt: String(formData.get("identityPrompt") ?? ""),
      });
      if (r.success) {
        toast.success("Character created");
        setOpen(false);
        router.refresh();
      } else toast.error(r.error);
    });
  }

  return (
    <div className="p-4 md:p-8 max-w-[1000px] mx-auto">
      <Link href="/video" className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-foreground mb-4">
        <ArrowLeft size={15} /> Video studio
      </Link>
      <header className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Users size={20} className="text-primary-500" />
          <div>
            <h1 className="text-xl md:text-2xl text-gray-1100 dark:text-foreground">Characters</h1>
            <p className="text-sm text-text-muted mt-0.5">
              Define a character once with 3–9 reference images + an identity prompt; reuse it across clips and projects for a consistent look.
            </p>
          </div>
        </div>
        <button onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1.5 rounded-full bg-primary-500 text-white px-4 py-2 text-sm font-medium">
          <Plus size={15} /> New character
        </button>
      </header>

      {open && (
        <form action={createNew} className="bg-card border border-border rounded-2xl p-4 mb-6 space-y-3">
          <input name="name" placeholder="Name (e.g. Sippy host)" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          <input name="description" placeholder="Short description" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          <textarea name="identityPrompt" rows={2} placeholder="Identity prompt — locked look/wardrobe appended to every clip (e.g. 'a 20s Nigerian woman, short afro, red Sippy tee')" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          <button type="submit" disabled={pending} className="rounded-full bg-primary-500 text-white px-4 py-2 text-sm font-medium disabled:opacity-60">Create</button>
        </form>
      )}

      <div className="space-y-4">
        {characters.length === 0 && <p className="text-sm text-text-muted">No characters yet.</p>}
        {characters.map((c) => (
          <CharacterCard key={c.id} character={c} assetUrls={assetUrls} />
        ))}
      </div>
    </div>
  );
}

function CharacterCard({
  character,
  assetUrls,
}: {
  character: VideoCharacter;
  assetUrls: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, startT] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    startT(async () => {
      const r = await addCharacterReference(character.id, fd);
      if (r.success) {
        toast.success("Reference added");
        router.refresh();
      } else toast.error(r.error);
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  function remove(assetId: string) {
    startT(async () => {
      const r = await removeCharacterReference(character.id, assetId);
      if (r.success) router.refresh();
      else toast.error(r.error);
    });
  }

  function archive() {
    startT(async () => {
      const r = await archiveCharacter(character.id);
      if (r.success) { toast.success("Archived"); router.refresh(); }
      else toast.error(r.error);
    });
  }

  return (
    <div className="bg-card border border-border rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">{character.name}</p>
          {character.description && <p className="text-xs text-text-muted mt-0.5">{character.description}</p>}
          {character.identityPrompt && <p className="text-xs text-text-secondary mt-1 italic">{character.identityPrompt}</p>}
        </div>
        <button onClick={archive} disabled={pending} className="text-xs text-text-muted hover:text-primary-500">Archive</button>
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        {character.referenceAssetIds.map((id) =>
          assetUrls[id] ? (
            <div key={id} className="relative">
              <img src={assetUrls[id]} alt="ref" className="h-20 w-20 rounded-lg object-cover" />
              <button onClick={() => remove(id)} className="absolute -top-1 -right-1 rounded-full bg-card border border-border p-0.5 text-text-muted hover:text-primary-500">
                <X size={12} />
              </button>
            </div>
          ) : null
        )}
        {character.referenceAssetIds.length < 9 && (
          <button
            onClick={() => fileRef.current?.click()}
            disabled={pending}
            className="h-20 w-20 rounded-lg border border-dashed border-border flex flex-col items-center justify-center text-text-muted hover:bg-sidebar disabled:opacity-60"
          >
            <Upload size={16} />
            <span className="text-[10px] mt-1">Add</span>
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" onChange={onFile} className="hidden" />
      </div>
    </div>
  );
}
