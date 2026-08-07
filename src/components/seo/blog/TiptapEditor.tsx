"use client";

// WYSIWYG editor wrapper. Accepts either a TipTap JSON doc or a
// markdown string (for lazy migration of pre-Phase-D posts) and emits
// { json, markdown, wordCount } on change. Keeping markdown as an
// export mirror means anything downstream that reads `content` (RSS,
// SEO preview, external publishers) keeps working.

import { useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { Markdown } from "tiptap-markdown";
import type { JSONContent } from "@tiptap/core";
import {
  Bold as BoldIcon,
  Italic as ItalicIcon,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Link as LinkIcon,
  Table as TableIconLucide,
  Quote,
  Undo2,
  Redo2,
  ImagePlus,
  Loader2,
} from "lucide-react";
import { countWords } from "@/lib/blog/word-count";
import { useDialogs } from "@/components/ui/Dialog";
import { toast } from "@/components/ui/Toaster";
import { createClient } from "@/lib/supabase/client";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function slugifyFileName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "");
}

export interface TiptapChange {
  json: JSONContent;
  markdown: string;
  wordCount: number;
}

// A link mark with a null/empty href crashes the markdown serializer
// (prosemirror-markdown calls `href.replace(...)`), which previously
// corrupted posts whose stored content_json contained such marks. Harden
// the href attribute so it can never be null — absent/empty resolves to ""
// and we omit the attribute entirely when rendering an empty href.
const SafeLink = Link.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      href: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("href") || "",
        renderHTML: (attrs: { href?: string | null }) =>
          attrs.href ? { href: attrs.href } : {},
      },
    };
  },
});

// Recursively drop link marks that have no usable href before the doc ever
// reaches the editor. Keeps the text, removes only the bogus mark.
function sanitizeLinkMarks(node: JSONContent): JSONContent {
  const cleaned: JSONContent = { ...node };
  if (Array.isArray(node.marks)) {
    cleaned.marks = node.marks.filter(
      (m) =>
        m.type !== "link" ||
        (typeof m.attrs?.href === "string" && m.attrs.href.trim() !== "")
    );
  }
  if (Array.isArray(node.content)) {
    cleaned.content = node.content.map(sanitizeLinkMarks);
  }
  return cleaned;
}

interface Props {
  /** TipTap JSON doc, preferred when present. */
  initialJson: JSONContent | null;
  /** Markdown fallback, used when `initialJson` is null (pre-Phase-D). */
  initialMarkdown: string;
  placeholder?: string;
  disabled?: boolean;
  onChange?: (c: TiptapChange) => void;
  /** Needed to scope inline-image uploads to `{tenantSlug}/{postId}/...` in the blog-assets bucket. */
  tenantSlug?: string;
  postId?: string;
}

// tiptap-markdown augments the editor's storage; we reach into it
// typed-narrow rather than widening globals.
type MarkdownStorage = { getMarkdown(): string };

function getMarkdown(editor: ReturnType<typeof useEditor>): string {
  if (!editor) return "";
  const storage = (editor.storage as unknown as Record<string, unknown>)
    .markdown as MarkdownStorage | undefined;
  return storage?.getMarkdown() ?? "";
}

