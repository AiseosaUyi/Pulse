"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/button";
import { saveAvatarUrl } from "@/app/(app)/settings/actions";
import { cn } from "@/lib/utils";

interface AvatarUploadProps {
  userId: string;
  currentUrl: string | null;
  displayName: string;
}

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];

export function AvatarUpload({ userId, currentUrl, displayName }: AvatarUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentUrl);

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ALLOWED.includes(file.type)) {
      setStatus({ success: false, message: "JPG, PNG, WEBP, or GIF only" });
      return;
    }
    if (file.size > MAX_BYTES) {
      setStatus({ success: false, message: "Max 2 MB" });
      return;
    }

    setStatus(null);
    const localPreview = URL.createObjectURL(file);
    setPreviewUrl(localPreview);

    startTransition(async () => {
      const supabase = createClient();
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
      const path = `${userId}/avatar-${Date.now()}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: false, cacheControl: "3600", contentType: file.type });

      if (uploadErr) {
        setStatus({ success: false, message: uploadErr.message });
        setPreviewUrl(currentUrl);
        return;
      }

      const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(path);
      const res = await saveAvatarUrl(publicUrl);
      if (!res.success) {
        setStatus({ success: false, message: res.message });
        return;
      }

      setPreviewUrl(publicUrl);
      setStatus({ success: true, message: "Avatar updated" });
      router.refresh();
    });
  }

  async function onRemove() {
    startTransition(async () => {
      const res = await saveAvatarUrl(null);
      if (!res.success) {
        setStatus({ success: false, message: res.message });
        return;
      }
      setPreviewUrl(null);
      setStatus({ success: true, message: "Avatar removed" });
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-4">
      <Avatar url={previewUrl} name={displayName} size="lg" />

      <div className="flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            type="button"
            variant="tertiary"
            size="xs"
            onClick={() => inputRef.current?.click()}
            disabled={pending}
          >
            <Camera size={12} />
            {pending ? "Uploading…" : previewUrl ? "Change" : "Upload"}
          </Button>
          {previewUrl && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={onRemove}
              disabled={pending}
              className="text-gray-1000 hover:text-error-500"
            >
              <Trash2 size={12} />
              Remove
            </Button>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
            onChange={onFileChange}
            className="hidden"
          />
        </div>
        <p className="text-xs text-gray-500 mt-1.5">JPG, PNG, WEBP, or GIF — max 2 MB.</p>
        {status && (
          <p
            className={cn(
              "text-xs mt-1",
              status.success ? "text-success-500" : "text-error-500"
            )}
          >
            {status.message}
          </p>
        )}
      </div>
    </div>
  );
}
