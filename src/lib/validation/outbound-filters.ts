import { z } from "zod";

export const geoRegionSchema = z.object({
  country: z.string().min(1).max(80),
  states: z.array(z.string().min(1).max(80)).max(200),
});

export const outboundFiltersSchema = z.object({
  keywords: z.array(z.string().min(1).max(80)).max(200),
  geoScope: z.array(geoRegionSchema).max(50),
  competitorUrls: z.array(z.string().min(3).max(120)).max(100),
  passiveCaptureEnabled: z.boolean(),
  dwellMs: z.number().int().min(400).max(5000),
});
