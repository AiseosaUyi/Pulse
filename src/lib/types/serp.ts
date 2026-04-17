import type { SerpAnalysis } from "@/lib/ai/analyze-serp";
import type { SerpResult } from "@/lib/scrape/google-serp";

export interface SerpAnalysisRecord {
  id: string;
  tenantSlug: string;
  keyword: string;
  region: string | null;
  topResults: SerpResult[];
  aiAnalysis: SerpAnalysis | null;
  generatorModel: string | null;
  generatorCostUsd: number;
  createdAt: string;
  updatedAt: string;
}
