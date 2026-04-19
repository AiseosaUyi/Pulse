"use client";

// WYSIWYG editor wrapper. Accepts either a TipTap JSON doc or a
// markdown string (for lazy migration of pre-Phase-D posts) and emits
// { json, markdown, wordCount } on change. Keeping markdown as an
// export mirror means anything downstream that reads `content` (RSS,
// SEO preview, external publishers) keeps working.

import { useEffect, useMemo, useRef } from "react";
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
} from "lucide-react";
import { countWords } from "@/lib/blog/word-count";
import { useDialogs } from "@/components/ui/Dialog";

export interface TiptapChange {
  json: JSONContent;
  markdown: string;
  wordCount: number;
}

interface Props {
  /** TipTap JSON doc, preferred when present. */
  initialJson: JSONContent | null;
  /** Markdown fallback, used when `initialJson` is null (pre-Phase-D). */
  initialMarkdown: string;
  placeholder?: string;
  disabled?: boolean;
  onChange?: (c: TiptapChange) => void;
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
    if (initialJson) return initialJson;
    return initialMarkdown ?? "";
  }, [initialJson, initialMarkdown]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        link: false,
      }),
      Link.configure({
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
        json: editor.getJSON(),
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
    return (
      <div className="rounded-lg border border-border bg-card min-h-[420px]" />
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <Toolbar editor={editor} disabled={disabled} />
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({
  editor,
  disabled,
}: {
  editor: NonNullable<ReturnType<typeof useEditor>>;
  disabled?: boolean;
}) {
  const dialogs = useDialogs();
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
