"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ExternalLink, FileVideo, ImageIcon } from "lucide-react";
import { useDialogs } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/Toaster";
import {
  deleteContentItem,
  markPosted as markPostedAction,
} from "@/lib/actions/content-pipeline";
import type {
  ContentItemFilters,
  ContentItemWithDisplay,
  ContentType,
} from "@/lib/types/content-pipeline";
import { StatusPill } from "./StatusPill";
import { PlatformBadges } from "./PlatformBadges";
import { RowActionsMenu } from "./RowActionsMenu";
import { BulkActionBar } from "./BulkActionBar";
import { EditItemModal } from "./EditItemModal";
import { InlineTypePicker } from "./InlineTypePicker";
import { InlineSchedulePicker } from "./InlineSchedulePicker";
import { InlineAssigneePicker } from "./InlineAssigneePicker";
import { DownloadButton } from "./DownloadButton";

interface Props {
  items: ContentItemWithDisplay[];
  contentTypes: ContentType[];
  members: Array<{ id: string; name: string; avatarUrl: string | null }>;
  nextCursor: ContentItemFilters["cursor"] | null;
}

function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fileIcon(mime: string | null) {
  if (!mime) return ImageIcon;
  if (mime.startsWith("video/")) return FileVideo;
  return ImageIcon;
}

