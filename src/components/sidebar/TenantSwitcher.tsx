"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, LogOut, Settings, Check, Plus, Building2, User, Loader2 } from "lucide-react";
import type { TenantMembership } from "@/lib/auth";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/Toaster";
import { createWorkspace } from "@/app/(auth)/signup/actions";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface TenantSwitcherProps {
  tenants: TenantMembership[];
  currentSlug: string;
}

export function TenantSwitcher({ tenants, currentSlug }: TenantSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newType, setNewType] = useState<"startup" | "individual">("startup");
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [creating, startCreate] = useTransition();
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !newSlug.trim()) return;
    startCreate(async () => {
      const res = await createWorkspace({ name: newName, slug: newSlug, accountType: newType });
      // On success the action redirects; we only reach here on error.
      if (res?.error) toast.error(res.error);
    });
  }

  const current = tenants.find((t) => t.slug === currentSlug) ?? tenants[0];

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function switchTenant(slug: string) {
    document.cookie = `tenant=${slug};path=/;max-age=${60 * 60 * 24 * 365}`;
    setIsOpen(false);
    router.refresh();
  }

  async function signOut() {
    const supabase = createClient();
    // scope: 'local' — only this device. Default 'global' revokes every
    // refresh token for the user and signs them out everywhere.
    await supabase.auth.signOut({ scope: "local" });
    router.push("/login");
    router.refresh();
  }

  if (!current) return null;

  return (
    <div ref={ref} className="relative px-3 py-3 border-t border-white-200">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm transition-colors duration-200 cursor-pointer",
          "hover:bg-gray-50 outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30",
          isOpen && "bg-gray-50"
        )}
      >
        <span className="w-8 h-8 rounded-full bg-primary-50 text-primary-500 flex items-center justify-center text-xs [font-family:'Satoshi-700',var(--font-sans)] flex-shrink-0">
          {current.name.charAt(0).toUpperCase()}
        </span>
        <span className="flex-1 min-w-0 text-left">
          <span className="block truncate text-gray-1200 [font-family:'Satoshi-500',var(--font-sans)]">
            {current.name}
          </span>
          <span className="block truncate text-[11px] text-gray-1000 capitalize">{current.role}</span>
        </span>
        <ChevronDown
          size={14}
          className={cn("text-gray-400 transition-transform duration-200", isOpen && "rotate-180")}
        />
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-3 right-3 mb-2 bg-card border border-white-200 rounded-xl shadow-custom-100 overflow-hidden py-1">
          <p className="px-3 pt-2 pb-1 text-[10px] font-medium uppercase tracking-[0.14em] text-gray-400">
            Workspaces
          </p>
          {tenants.map((tenant) => (
            <button
              key={tenant.slug}
              onClick={() => switchTenant(tenant.slug)}
              className={cn(
                "flex items-center gap-3 w-full px-3 py-2 text-sm transition-colors duration-150 cursor-pointer",
                tenant.slug === currentSlug
                  ? "text-primary-500 bg-primary-50"
                  : "text-gray-1200 hover:bg-gray-50"
              )}
            >
              <span
                className={cn(
                  "w-6 h-6 rounded-full flex items-center justify-center text-[10px] flex-shrink-0",
                  "[font-family:'Satoshi-700',var(--font-sans)]",
                  tenant.slug === currentSlug
                    ? "bg-primary-500 text-white"
                    : "bg-gray-100 text-gray-1200"
                )}
              >
                {tenant.name.charAt(0).toUpperCase()}
              </span>
              <span className="truncate flex-1 text-left">{tenant.name}</span>
              <span className="text-gray-1000 text-[11px] ml-auto capitalize">{tenant.role}</span>
              {tenant.slug === currentSlug && <Check size={12} className="text-primary-500" />}
            </button>
          ))}

          <div className="border-t border-white-200 mt-1 pt-1">
            <button
              onClick={() => {
                setIsOpen(false);
                setShowCreate(true);
              }}
              className="flex items-center gap-3 w-full px-3 py-2 text-sm text-gray-1200 hover:bg-gray-50 transition-colors duration-150 cursor-pointer"
            >
              <Plus size={14} className="text-gray-500" />
              <span>Create workspace</span>
            </button>
            <Link
              href="/settings"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-3 w-full px-3 py-2 text-sm text-gray-1200 hover:bg-gray-50 transition-colors duration-150 cursor-pointer"
            >
              <Settings size={14} className="text-gray-500" />
              <span>Settings</span>
            </Link>
            <button
              onClick={signOut}
              className="flex items-center gap-3 w-full px-3 py-2 text-sm text-gray-1200 hover:bg-gray-50 transition-colors duration-150 cursor-pointer"
            >
              <LogOut size={14} className="text-gray-500" />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      )}

      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#000000B3] backdrop-blur-sm p-4"
          onClick={() => setShowCreate(false)}
        >
          <form
            onSubmit={handleCreate}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-white-200 bg-card p-6 shadow-custom-100"
          >
            <h2 className="text-lg font-bold text-gray-1100 [font-family:'Satoshi-700',var(--font-sans)]">
              Create a workspace
            </h2>
            <p className="mt-1 text-sm text-gray-1000">
              Pick the kind of account — it tailors your setup and tools.
            </p>

            {/* Account type */}
            <input type="hidden" name="accountType" value={newType} />
            <div className="mt-4 grid grid-cols-2 gap-3">
              {([
                { key: "startup", Icon: Building2, title: "Startup", blurb: "Full marketing OS — SEO, content, ads, outbound." },
                { key: "individual", Icon: User, title: "Individual", blurb: "Personal posting cadence — draft, post, keep your streak." },
              ] as const).map(({ key, Icon, title, blurb }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setNewType(key)}
                  aria-pressed={newType === key}
                  className={cn(
                    "rounded-xl border p-3 text-left transition",
                    newType === key
                      ? "border-primary-500 bg-primary-50"
                      : "border-white-200 hover:border-gray-400"
                  )}
                >
                  <Icon className={cn("size-5", newType === key ? "text-primary-500" : "text-gray-1000")} />
                  <span className="mt-2 block text-sm font-bold text-gray-1100">{title}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-gray-1000">{blurb}</span>
                </button>
              ))}
            </div>

            <div className="mt-4 flex flex-col gap-3">
              <div>
                <label htmlFor="ws-name" className="mb-1 block text-sm text-gray-1000">
                  {newType === "individual" ? "Your name" : "Workspace name"}
                </label>
                <input
                  id="ws-name"
                  name="name"
                  value={newName}
                  onChange={(e) => {
                    setNewName(e.target.value);
                    if (!slugEdited) setNewSlug(slugify(e.target.value));
                  }}
                  required
                  className="w-full rounded-lg border border-white-200 bg-card px-3 py-2 text-base text-gray-1200 outline-none focus-visible:ring-[3px] focus-visible:ring-blue-500/30"
                />
              </div>
              <div>
                <label htmlFor="ws-slug" className="mb-1 block text-sm text-gray-1000">
                  Handle
                </label>
                <input
                  id="ws-slug"
                  name="slug"
                  value={newSlug}
                  onChange={(e) => {
                    setSlugEdited(true);
                    setNewSlug(slugify(e.target.value));
                  }}
                  required
                  placeholder="acme"
                  className="w-full rounded-lg border border-white-200 bg-card px-3 py-2 text-base text-gray-1200 outline-none focus-visible:ring-[3px] focus-visible:ring-blue-500/30"
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" size="sm" variant="tertiary" disabled={creating} onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={creating || !newName || !newSlug}>
                {creating ? (
                  <>
                    <Loader2 className="animate-spin" /> Creating…
                  </>
                ) : (
                  "Create & set up"
                )}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
