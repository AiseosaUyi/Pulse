"use client";

// Compact "Ask the coach" trigger for the blog editor. Fires off a
// coach generation for the current post's score issues; result
// surfaces on the dashboard coach feed. Kept as its own component
// so the editor doesn't carry any more server-action imports.

import { useState, useTransition } from "react";
import { Sparkles, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDialogs } from "@/components/ui/Dialog";
import { coachForBlogPost } from "@/lib/actions/coach";

export function AskCoachButton({
  tenantSlug,
  blogPostId,
  disabled,
}: {
  tenantSlug: string;
  blogPostId: string;
  disabled?: boolean;
}) {
  const dialogs = useDialogs();
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  const handleClick = () => {
    startTransition(async () => {
      const res = await coachForBlogPost(tenantSlug, blogPostId);
      if (!res.success) {
        await dialogs.alert({
          title: "Coach couldn't generate actions",
          subtitle: res.error,
          tone: "warning",
        });
        return;
      }
      setDone(true);
      setTimeout(() => setDone(false), 2500);
      await dialogs.alert({
        title: `Added ${res.inserted} action${res.inserted === 1 ? "" : "s"} to your coach feed`,
        subtitle: "Open the dashboard to see what your AI team is working on.",
        tone: "success",
      });
    });
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleClick}
      disabled={disabled || isPending}
      className="gap-1.5"
      title="Generate coach actions from this post's score issues"
    >
      {isPending ? (
        <Loader2 size={14} className="animate-spin" />
      ) : done ? (
        <Check size={14} className="text-status-green" />
      ) : (
        <Sparkles size={14} />
      )}
      Ask coach
    </Button>
  );
}
