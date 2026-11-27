export interface SegmentConfig {
  proof: string[];
  offer: string[];
  ask: string[];
}

export interface OutreachVentureConfig {
  workspace: string;
  tenantSlug: string;
  defaultSegment: string;
  segments: Record<string, SegmentConfig>;
  bannedRegex: string;
  promiseRegex: string;
  badSubjectRegex: string;
  verdictRegex: string;
  wordLimits: {
    subject: [number, number];
    hook: [number, number];
    idea: [number, number];
  };
  signature: string;
  blockedCountries: string;
  ideaPrefix: string;
  createdAt: string;
  updatedAt: string;
}

export interface OutreachDraftMessage {
  prospectId: string;
  recipientEmail?: string | null;
  recipientHandle?: string | null;
  subject: string;
  body: string;
  segment: string;
  hasNamedContact: boolean;
  warnings: string[];
}

export interface OutreachBatch {
  batchNumber: number;
  drafts: OutreachDraftMessage[];
  wordCountStats: {
    min: number;
    avg: number;
    max: number;
  };
}
