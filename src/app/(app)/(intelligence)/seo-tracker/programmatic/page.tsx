import { getCurrentTenant } from "@/lib/auth";
import {
  listProgrammaticTemplates,
  listProgrammaticPages,
} from "@/lib/services/programmatic";
import { ProgrammaticClient } from "./client";

export default async function ProgrammaticPage() {
  const tenant = await getCurrentTenant();
  const tenantSlug = tenant?.slug ?? "";

  const [templates, pages] = await Promise.all([
    listProgrammaticTemplates(tenantSlug),
    listProgrammaticPages(tenantSlug),
  ]);

  return (
    <div>
      <div className="mb-5">
        <p className="text-foreground font-semibold text-lg">Programmatic SEO</p>
        <p className="text-text-muted text-xs mt-0.5 max-w-[640px]">
          Write one template, generate hundreds of landing pages. Pattern
          variables (e.g. <code className="font-mono">{"{location}"}</code>,{" "}
          <code className="font-mono">{"{product}"}</code>) expand into a
          page per combination.
        </p>
      </div>
      <ProgrammaticClient
        tenantSlug={tenantSlug}
        templates={templates}
        pages={pages}
      />
    </div>
  );
}
