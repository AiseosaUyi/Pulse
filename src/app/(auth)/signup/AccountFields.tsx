"use client";

import { useState } from "react";
import { Building2, User } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const OPTIONS = [
  {
    key: "startup" as const,
    Icon: Building2,
    title: "Startup",
    blurb: "Full marketing OS — SEO, content, ads, outbound.",
  },
  {
    key: "individual" as const,
    Icon: User,
    title: "Individual",
    blurb: "Personal posting cadence — draft, post, keep your streak.",
  },
];

/**
 * Account-type picker + name/handle fields for signup. Submits `accountType`,
 * `companyName`, and `companySlug` (the signup/completeCompany actions read all
 * three). Labels adapt to the chosen persona.
 */
export function AccountFields() {
  const [type, setType] = useState<"startup" | "individual">("startup");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);

  const isIndividual = type === "individual";

  return (
    <div className="space-y-5">
      <input type="hidden" name="accountType" value={type} />

      <div>
        <Label>Account type</Label>
        <div className="mt-1.5 grid grid-cols-2 gap-3">
          {OPTIONS.map(({ key, Icon, title, blurb }) => (
            <button
              key={key}
              type="button"
              onClick={() => setType(key)}
              aria-pressed={type === key}
              className={cn(
                "rounded-xl border p-3 text-left transition",
                type === key ? "border-primary-500 bg-primary-50" : "border-white-200 hover:border-gray-400"
              )}
            >
              <Icon className={cn("size-5", type === key ? "text-primary-500" : "text-gray-1000")} />
              <span className="mt-2 block text-sm font-bold text-gray-1100">{title}</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-gray-1000">{blurb}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <Label htmlFor="su-cname">{isIndividual ? "Your name" : "Company name"}</Label>
        <Input
          id="su-cname"
          type="text"
          name="companyName"
          required
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugEdited) setSlug(slugify(e.target.value));
          }}
          placeholder={isIndividual ? "Ada Lovelace" : "Acme Co."}
        />
      </div>
      <div>
        <Label htmlFor="su-cslug">Handle</Label>
        <Input
          id="su-cslug"
          type="text"
          name="companySlug"
          required
          pattern="[a-z0-9-]+"
          value={slug}
          onChange={(e) => {
            setSlugEdited(true);
            setSlug(slugify(e.target.value));
          }}
          placeholder={isIndividual ? "ada" : "acme-co"}
        />
        <p className="mt-1 text-xs text-gray-500">Lowercase letters, numbers, and hyphens.</p>
      </div>
    </div>
  );
}