export function ContentTable({
  items,
  contentTypes,
  members,
  nextCursor,
}: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const dialogs = useDialogs();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyBulk, setBusyBulk] = useState(false);
  const [editingItem, setEditingItem] = useState<ContentItemWithDisplay | null>(
    null
  );
  // Optimistic-hide set. IDs added here disappear from the table
  // immediately while the server delete is in flight; on failure we
  // restore by removing the ID. Also covers the "still showing for
  // a few seconds" issue — the row vanishes the instant the user
  // confirms.
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const visibleItems = useMemo(
    () => items.filter((i) => !hiddenIds.has(i.id)),
    [items, hiddenIds]
  );

  // Drop selection ids that are no longer in the visible list (after
  // load-more or filter changes).
  const visibleIds = useMemo(
    () => new Set(visibleItems.map((i) => i.id)),
    [visibleItems]
  );
  const selectedActive = useMemo(
    () => new Set([...selected].filter((id) => visibleIds.has(id))),
    [selected, visibleIds]
  );

  if (visibleItems.length === 0) {
    return (
      <div className="bg-card border border-dashed border-border rounded-2xl p-10 text-center">
        <p className="text-foreground font-semibold mb-1">No content yet</p>
        <p className="text-text-muted text-sm">
          Drag files into the upload zone above, or paste a Drive link to
          import existing content.
        </p>
      </div>
    );
  }

  const allChecked =
    visibleItems.length > 0 &&
    visibleItems.every((i) => selectedActive.has(i.id));
  const someChecked = selectedActive.size > 0 && !allChecked;

  const toggleAll = () => {
    if (allChecked) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visibleItems.map((i) => i.id)));
    }
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onBulkMarkPosted = async () => {
    const ids = [...selectedActive];
    if (ids.length === 0) return;
    const ok = await dialogs.confirm({
      title: `Mark ${ids.length} item${ids.length === 1 ? "" : "s"} as posted?`,
      subtitle: "Status will switch to Posted.",
      confirmLabel: "Mark posted",
    });
    if (!ok) return;
    setBusyBulk(true);
    let okCount = 0;
    let failCount = 0;
    for (const id of ids) {
      const r = await markPostedAction(id);
      if (r.ok) okCount++;
      else failCount++;
    }
    setBusyBulk(false);
    setSelected(new Set());
    if (okCount > 0) {
      toast.success(
        `Marked ${okCount} as posted${
          failCount > 0 ? ` (${failCount} failed)` : ""
        }`
      );
    } else {
      toast.error("Couldn't mark items as posted");
    }
    router.refresh();
  };

  const onBulkDelete = async () => {
    const ids = [...selectedActive];
    if (ids.length === 0) return;
    const ok = await dialogs.confirm({
      title: `Delete ${ids.length} item${ids.length === 1 ? "" : "s"}?`,
      subtitle:
        "Pulse rows will be removed. The original Drive files stay in your team's Drive folder.",
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (!ok) return;
    // Optimistic hide
    setHiddenIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
    setSelected(new Set());
    setBusyBulk(true);
    const failed: string[] = [];
    for (const id of ids) {
      const r = await deleteContentItem(id);
      if (!r.ok) failed.push(id);
    }
    setBusyBulk(false);
    if (failed.length > 0) {
      // Restore the failed rows
      setHiddenIds((prev) => {
        const next = new Set(prev);
        failed.forEach((id) => next.delete(id));
        return next;
      });
      toast.error(
        `${failed.length} delete${failed.length === 1 ? "" : "s"} failed`,
        ids.length - failed.length > 0
          ? `Removed ${ids.length - failed.length} successfully`
          : undefined
      );
    } else {
      toast.success(
        `Deleted ${ids.length} item${ids.length === 1 ? "" : "s"}`
      );
    }
    router.refresh();
  };

  const onRowDelete = async (item: ContentItemWithDisplay) => {
    const ok = await dialogs.confirm({
      title: "Delete this item?",
      subtitle: `"${item.title}" will be removed from Pulse. The Drive file stays in your team's folder.`,
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (!ok) return;
    // Optimistically remove the row immediately so the UI feels
    // responsive — no "still showing for a few seconds" gap.
    setHiddenIds((prev) => new Set(prev).add(item.id));
    const res = await deleteContentItem(item.id);
    if (!res.ok) {
      // Restore the row
      setHiddenIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      toast.error("Couldn't delete", res.error);
      return;
    }
    toast.success("Deleted");
    router.refresh();
  };

  const onRowMarkPosted = async (item: ContentItemWithDisplay) => {
    const res = await markPostedAction(item.id);
    if (!res.ok) {
      toast.error("Couldn't mark posted", res.error);
      return;
    }
    toast.success("Marked as posted");
    router.refresh();
  };

  const loadMore = () => {
    if (!nextCursor) return;
    const next = new URLSearchParams(params?.toString());
    next.set("cursor", `${nextCursor.createdAt}|${nextCursor.id}`);
    router.push(`?${next.toString()}`);
  };

  return (
    <>
      <BulkActionBar
        selectedCount={selectedActive.size}
        onClear={() => setSelected(new Set())}
        onMarkPosted={onBulkMarkPosted}
        onDelete={onBulkDelete}
        busy={busyBulk}
      />

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          {/* min-w keeps each column at a comfortable width on mobile;
           * the wrapper scrolls horizontally so users swipe through
           * columns instead of seeing every cell crushed. */}
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-border bg-gray-50 dark:bg-gray-900/50">
                <Th className="w-10">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    ref={(el) => {
                      if (el) el.indeterminate = someChecked;
                    }}
                    onChange={toggleAll}
                    className="rounded border-border accent-primary-500 cursor-pointer"
                    aria-label="Select all rows"
                  />
                </Th>
                {/* Title header spans thumbnail + title cells so the
                 * "Title" label sits directly above the thumbnail and
                 * the column reads as one connected unit. */}
                <Th colSpan={2}>Title</Th>
                <Th>Type</Th>
                <Th>Platforms</Th>
                <Th>Status</Th>
                <Th>Scheduled</Th>
                <Th>Assigned</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((item) => {
                const Icon = fileIcon(item.driveMimeType);
                const missing = item.driveStatus !== "ok";
                const checked = selectedActive.has(item.id);
                return (
                  <tr
                    key={item.id}
                    className={`border-b border-border last:border-0 ${
                      missing ? "bg-red-50/50 dark:bg-red-950/20" : ""
                    } ${checked ? "bg-primary-50/40" : ""}`}
                  >
                    {/* Checkbox column — also serves as the bulk select handle */}
                    <Td>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleOne(item.id)}
                        className="rounded border-border accent-primary-500 cursor-pointer"
                        aria-label={`Select ${item.title}`}
                      />
                    </Td>
                    {/* Thumbnail column — sits flush against the title
                     * cell (no right padding here, no left padding on
                     * Title) so the thumb visually anchors the title. */}
                    <Td className="pr-0">
                      <div className="relative group">
                        {item.thumbnailUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.thumbnailUrl}
                            alt=""
                            className="w-10 h-10 rounded-lg object-cover bg-gray-100"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-text-muted">
                            <Icon size={16} />
                          </div>
                        )}
                      </div>
                    </Td>
                    <Td className="pl-2">
                      <div className="font-medium text-foreground line-clamp-1 max-w-[200px]">
                        {item.title}
                      </div>
                      {missing ? (
                        <div className="text-xs text-red-600 mt-0.5">
                          {item.driveStatus === "missing"
                            ? "Missing in Drive"
                            : "Permission lost"}
                        </div>
                      ) : item.driveSizeBytes ? (
                        <div className="text-xs text-text-muted mt-0.5">
                          {formatSize(item.driveSizeBytes)}
                        </div>
                      ) : null}
                    </Td>
                    {/* Type — click to change */}
                    <Td>
                      <InlineTypePicker
                        itemId={item.id}
                        value={item.contentTypeSlug}
                        label={item.contentTypeLabel}
                        contentTypes={contentTypes}
                      />
                    </Td>
                    <Td>
                      <PlatformBadges platforms={item.platforms} />
                    </Td>
                    <Td>
                      <StatusPill itemId={item.id} status={item.status} />
                    </Td>
                    <Td>
                      <InlineSchedulePicker
                        itemId={item.id}
                        scheduledAt={item.scheduledAt}
                      />
                    </Td>
                    {/* Assigned — click avatar/icon to open picker */}
                    <Td>
                      <InlineAssigneePicker
                        itemId={item.id}
                        assignedTo={item.assignedTo}
                        assignedToFirstName={item.assignedToFirstName}
                        assignedToAvatarUrl={item.assignedToAvatarUrl}
                        members={members}
                      />
                    </Td>
                    <Td>
                      <div className="flex items-center justify-end gap-0.5">
                        <Link
                          href={
                            item.driveWebViewLink ??
                            `https://drive.google.com/file/d/${item.driveFileId}/view`
                          }
                          target="_blank"
                          className="p-1.5 rounded-md text-text-muted hover:text-foreground hover:bg-gray-100 dark:hover:bg-gray-800"
                          title="Open in Drive"
                        >
                          <ExternalLink size={14} />
                        </Link>
                        <DownloadButton
                          fileId={item.driveFileId}
                          filename={item.title}
                        />
                        <RowActionsMenu
                          isPosted={item.status === "posted"}
                          onEdit={() => setEditingItem(item)}
                          onMarkPosted={() => onRowMarkPosted(item)}
                          onDelete={() => onRowDelete(item)}
                        />
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {nextCursor ? (
          <div className="border-t border-border p-3 text-center">
            <Button type="button" variant="outline" size="sm" onClick={loadMore}>
              Load more
            </Button>
          </div>
        ) : null}
      </div>

      {editingItem ? (
        <EditItemModal
          item={editingItem}
          contentTypes={contentTypes}
          members={members}
          onClose={() => setEditingItem(null)}
        />
      ) : null}
    </>
  );
}

function Th({
  children,
  className = "",
  colSpan,
}: {
  children?: React.ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <th
      colSpan={colSpan}
      className={`text-left text-xs font-medium text-text-muted px-3 py-2.5 ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={`px-3 py-2.5 align-middle ${className}`}>{children}</td>
  );
}
