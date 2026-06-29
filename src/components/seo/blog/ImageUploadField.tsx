"use client";

// Reusable image picker for the blog editor. Uploads to the public
// `blog-assets` Supabase bucket and returns the public URL — which is what
// the publish-runner hands to Contentful (uploadGruveAsset fetches it by URL).

import { useRef, useState } from "react";
import Image from "next/image";
import { ImagePlus, X, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const MAX_BYTES = 10 * 1024 * 1024;

function slugifyName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "");
}

export function ImageUploadField({
  label,
  hint,
  required,
  value,
  tenantSlug,
  postId,
  kind,
  disabled,
  aspect = "wide",
  onChange,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  value: string | null;
  tenantSlug: string;
  postId: string;
  /** Used in the storage path so banner/thumbnail/author don't collide. */
  kind: "banner" | "thumbnail" | "author";
  disabled?: boolean;
  aspect?: "wide" | "square";
  onChange: (url: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = () => inputRef.current?.click();

  const handleFile = async (file: File) => {
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Image must be under 10 MB.");
      return;
    }
    setBusy(true);
    try {
      const supabase = createClient();
      const path = `${tenantSlug}/${postId}/${kind}-${Date.now()}-${slugifyName(file.name)}`;
      const { error: upErr } = await supabase.storage
        .from("blog-assets")
        .upload(path, file, { upsert: true, cacheControl: "3600", contentType: file.type });
      if (upErr) {
        setError(upErr.message);
        return;
      }
      const { data } = supabase.storage.from("blog-assets").getPublicUrl(path);
      onChange(data.publicUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm font-medium text-foreground">
          {label}
          {required && <span className="text-primary-500"> *</span>}
        </span>
        {value && !busy && (
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={disabled}
            className="text-[11px] text-text-muted hover:text-red-500 inline-flex items-center gap-1"
          >
            <X size={12} /> Remove
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={pick}
        disabled={disabled || busy}
        className={`relative w-full overflow-hidden rounded-lg border border-dashed border-border bg-sidebar/40 hover:bg-sidebar transition-colors flex items-center justify-center ${
          aspect === "square" ? "aspect-square w-full max-w-[88px]" : "aspect-[16/9]"
        }`}
      >
        {value ? (
          <Image src={value} alt={label} fill sizes="340px" className="object-cover" unoptimized />
        ) : (
          <span className="flex flex-col items-center gap-1 text-text-muted text-xs py-6">
            {busy ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}
            {busy ? "Uploading…" : "Click to upload"}
          </span>
        )}
      </button>

      {hint && !error && <p className="text-[11px] text-text-muted mt-1">{hint}</p>}
      {error && <p className="text-[11px] text-red-500 mt-1">{error}</p>}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
