import type { GeoRegion } from "@/lib/data/geo-seed";
import { DEFAULT_OUTBOUND_FILTERS_SEED } from "@/lib/data/outbound-filters-seed";

export interface OutboundFilters {
  keywords: string[];
  geoScope: GeoRegion[];
  competitorUrls: string[];
  passiveCaptureEnabled: boolean;
  dwellMs: number;
}

export const DEFAULT_OUTBOUND_FILTERS: OutboundFilters =
  DEFAULT_OUTBOUND_FILTERS_SEED;

export type { GeoRegion };