export function TiptapEditor({
  initialJson,
  initialMarkdown,
  placeholder,
  disabled,
  onChange,
  tenantSlug,
  postId,
}: Props) {
  // Keep the latest callback in a ref so the editor config doesn't
  // need to re-initialize on every parent re-render.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Decide once what to seed the editor with. If we have JSON, use it.
  // Otherwise let tiptap-markdown parse the markdown string.
  const initialContent = useMemo<JSONContent | string>(() => {
    if (initialJson) return sanitizeLinkMarks(initialJson);
    return initialMarkdown ?? "";
  }, [initialJson, initialMarkdown]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        link: false,
      }),
      SafeLink.configure({
        openOnClick: false,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
      Image,
      Placeholder.configure({
        placeholder: placeholder ?? "Start writing…",
      }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({
        html: false,
        linkify: true,
        breaks: false,
      }),
    ],
    content: initialContent,
    editable: !disabled,
    editorProps: {
      attributes: {
        class: "tiptap-content min-h-[420px] px-4 py-4 focus:outline-none",
      },
    },
    // React 19 strict-mode double-renders; this silences the warning.
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      const md = getMarkdown(editor);
      onChangeRef.current?.({
        // Deep-clone: ProseMirror/tiptap-markdown can intern the same mark
        // attrs object across multiple nodes (e.g. several links parsed from
        // the initial markdown share one `attrs` reference). Passing that
        // aliasing through the Server Action boundary makes Next.js's action
        // serializer emit a backreference for every repeat occurrence, which
        // resolves server-side to an empty attrs object — silently dropping
        // every link's href on save. A deep clone gives each mark its own
        // independent, fully-inlined attrs object before it leaves the client.
        json: JSON.parse(JSON.stringify(editor.getJSON())),
        markdown: md,
        wordCount: countWords(md),
      });
    },
  });

  // Mirror disabled state without remounting the editor.
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [disabled, editor]);

  if (!editor) {
    // Reserve the same total height as the loaded state (toolbar strip +
    // min-h-[420px] content) so nothing below this editor — including the
    // page's own toolbar buttons — shifts position once `editor` becomes
    // non-null. A bare min-h-[420px] placeholder here used to be ~44px
    // shorter than the real Toolbar+EditorContent, causing a layout jump
    // right as the page finished mounting — exactly the window where a
    // fast click could land on the wrong button.
    return (
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="h-11 border-b border-border/30 bg-sidebar/40" />
        <div className="min-h-[420px]" />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <Toolbar editor={editor} disabled={disabled} tenantSlug={tenantSlug} postId={postId} />
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({
  editor,
  disabled,
  tenantSlug,
  postId,
}: {
  editor: NonNullable<ReturnType<typeof useEditor>>;
  disabled?: boolean;
  tenantSlug?: string;
  postId?: string;
}) {
  const dialogs = useDialogs();
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const btn = (active: boolean) =>
    `h-8 w-8 inline-flex items-center justify-center rounded-md transition-colors ${
      active
        ? "bg-primary-500/15 text-primary-500"
        : "text-text-muted hover:bg-sidebar hover:text-foreground"
    }`;

  const handleLink = async () => {
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = await dialogs.prompt({
      title: "Add or edit link",
      subtitle: "Paste a URL. Leave blank to remove the current link.",
      icon: LinkIcon,
      defaultValue: previous ?? "",
      placeholder: "https://example.com",
      confirmLabel: "Apply link",
    });
    if (url === null) return;
    const trimmed = url.trim();
    if (trimmed === "") {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: trimmed })
      .run();
  };

  const handleTable = () => {
    editor
      .chain()
      .focus()
      .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
      .run();
  };

  const handleImageFile = async (file: File) => {
    if (!tenantSlug || !postId) {
      toast.error("Save the post before adding images.");
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error("Image must be under 10 MB.");
      return;
    }
    // tiptap-markdown's table-cell serializer only extracts plain text —
    // an image nested inside a cell silently serializes to an empty cell
    // in the markdown mirror (verified directly against the library).
    // Since `content` (not content_json) is what publishing actually
    // converts to Contentful RichText, an in-cell image would vanish from
    // the published post while still looking fine in the editor. Block it
    // here instead of losing it silently — the image can go right after
    // the table just as well.
    if (editor.isActive("table")) {
      toast.error(
        "Images can't be added inside a table cell — they'll disappear when published. Place your cursor outside the table first."
      );
      return;
    }
    setUploadingImage(true);
    try {
      const supabase = createClient();
      const path = `${tenantSlug}/${postId}/content-${Date.now()}-${slugifyFileName(file.name)}`;
      const { error } = await supabase.storage
        .from("blog-assets")
        .upload(path, file, { upsert: true, cacheControl: "3600", contentType: file.type });
      if (error) {
        toast.error(error.message);
        return;
      }
      const { data } = supabase.storage.from("blog-assets").getPublicUrl(path);
      editor.chain().focus().setImage({ src: data.publicUrl, alt: file.name }).run();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadingImage(false);
    }
  };

  return (
    <div
      className={`flex items-center gap-1 px-2 py-1.5 border-b border-border/30 bg-sidebar/40 ${
        disabled ? "pointer-events-none opacity-60" : ""
      }`}
    >
      <button
        type="button"
        className={btn(editor.isActive("bold"))}
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="Bold"
      >
        <BoldIcon size={15} />
      </button>
      <button
        type="button"
        className={btn(editor.isActive("italic"))}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="Italic"
      >
        <ItalicIcon size={15} />
      </button>
      <div className="w-px h-5 bg-border mx-1" />
      <button
        type="button"
        className={btn(editor.isActive("heading", { level: 2 }))}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        title="Heading 2"
      >
        <Heading2 size={15} />
      </button>
      <button
        type="button"
        className={btn(editor.isActive("heading", { level: 3 }))}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        title="Heading 3"
      >
        <Heading3 size={15} />
      </button>
      <div className="w-px h-5 bg-border mx-1" />
      <button
        type="button"
        className={btn(editor.isActive("bulletList"))}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        title="Bullet list"
      >
        <List size={15} />
      </button>
      <button
        type="button"
        className={btn(editor.isActive("orderedList"))}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        title="Numbered list"
      >
        <ListOrdered size={15} />
      </button>
      <button
        type="button"
        className={btn(editor.isActive("blockquote"))}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        title="Blockquote"
      >
        <Quote size={15} />
      </button>
      <div className="w-px h-5 bg-border mx-1" />
      <button
        type="button"
        className={btn(editor.isActive("link"))}
        onClick={handleLink}
        title="Link"
      >
        <LinkIcon size={15} />
      </button>
      <button
        type="button"
        className={btn(false)}
        onClick={handleTable}
        title="Insert table"
      >
        <TableIconLucide size={15} />
      </button>
      <button
        type="button"
        className={btn(false)}
        onClick={() => imageInputRef.current?.click()}
        disabled={uploadingImage}
        title="Insert image"
      >
        {uploadingImage ? (
          <Loader2 size={15} className="animate-spin" />
        ) : (
          <ImagePlus size={15} />
        )}
      </button>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleImageFile(file);
          e.target.value = "";
        }}
      />
      <div className="flex-1" />
      <button
        type="button"
        className={btn(false)}
        onClick={() => editor.chain().focus().undo().run()}
        title="Undo"
        disabled={!editor.can().undo()}
      >
        <Undo2 size={15} />
      </button>
      <button
        type="button"
        className={btn(false)}
        onClick={() => editor.chain().focus().redo().run()}
        title="Redo"
        disabled={!editor.can().redo()}
      >
        <Redo2 size={15} />
      </button>
    </div>
  );
}
