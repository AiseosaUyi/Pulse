"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bookmark, Workflow } from "lucide-react";

const TABS = [
  { href: "/content-vault/saved", label: "Extracts", Icon: Bookmark },
  { href: "/content-vault/pipeline", label: "Pipeline", Icon: Workflow },
];

export function ContentVaultTabs() {
  const path = usePathname() ?? "";
  return (
    <nav className="border-b border-border mb-6 -mx-4 md:mx-0">
      <ul className="flex items-center gap-1 px-4 md:px-0">
        {TABS.map(({ href, label, Icon }) => {
          const active = path === href || path.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                className={`flex items-center gap-2 px-3 py-2.5 text-sm border-b-2 -mb-px transition-colors whitespace-nowrap ${
                  active
                    ? "border-primary-500 text-foreground"
                    : "border-transparent text-text-muted hover:text-foreground"
                }`}
              >
                <Icon size={14} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
