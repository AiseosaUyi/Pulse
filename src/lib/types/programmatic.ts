export interface TemplateVariable {
  name: string;
  values: string[];
}

export interface ProgrammaticTemplateRecord {
  id: string;
  tenantSlug: string;
  name: string;
  titlePattern: string;
  urlPattern: string;
  metaDescriptionPattern: string | null;
  contentPrompt: string;
  targetWordCount: number;
  variables: TemplateVariable[];
  createdAt: string;
  updatedAt: string;
  pageCount: number;
}

export type ProgrammaticPageStatus = "draft" | "published";

export interface ProgrammaticPageRecord {
  id: string;
  tenantSlug: string;
  templateId: string;
  slug: string;
  title: string;
  metaDescription: string | null;
  bodyMd: string | null;
  variables: Record<string, string>;
  status: ProgrammaticPageStatus;
  generatorModel: string | null;
  generatorCostUsd: number;
  liveUrl: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
