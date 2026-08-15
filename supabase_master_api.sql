-- ============================================================================
-- Yolkshire Loyalty Engine: Database Migration & Master Dashboard Views
-- Run this script in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/tslqynxiwlndudvwihby/sql
-- ============================================================================

-- 1. Ensure `branch` column exists on `cards` table
ALTER TABLE public.cards 
ADD COLUMN IF NOT EXISTS branch VARCHAR(50);

-- 2. Backfill branch for legacy records from history logs where available
UPDATE public.cards 
SET branch = SPLIT_PART(history, '@', 2) 
WHERE (branch IS NULL OR branch = '') 
  AND history LIKE '%@%';

-- 3. Create performance indexes
CREATE INDEX IF NOT EXISTS idx_cards_branch 
ON public.cards (branch);

CREATE INDEX IF NOT EXISTS idx_cards_campaign 
ON public.cards (campaign);

-- 4. Create Master Dashboard Ingestion View: `loyalty_branch_summary`
-- Handles `visits` as either text or integer cleanly using CTE normalization
CREATE OR REPLACE VIEW public.loyalty_branch_summary AS
WITH normalized_cards AS (
    SELECT 
        id,
        COALESCE(NULLIF(TRIM(branch), ''), 'Unassigned') AS branch,
        campaign,
        name,
        phone,
        COALESCE(NULLIF(regexp_replace(visits::text, '[^0-9]', '', 'g'), '')::integer, 0) AS visit_count,
        last_visit
    FROM public.cards
    WHERE name IS NOT NULL AND TRIM(name) != ''
)
SELECT 
    branch,
    campaign,
    COUNT(*) AS total_registered_cards,
    COUNT(*) FILTER (WHERE visit_count > 0 AND visit_count < CASE WHEN campaign = 'pyc' THEN 10 ELSE 9 END) AS active_cards,
    COUNT(*) FILTER (WHERE visit_count >= CASE WHEN campaign = 'pyc' THEN 10 ELSE 9 END) AS completed_cards,
    ROUND(AVG(LEAST(visit_count, CASE WHEN campaign = 'pyc' THEN 10 ELSE 9 END))::numeric, 2) AS avg_stamps_per_card,
    MAX(last_visit) AS latest_activity_at
FROM normalized_cards
GROUP BY branch, campaign
ORDER BY branch ASC, campaign ASC;

-- 5. Grant access permissions for the PostgREST API
GRANT SELECT ON public.loyalty_branch_summary TO anon, authenticated, service_role;
