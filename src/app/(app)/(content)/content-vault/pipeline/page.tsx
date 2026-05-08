import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import {
  listContentItems,
  listContentSections,
  listContentTypes,
  listAssignableMembers,
} from "@/lib/services/content-pipeline";
import { getDriveConnectionStatus } from "@/lib/services/drive-connections";
import { getCurrentTenant } from "@/lib/auth";
import { PipelineClient } from "./_components/PipelineClient";
import { ConnectDrivePrompt } from "./_components/ConnectDrivePrompt";
import type {
  ContentItemFilters,
  ContentItemStatus,
  ContentPlatform,
} from "@/lib/types/content-pipeline";

interface PageProps {
  searchParams: Promise<{
    section?: string;
    status?: string;
    platform?: string;
    type?: string;
    assignee?: string;
    cursor?: string;
  }>;
}

const STATUS_VALUES: ContentItemStatus[] = [
  "not_posted",
  "scheduled",
  "posted",
  "archived",
  "draft",
];

const PLATFORM_VALUES: ContentPlatform[] = [
  "instagram",
  "tiktok",
  "linkedin",
  "x",
  "facebook",
  "whatsapp",
  "email",
];

export default async function PipelinePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const tenant = await getCurrentTenant();
  if (!tenant) redirect("/signup?step=company");

  const driveStatus = await getDriveConnectionStatus(tenant.slug);
  if (!driveStatus.connected) {
    return <ConnectDrivePrompt />;
  }

  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? tenant.slug;

  const [sections, types, members] = await Promise.all([
    listContentSections(tenantSlug),
    listContentTypes(tenantSlug),
    listAssignableMembers(tenantSlug),
  ]);

  if (sections.length === 0) {
    // Connection exists but section bootstrap failed — surface a
    // gentle nudge to reconnect.
    return <ConnectDrivePrompt missingSections />;
  }

  const sectionSlug = params.section ?? sections[0].slug;

  const filters: ContentItemFilters = {
    sectionSlug,
    status: STATUS_VALUES.includes(params.status as ContentItemStatus)
      ? (params.status as ContentItemStatus)
      : undefined,
    platform: PLATFORM_VALUES.includes(params.platform as ContentPlatform)
      ? (params.platform as ContentPlatform)
      : undefined,
    contentTypeSlug: params.type,
    assignedTo: params.assignee,
    limit: 50,
  };
  if (params.cursor) {
    const [createdAt, id] = params.cursor.split("|");
    if (createdAt && id) filters.cursor = { createdAt, id };
  }

  const { items, nextCursor } = await listContentItems(tenantSlug, filters);

  return (
    <PipelineClient
      tenantSlug={tenantSlug}
      sections={sections}
      contentTypes={types}
      members={members}
      activeSectionSlug={sectionSlug}
      filters={filters}
      items={items}
      nextCursor={nextCursor}
    />
  );
}
