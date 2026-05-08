"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  ContentItemFilters,
  ContentItemWithDisplay,
  ContentSection,
  ContentType,
} from "@/lib/types/content-pipeline";
import { SectionTabs } from "./SectionTabs";
import { FilterBar } from "./FilterBar";
import { ContentTable } from "./ContentTable";
import { UploadModal } from "./UploadModal";
import { ImportFromDriveButton } from "./ImportFromDriveButton";

interface Props {
  tenantSlug: string;
  sections: ContentSection[];
  contentTypes: ContentType[];
  members: Array<{ id: string; name: string }>;
  activeSectionSlug: string;
  filters: ContentItemFilters;
  items: ContentItemWithDisplay[];
  nextCursor: ContentItemFilters["cursor"] | null;
}

export function PipelineClient({
  tenantSlug,
  sections,
  contentTypes,
  members,
  activeSectionSlug,
  items,
  nextCursor,
}: Props) {
  const [showUpload, setShowUpload] = useState(false);
  const [types, setTypes] = useState(contentTypes);

  // Upload modal owns the create-new-type flow now (per UX). Pipeline
  // just lifts the new row into shared state so the table dropdown
  // also sees it.
  const onTypeCreated = (created: ContentType) => {
    setTypes((prev) =>
      [...prev, created].sort((a, b) => a.label.localeCompare(b.label))
    );
  };

  return (
    <>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <SectionTabs sections={sections} activeSlug={activeSectionSlug} />
        <FilterBar contentTypes={types} />
        <div className="ml-auto flex items-center gap-2">
          <ImportFromDriveButton
            sections={sections}
            defaultSectionSlug={activeSectionSlug}
          />
          <Button type="button" onClick={() => setShowUpload(true)}>
            <Upload size={14} className="mr-1.5" />
            Upload
          </Button>
        </div>
      </div>

      <ContentTable
        items={items}
        contentTypes={types}
        members={members}
        nextCursor={nextCursor}
      />

      {showUpload ? (
        <UploadModal
          tenantSlug={tenantSlug}
          sections={sections}
          contentTypes={types}
          members={members}
          activeSectionSlug={activeSectionSlug}
          onClose={() => setShowUpload(false)}
          onTypeCreated={onTypeCreated}
        />
      ) : null}
    </>
  );
}
