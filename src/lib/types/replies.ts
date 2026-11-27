export type ProspectReplyStatus = "interested" | "declined" | "dormant" | "closed";

export interface ProspectReplyEntry {
  id: string;
  workspace: string;
  tenantSlug: string;
  prospectId: string | null;
  repliedAt: string;
  channel: string;
  quote: string;
  status: ProspectReplyStatus;
  nextStep: string | null;
  missingCapability: string | null;
  createdAt: string;
}

export interface RecordReplyInput {
  prospectId?: string | null;
  repliedAt?: string;
  channel: string;
  quote: string;
  status: ProspectReplyStatus;
  nextStep?: string | null;
  missingCapability?: string | null;
}

export interface MissingCapabilityInsight {
  capability: string;
  count: number;
  latestQuote: string;
  latestRepliedAt: string;
  channels: string[];
}
