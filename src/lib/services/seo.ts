import type {
  SEOMetric, KeywordRanking, KeywordGroup, TopicalCluster,
  BlogPost, ContentScoreBreakdown, ProgrammaticTemplate, SERPAnalysis,
} from "@/lib/types/seo";
import {
  mockSEOMetrics, mockKeywordRankings, mockKeywordGroups,
  mockTopicalClusters, mockBlogPosts, mockContentScores,
  mockProgrammaticTemplates, mockSERPAnalyses,
} from "@/lib/data/mock-seo";

export async function getSEOMetrics(tenantSlug: string): Promise<SEOMetric[]> {
  return mockSEOMetrics[tenantSlug] ?? mockSEOMetrics.gruve;
}

export async function getKeywordRankings(tenantSlug: string): Promise<KeywordRanking[]> {
  return mockKeywordRankings[tenantSlug] ?? mockKeywordRankings.gruve;
}

export async function getKeywordGroups(tenantSlug: string): Promise<KeywordGroup[]> {
  return mockKeywordGroups[tenantSlug] ?? mockKeywordGroups.gruve;
}

export async function getTopicalClusters(tenantSlug: string): Promise<TopicalCluster[]> {
  return mockTopicalClusters[tenantSlug] ?? mockTopicalClusters.gruve;
}

export async function getBlogPosts(tenantSlug: string): Promise<BlogPost[]> {
  return mockBlogPosts[tenantSlug] ?? mockBlogPosts.gruve;
}

export async function getContentScore(postId: string): Promise<ContentScoreBreakdown | null> {
  return mockContentScores[postId] ?? null;
}

export async function getProgrammaticTemplates(tenantSlug: string): Promise<ProgrammaticTemplate[]> {
  return mockProgrammaticTemplates[tenantSlug] ?? mockProgrammaticTemplates.gruve;
}

export async function getSERPAnalyses(tenantSlug: string): Promise<SERPAnalysis[]> {
  return mockSERPAnalyses[tenantSlug] ?? mockSERPAnalyses.gruve;
}
