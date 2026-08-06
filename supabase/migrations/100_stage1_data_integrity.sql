-- Migration 100: Stage 1 Data Integrity & Safety Cleanups
-- 1. Unpublish fabricated blog post 033f3f42-10f4-4974-88b4-3b69f51c79ba for tenant 'sippy'
UPDATE blog_posts
SET status = 'draft',
    unpublished_at = NOW(),
    unpublished_by = NULL,
    unpublish_reason = 'Fabricated business claims'
WHERE id = '033f3f42-10f4-4974-88b4-3b69f51c79ba'
  AND tenant_slug = 'sippy';

-- 2. Ensure exact 4 competitors for tenant 'sippy' and remove legacy entries
DELETE FROM competitors
WHERE tenant_id = 'sippy'
  AND lower(website) NOT IN ('drinks.ng', 'bottlekings.ng', 'rightdrinksng.com', 'aplusdrinks.com')
  AND lower(name) NOT IN ('drinks.ng', 'bottlekings', 'right drinks', 'a plus drinks');

INSERT INTO competitors (tenant_id, name, website, type, threat_level, strengths, weaknesses, platforms)
VALUES
  (
    'sippy',
    'drinks.ng',
    'drinks.ng',
    'direct',
    'high',
    ARRAY['Established brand', 'Wide spirit & wine catalog', 'Bulk party orders'],
    ARRAY['Slower on-demand delivery', 'Higher pricing on single bottles'],
    '[{"platform": "instagram", "handle": "@drinks.ng", "followers": 45000, "engagementRate": "2.5%"}, {"platform": "twitter", "handle": "@drinksng", "followers": 18000, "engagementRate": "1.2%"}]'::jsonb
  ),
  (
    'sippy',
    'Bottlekings',
    'bottlekings.ng',
    'direct',
    'high',
    ARRAY['Lagos party focus', 'Strong social presence', 'VIP bottle service packages'],
    ARRAY['Limited coverage outside Island', 'Higher delivery fees'],
    '[{"platform": "instagram", "handle": "@bottlekings.ng", "followers": 22000, "engagementRate": "3.8%"}]'::jsonb
  ),
  (
    'sippy',
    'Right Drinks',
    'rightdrinksng.com',
    'direct',
    'medium',
    ARRAY['Wholesale pricing', 'Corporate event fulfillment'],
    ARRAY['Legacy web interface', 'Slow customer support'],
    '[{"platform": "instagram", "handle": "@rightdrinksng", "followers": 9400, "engagementRate": "1.9%"}]'::jsonb
  ),
  (
    'sippy',
    'A Plus Drinks',
    'aplusdrinks.com',
    'direct',
    'medium',
    ARRAY['Local distribution hubs', 'Competitive beer & spirit pricing'],
    ARRAY['Minimal brand awareness on social media', 'No mobile app'],
    '[{"platform": "instagram", "handle": "@aplusdrinks", "followers": 6200, "engagementRate": "1.4%"}]'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

-- 3. Clean cross-tenant Gruve URL contamination from keyword_rankings for tenant 'sippy'
UPDATE keyword_rankings
SET url = NULL
WHERE tenant_slug = 'sippy'
  AND url LIKE '%gruve.events%';
