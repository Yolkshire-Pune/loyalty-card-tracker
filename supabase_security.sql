-- ============================================================================
-- Yolkshire Loyalty Engine: Security Lockdown Migration
-- Run in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/tslqynxiwlndudvwihby/sql
--
-- WHAT THIS DOES
--   Before: the browser held a publishable key with direct table access, so
--           anyone could read every customer's name + phone, PATCH any card's
--           visit count, or delete rows. The staff PIN and the admin PIN were
--           both "2010", hardcoded in public JavaScript.
--   After:  `anon` has NO table access at all. A customer reaches exactly one
--           card -- the one whose ID is printed on the card in their hand --
--           through three SECURITY DEFINER functions that enforce every rule
--           server-side. Admins read the table only with a real Supabase Auth
--           login that also appears in the app_private.admin_users allowlist.
--
-- This file is idempotent; run it top to bottom in one go.
-- AFTER RUNNING: complete the manual steps in section 10.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 0. Extensions + private schema
--    PostgREST only exposes the `public` schema, so anything in `app_private`
--    is unreachable over the API no matter what key the caller holds.
-- ---------------------------------------------------------------------------
-- Supabase's SQL editor quietly includes `extensions` in its search_path, but
-- psql and migration tools do not. Set it explicitly so the bare crypt() and
-- gen_salt() calls below resolve no matter how this file is run. A schema in
-- search_path that does not exist is ignored, so this is safe either way.
SET search_path = public, extensions;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 1. Normalize column types on `cards`
--    `visits` and `last_visit` have historically been text (Google Sheets
--    import artifacts). The functions below need real types for arithmetic and
--    timezone maths. Both casts are safe to re-run.
-- ---------------------------------------------------------------------------
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS branch     VARCHAR(50);
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS member_id  VARCHAR(20);
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS campaign   VARCHAR(20);
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

CREATE OR REPLACE FUNCTION app_private.safe_ts(p_raw text)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
    v_out timestamptz;
BEGIN
    IF p_raw IS NULL OR btrim(p_raw) = '' THEN
        RETURN NULL;
    END IF;
    BEGIN
        v_out := btrim(p_raw)::timestamptz;
    EXCEPTION WHEN others THEN
        RETURN NULL;
    END;
    RETURN v_out;
END $fn$;

-- Retyping a column is blocked by two things: a default that cannot be cast,
-- and any view built on that column. Both are handled here -- the default is
-- dropped and re-added, and dependent views are captured, dropped, and recreated
-- from their own live definitions (not from a possibly-stale copy in the repo).
DO $mig$
DECLARE
    v_views  text[] := '{}';
    v_defs   text[] := '{}';
    v_rec    record;
    i        integer;
BEGIN
    IF (SELECT data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'cards'
          AND column_name = 'visits') = 'integer'
       AND (SELECT data_type FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'cards'
              AND column_name = 'last_visit') = 'timestamp with time zone'
    THEN
        RETURN;  -- already migrated; leave the views alone
    END IF;

    -- Capture and drop every view that depends on public.cards.
    --
    -- loyalty_branch_summary is deliberately NOT captured for replay: its stored
    -- definition contains regexp_replace(visits, ...) because the `visits::text`
    -- cast was a no-op while the column was text, so Postgres folded it away.
    -- Replaying that against an integer column fails. It is recreated from a
    -- type-aware definition immediately after this block instead.
    FOR v_rec IN
        SELECT DISTINCT c.oid::regclass::text AS view_name
        FROM pg_depend d
        JOIN pg_rewrite r ON r.oid = d.objid
        JOIN pg_class c   ON c.oid = r.ev_class AND c.relkind = 'v'
        WHERE d.refobjid = 'public.cards'::regclass
          AND d.refclassid = 'pg_class'::regclass
          AND c.oid <> 'public.cards'::regclass
    LOOP
        IF v_rec.view_name NOT IN ('loyalty_branch_summary', 'public.loyalty_branch_summary') THEN
            v_views := v_views || v_rec.view_name;
            v_defs  := v_defs  || pg_get_viewdef(v_rec.view_name::regclass, true);
        END IF;
        RAISE NOTICE 'Dropping dependent view % (will be recreated)', v_rec.view_name;
        EXECUTE format('DROP VIEW %s', v_rec.view_name);
    END LOOP;

    IF (SELECT data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'cards'
          AND column_name = 'visits') <> 'integer'
    THEN
        ALTER TABLE public.cards ALTER COLUMN visits DROP DEFAULT;
        ALTER TABLE public.cards
            ALTER COLUMN visits TYPE integer
            USING COALESCE(NULLIF(regexp_replace(visits::text, '[^0-9]', '', 'g'), '')::integer, 0);
    END IF;

    IF (SELECT data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'cards'
          AND column_name = 'last_visit') <> 'timestamp with time zone'
    THEN
        ALTER TABLE public.cards ALTER COLUMN last_visit DROP DEFAULT;
        ALTER TABLE public.cards
            ALTER COLUMN last_visit TYPE timestamptz
            USING app_private.safe_ts(last_visit::text);
    END IF;

    -- Recreate in capture order, so a view built on another view still resolves.
    FOR i IN 1 .. COALESCE(array_length(v_views, 1), 0) LOOP
        RAISE NOTICE 'Recreating view %', v_views[i];
        BEGIN
            EXECUTE format('CREATE VIEW %s AS %s', v_views[i], v_defs[i]);
        EXCEPTION WHEN others THEN
            RAISE EXCEPTION
                'Could not recreate view % after retyping cards.visits/last_visit: %. '
                'Its definition likely relied on those columns being text. '
                'Recreate it by hand against the new types, then re-run this script.',
                v_views[i], SQLERRM;
        END;
    END LOOP;
END $mig$;

-- Recreated with the same column names and order as supabase_master_api.sql, so
-- the BI feed's shape is unchanged. Two differences, both consequences of the
-- retype: `visit_count` no longer needs the regexp scrub because `visits` is a
-- real integer, and `latest_activity_at` is now a timestamptz (ISO 8601 with
-- offset) rather than whatever text happened to be stored.
-- CREATE OR REPLACE first, falling back to DROP + CREATE. On a re-run the
-- replace succeeds and the view keeps its grants; only the first run, coming
-- from the old text-typed definition, needs the drop (REPLACE cannot change a
-- column's type). Dropping unconditionally would strip the service_role grant
-- off the BI feed every time this file is re-run.
DO $view$
DECLARE
    v_sql text := $def$
CREATE OR REPLACE VIEW public.loyalty_branch_summary AS
WITH normalized_cards AS (
    SELECT
        id,
        COALESCE(NULLIF(TRIM(branch), ''), 'Unassigned') AS branch,
        campaign,
        name,
        phone,
        COALESCE(visits, 0) AS visit_count,
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
ORDER BY branch ASC, campaign ASC
$def$;
BEGIN
    EXECUTE v_sql;
EXCEPTION WHEN others THEN
    RAISE NOTICE 'Replacing loyalty_branch_summary in place failed (%); dropping and recreating.', SQLERRM;
    DROP VIEW IF EXISTS public.loyalty_branch_summary;
    EXECUTE v_sql;
END $view$;

UPDATE public.cards SET visits = 0 WHERE visits IS NULL;
ALTER TABLE public.cards ALTER COLUMN visits SET DEFAULT 0;
ALTER TABLE public.cards ALTER COLUMN visits SET NOT NULL;

-- One card ID is one row. Closes the duplicate-row race during registration.
DO $mig$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.cards'::regclass
          AND contype IN ('p', 'u')
          AND pg_get_constraintdef(oid) LIKE '%(id)%'
    ) THEN
        ALTER TABLE public.cards ADD CONSTRAINT cards_id_key UNIQUE (id);
    END IF;
END $mig$;


-- ---------------------------------------------------------------------------
-- 2. Staff PINs, per branch, hashed. Never leaves the database.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_private.staff_pins (
    branch     text PRIMARY KEY,
    pin_hash   text NOT NULL,
    active     boolean NOT NULL DEFAULT true,
    updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app_private.staff_pins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.staff_pins FROM PUBLIC, anon, authenticated;

-- Seeded with the CURRENT pin so nothing breaks the moment you deploy.
-- >>> THAT PIN IS ALREADY PUBLIC: it was hardcoded in js/app.js and is in git
-- >>> history. Rotate every branch using section 10.2 as soon as the new build
-- >>> is live.
INSERT INTO app_private.staff_pins (branch, pin_hash)
SELECT b, crypt('2010', gen_salt('bf', 10))
FROM unnest(ARRAY[
    'Kothrud', 'Aundh', 'Salunkhe Vihar', 'Pimple Saudagar',
    'Wadgaon Sheri', 'Wakad', 'Bavdhan', 'PYC'
]) AS b
ON CONFLICT (branch) DO NOTHING;


-- ---------------------------------------------------------------------------
-- 3. Admin allowlist. Having a Supabase Auth account is not enough on its own.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_private.admin_users (
    user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email      text,
    created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app_private.admin_users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.admin_users FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app_private, pg_temp
AS $fn$
    SELECT EXISTS (
        SELECT 1 FROM app_private.admin_users a WHERE a.user_id = auth.uid()
    );
$fn$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;


-- ---------------------------------------------------------------------------
-- 4. Rate limiting
--    These helpers deliberately never RAISE. PostgREST wraps each request in a
--    transaction, so an exception would roll back the counter increment and the
--    limiter would never accumulate. The RPCs return a JSON error object
--    instead, which commits.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_private.rpc_throttle (
    bucket        text PRIMARY KEY,
    hits          integer NOT NULL DEFAULT 0,
    window_start  timestamptz NOT NULL DEFAULT now(),
    blocked_until timestamptz
);
ALTER TABLE app_private.rpc_throttle ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.rpc_throttle FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION app_private.request_ip()
RETURNS text
LANGUAGE plpgsql
STABLE
AS $fn$
DECLARE
    v_hdrs json;
    v_ip   text;
BEGIN
    BEGIN
        v_hdrs := current_setting('request.headers', true)::json;
    EXCEPTION WHEN others THEN
        RETURN 'unknown';
    END;

    IF v_hdrs IS NULL THEN
        RETURN 'unknown';
    END IF;

    v_ip := COALESCE(
        v_hdrs ->> 'cf-connecting-ip',
        NULLIF(btrim(split_part(COALESCE(v_hdrs ->> 'x-forwarded-for', ''), ',', 1)), ''),
        v_hdrs ->> 'x-real-ip'
    );

    RETURN COALESCE(NULLIF(btrim(v_ip), ''), 'unknown');
END $fn$;

-- TRUE when the caller is currently blocked. Read-only: does not count a hit.
-- VOLATILE, not STABLE, so it always reads current state rather than the
-- statement snapshot -- otherwise several calls in one statement would each
-- see a pre-block view of the counter.
CREATE OR REPLACE FUNCTION app_private.throttle_blocked(p_bucket text)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = app_private, pg_temp
AS $fn$
    SELECT EXISTS (
        SELECT 1 FROM app_private.rpc_throttle
        WHERE bucket = p_bucket AND blocked_until IS NOT NULL AND blocked_until > now()
    );
$fn$;

-- TRUE when the caller is allowed through, FALSE when throttled.
CREATE OR REPLACE FUNCTION app_private.throttle(
    p_bucket text,
    p_limit  integer,
    p_window interval,
    p_block  interval
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_private, pg_temp
AS $fn$
DECLARE
    v_row app_private.rpc_throttle%ROWTYPE;
BEGIN
    INSERT INTO app_private.rpc_throttle (bucket, hits, window_start)
    VALUES (p_bucket, 0, now())
    ON CONFLICT (bucket) DO NOTHING;

    SELECT * INTO v_row FROM app_private.rpc_throttle WHERE bucket = p_bucket FOR UPDATE;

    IF v_row.blocked_until IS NOT NULL AND v_row.blocked_until > now() THEN
        RETURN false;
    END IF;

    IF v_row.window_start < now() - p_window THEN
        UPDATE app_private.rpc_throttle
        SET hits = 1, window_start = now(), blocked_until = NULL
        WHERE bucket = p_bucket;
        RETURN true;
    END IF;

    IF v_row.hits + 1 > p_limit THEN
        UPDATE app_private.rpc_throttle
        SET hits = v_row.hits + 1, blocked_until = now() + p_block
        WHERE bucket = p_bucket;
        RETURN false;
    END IF;

    UPDATE app_private.rpc_throttle SET hits = v_row.hits + 1 WHERE bucket = p_bucket;
    RETURN true;
END $fn$;


-- ---------------------------------------------------------------------------
-- 5. Shared helpers: campaign rules, phone masking, branch derivation
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.campaign_total_visits(p_campaign text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $fn$
    SELECT CASE WHEN p_campaign = 'pyc' THEN 10 ELSE 9 END;
$fn$;

CREATE OR REPLACE FUNCTION app_private.card_id_ok(p_card_id text, p_campaign text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $fn$
    SELECT CASE
        WHEN p_campaign = 'pyc' THEN p_card_id ~ '^PYCLC[0-9]{3}$'
        ELSE p_card_id ~ '^YSLC[0-9]{3}$'
    END;
$fn$;

CREATE OR REPLACE FUNCTION app_private.branch_ok(p_branch text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $fn$
    SELECT p_branch IN (
        'Kothrud', 'Aundh', 'Salunkhe Vihar', 'Pimple Saudagar',
        'Wadgaon Sheri', 'Wakad', 'Bavdhan', 'PYC'
    );
$fn$;

-- Digits-only form, so '+919876543210' and '919876543210' collide correctly.
CREATE OR REPLACE FUNCTION app_private.phone_digits(p_phone text)
RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
    SELECT regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
$fn$;

-- Never hand a full phone number to a browser. Keeps the ISD code and the last
-- 4 digits: '+91 XXXXX 3210'. Card holders recognise their own number; anyone
-- enumerating card IDs learns nothing they can reuse.
CREATE OR REPLACE FUNCTION app_private.mask_phone(p_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
    -- Ordered longest-first so the first match is the correct ISD code.
    v_codes text[] := ARRAY[
        '971', '966', '974', '968', '965', '973', '852', '880', '977', '353',
        '91', '44', '61', '64', '65', '60', '66', '62', '63', '81', '86', '82',
        '49', '33', '39', '34', '31', '41', '46', '47', '92', '94', '1'
    ];
    v_digits text := regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
    v_code   text;
    v_rest   text;
BEGIN
    IF v_digits = '' THEN
        RETURN '';
    END IF;

    FOREACH v_code IN ARRAY v_codes LOOP
        IF v_digits LIKE v_code || '%' AND length(v_digits) > length(v_code) + 4 THEN
            v_rest := substring(v_digits FROM length(v_code) + 1);
            RETURN '+' || v_code || ' ' || repeat('X', length(v_rest) - 4) || ' ' || right(v_rest, 4);
        END IF;
    END LOOP;

    IF length(v_digits) <= 4 THEN
        RETURN repeat('X', length(v_digits));
    END IF;

    RETURN repeat('X', length(v_digits) - 4) || ' ' || right(v_digits, 4);
END $fn$;

-- The branch a card belongs to, derived only from stored data. Never from
-- anything the browser sends.
CREATE OR REPLACE FUNCTION app_private.home_branch(p_card public.cards)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
    v_entry  text;
    v_branch text;
BEGIN
    IF p_card.campaign = 'pyc' THEN
        RETURN 'PYC';
    END IF;

    v_branch := NULLIF(btrim(COALESCE(p_card.branch, '')), '');
    IF v_branch IS NOT NULL AND v_branch <> 'Unassigned' THEN
        RETURN v_branch;
    END IF;

    FOREACH v_entry IN ARRAY string_to_array(COALESCE(p_card.history, ''), '|') LOOP
        IF position('@' IN v_entry) > 0 THEN
            v_branch := NULLIF(btrim(split_part(v_entry, '@', 2)), '');
            IF v_branch IS NOT NULL AND v_branch <> 'Unassigned' THEN
                RETURN v_branch;
            END IF;
        END IF;
    END LOOP;

    RETURN NULL;
END $fn$;

-- Has this card already been stamped today, Asia/Kolkata?
CREATE OR REPLACE FUNCTION app_private.stamped_today(p_card public.cards)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $fn$
DECLARE
    v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
    v_entry text;
    v_ts    timestamptz;
BEGIN
    IF COALESCE(p_card.visits, 0) <= 0 THEN
        RETURN false;
    END IF;

    IF p_card.last_visit IS NOT NULL
       AND (p_card.last_visit AT TIME ZONE 'Asia/Kolkata')::date = v_today THEN
        RETURN true;
    END IF;

    FOREACH v_entry IN ARRAY string_to_array(COALESCE(p_card.history, ''), '|') LOOP
        v_ts := app_private.safe_ts(split_part(v_entry, '@', 1));
        IF v_ts IS NOT NULL AND (v_ts AT TIME ZONE 'Asia/Kolkata')::date = v_today THEN
            RETURN true;
        END IF;
    END LOOP;

    RETURN false;
END $fn$;

-- The single shape every customer-facing RPC returns. Note what is absent: the
-- raw phone number, and any row other than this one.
CREATE OR REPLACE FUNCTION app_private.card_payload(p_card public.cards)
RETURNS json
LANGUAGE sql
STABLE
AS $fn$
    SELECT json_build_object(
        'id',            p_card.id,
        'name',          COALESCE(p_card.name, ''),
        'phone_display', app_private.mask_phone(p_card.phone),
        'member_id',     COALESCE(p_card.member_id, ''),
        'branch',        COALESCE(app_private.home_branch(p_card), ''),
        'campaign',      COALESCE(p_card.campaign, 'public'),
        'visits',        COALESCE(p_card.visits, 0),
        'last_visit',    p_card.last_visit,
        'history',       COALESCE(p_card.history, ''),
        'registered',    (COALESCE(btrim(p_card.name), '') <> '' AND COALESCE(btrim(p_card.phone), '') <> ''),
        'stamped_today', app_private.stamped_today(p_card)
    );
$fn$;

-- ISO 8601 exactly as JavaScript's toISOString() writes it, so existing history
-- entries and new ones parse identically.
CREATE OR REPLACE FUNCTION app_private.iso_now()
RETURNS text LANGUAGE sql STABLE AS $fn$
    SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$fn$;


-- ---------------------------------------------------------------------------
-- 6. RPC: look up one card
--    Reads exactly one row, chosen by the ID printed on the physical card.
--    Creates the blank row on first scan, which is what the old client-side
--    POST used to do.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.card_lookup(p_card_id text, p_campaign text DEFAULT 'public')
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private, pg_temp
AS $fn$
DECLARE
    v_id   text := upper(btrim(COALESCE(p_card_id, '')));
    v_camp text := lower(btrim(COALESCE(p_campaign, 'public')));
    v_card public.cards;
BEGIN
    IF v_camp NOT IN ('public', 'pyc') THEN
        v_camp := 'public';
    END IF;

    IF NOT app_private.card_id_ok(v_id, v_camp) THEN
        RETURN json_build_object('ok', false, 'error', 'invalid_card');
    END IF;

    IF NOT app_private.throttle('lookup:' || app_private.request_ip(),
                                60, interval '10 minutes', interval '15 minutes') THEN
        RETURN json_build_object('ok', false, 'error', 'rate_limited');
    END IF;

    SELECT * INTO v_card FROM public.cards WHERE id = v_id;

    IF NOT FOUND THEN
        INSERT INTO public.cards (id, name, phone, visits, history, campaign)
        VALUES (v_id, '', '', 0, '', v_camp)
        ON CONFLICT (id) DO NOTHING;
        SELECT * INTO v_card FROM public.cards WHERE id = v_id;
    END IF;

    IF v_card.campaign IS NOT NULL AND btrim(v_card.campaign) <> '' AND v_card.campaign <> v_camp THEN
        RETURN json_build_object('ok', false, 'error', 'wrong_campaign');
    END IF;

    RETURN json_build_object('ok', true, 'card', app_private.card_payload(v_card));
END $fn$;


-- ---------------------------------------------------------------------------
-- 7. RPC: register a card
--    Every validation the browser used to do is repeated here, because the
--    browser's copy is only a convenience for the customer.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.card_register(
    p_card_id   text,
    p_campaign  text,
    p_name      text,
    p_phone     text,
    p_branch    text,
    p_member_id text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private, pg_temp
AS $fn$
DECLARE
    v_id      text := upper(btrim(COALESCE(p_card_id, '')));
    v_camp    text := lower(btrim(COALESCE(p_campaign, 'public')));
    v_name    text := btrim(regexp_replace(COALESCE(p_name, ''), '\s+', ' ', 'g'));
    v_phone   text := btrim(COALESCE(p_phone, ''));
    v_branch  text := btrim(COALESCE(p_branch, ''));
    v_member  text := upper(btrim(COALESCE(p_member_id, '')));
    v_digits  text;
    v_card    public.cards;
    v_now     text := app_private.iso_now();
BEGIN
    IF v_camp NOT IN ('public', 'pyc') THEN
        v_camp := 'public';
    END IF;

    IF NOT app_private.card_id_ok(v_id, v_camp) THEN
        RETURN json_build_object('ok', false, 'error', 'invalid_card');
    END IF;

    IF NOT app_private.throttle('register:' || app_private.request_ip(),
                                10, interval '1 hour', interval '1 hour') THEN
        RETURN json_build_object('ok', false, 'error', 'rate_limited');
    END IF;

    IF v_name !~ '^[A-Za-z. ]{2,50}$' THEN
        RETURN json_build_object('ok', false, 'error', 'invalid_name');
    END IF;

    IF v_phone !~ '^\+[0-9]{7,15}$' THEN
        RETURN json_build_object('ok', false, 'error', 'invalid_phone');
    END IF;

    IF v_camp = 'pyc' THEN
        v_branch := 'PYC';
        IF v_member !~ '^[A-Z]-[0-9]{4}$' AND v_member !~ '^DM[0-9]{4}$' THEN
            RETURN json_build_object('ok', false, 'error', 'invalid_member_id');
        END IF;
    ELSE
        v_member := NULL;
        IF NOT app_private.branch_ok(v_branch) THEN
            RETURN json_build_object('ok', false, 'error', 'invalid_branch');
        END IF;
    END IF;

    SELECT * INTO v_card FROM public.cards WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN json_build_object('ok', false, 'error', 'invalid_card');
    END IF;

    -- A card is activated once. Re-activation would let a finder overwrite the
    -- original owner's details.
    IF COALESCE(btrim(v_card.name), '') <> '' AND COALESCE(btrim(v_card.phone), '') <> '' THEN
        RETURN json_build_object('ok', false, 'error', 'already_registered');
    END IF;

    v_digits := app_private.phone_digits(v_phone);

    IF EXISTS (
        SELECT 1 FROM public.cards c
        WHERE c.id <> v_id
          AND COALESCE(btrim(c.name), '') <> ''
          AND app_private.phone_digits(c.phone) = v_digits
    ) THEN
        RETURN json_build_object('ok', false, 'error', 'phone_taken');
    END IF;

    IF v_camp = 'pyc' AND EXISTS (
        SELECT 1 FROM public.cards c
        WHERE c.id <> v_id
          AND upper(btrim(COALESCE(c.member_id, ''))) = v_member
    ) THEN
        RETURN json_build_object('ok', false, 'error', 'member_id_taken');
    END IF;

    UPDATE public.cards
    SET name       = v_name,
        phone      = v_phone,
        branch     = v_branch,
        campaign   = v_camp,
        member_id  = v_member,
        visits     = 0,
        last_visit = now(),
        history    = v_now || '@' || v_branch
    WHERE id = v_id
    RETURNING * INTO v_card;

    RETURN json_build_object('ok', true, 'card', app_private.card_payload(v_card));
END $fn$;


-- ---------------------------------------------------------------------------
-- 8. RPC: record a visit
--    The browser sends the card ID and the staff PIN. It does NOT send the new
--    visit count or the branch -- those are derived here, so a customer cannot
--    set visits to 9 or stamp against someone else's branch.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.card_record_visit(
    p_card_id   text,
    p_campaign  text,
    p_staff_pin text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
-- `extensions` is required: this is the only function that calls crypt(), and
-- Supabase installs pgcrypto into the `extensions` schema, not `public`. A
-- pinned search_path without it makes crypt() invisible and the function 500s.
-- `public` is kept for a plain Postgres, where pgcrypto lands there instead.
-- A schema in search_path that does not exist is ignored, so both are safe.
SET search_path = public, app_private, extensions, pg_temp
AS $fn$
DECLARE
    v_id       text := upper(btrim(COALESCE(p_card_id, '')));
    v_camp     text := lower(btrim(COALESCE(p_campaign, 'public')));
    v_pin      text := btrim(COALESCE(p_staff_pin, ''));
    v_ip       text := app_private.request_ip();
    v_card     public.cards;
    v_branch   text;
    v_hash     text;
    v_total    integer;
    v_new      integer;
    v_now      text := app_private.iso_now();
BEGIN
    IF v_camp NOT IN ('public', 'pyc') THEN
        v_camp := 'public';
    END IF;

    IF NOT app_private.card_id_ok(v_id, v_camp) THEN
        RETURN json_build_object('ok', false, 'error', 'invalid_card');
    END IF;

    -- Blocked from earlier failed PIN attempts?
    IF app_private.throttle_blocked('pinfail:ip:' || v_ip)
       OR app_private.throttle_blocked('pinfail:card:' || v_id) THEN
        RETURN json_build_object('ok', false, 'error', 'rate_limited');
    END IF;

    IF NOT app_private.throttle('stamp:' || v_ip,
                                60, interval '10 minutes', interval '10 minutes') THEN
        RETURN json_build_object('ok', false, 'error', 'rate_limited');
    END IF;

    SELECT * INTO v_card FROM public.cards WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN json_build_object('ok', false, 'error', 'invalid_card');
    END IF;

    IF COALESCE(btrim(v_card.name), '') = '' OR COALESCE(btrim(v_card.phone), '') = '' THEN
        RETURN json_build_object('ok', false, 'error', 'not_registered');
    END IF;

    v_branch := app_private.home_branch(v_card);
    IF v_branch IS NULL THEN
        RETURN json_build_object('ok', false, 'error', 'no_branch');
    END IF;

    -- PIN for this card's own branch, falling back to a shared '*' pin if you
    -- choose to add one.
    SELECT sp.pin_hash INTO v_hash
    FROM app_private.staff_pins sp
    WHERE sp.active AND sp.branch IN (v_branch, '*')
    ORDER BY (sp.branch = v_branch) DESC
    LIMIT 1;

    IF v_hash IS NULL OR v_pin = '' OR crypt(v_pin, v_hash) <> v_hash THEN
        -- Count the failure. These two calls commit even though we return an
        -- error, because we return rather than raise.
        PERFORM app_private.throttle('pinfail:ip:' || v_ip,
                                     10, interval '15 minutes', interval '30 minutes');
        PERFORM app_private.throttle('pinfail:card:' || v_id,
                                     5, interval '15 minutes', interval '30 minutes');
        RETURN json_build_object('ok', false, 'error', 'bad_pin');
    END IF;

    IF app_private.stamped_today(v_card) THEN
        RETURN json_build_object('ok', false, 'error', 'daily_limit',
                                 'card', app_private.card_payload(v_card));
    END IF;

    v_total := app_private.campaign_total_visits(COALESCE(v_card.campaign, v_camp));
    IF COALESCE(v_card.visits, 0) >= v_total THEN
        RETURN json_build_object('ok', false, 'error', 'card_complete',
                                 'card', app_private.card_payload(v_card));
    END IF;

    v_new := COALESCE(v_card.visits, 0) + 1;

    UPDATE public.cards
    SET visits     = v_new,
        branch     = v_branch,
        last_visit = now(),
        history    = CASE
                        WHEN COALESCE(btrim(history), '') = '' THEN v_now || '@' || v_branch
                        ELSE history || '|' || v_now || '@' || v_branch
                     END
    WHERE id = v_id
    RETURNING * INTO v_card;

    RETURN json_build_object('ok', true, 'card', app_private.card_payload(v_card));
END $fn$;


-- ---------------------------------------------------------------------------
-- 9. Lock the door
--    Everything above is the only way in. Now remove the direct table access
--    the publishable key used to enjoy.
-- ---------------------------------------------------------------------------

-- 9.1 Drop every pre-existing policy on `cards` so nothing permissive survives.
DO $lock$
DECLARE
    p record;
BEGIN
    FOR p IN
        SELECT policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'cards'
    LOOP
        EXECUTE format('DROP POLICY %I ON public.cards', p.policyname);
    END LOOP;
END $lock$;

ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;
-- Deliberately NOT "FORCE ROW LEVEL SECURITY": the SECURITY DEFINER functions
-- above run as the table owner and rely on bypassing RLS.

REVOKE ALL ON public.cards FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cards TO authenticated;
-- service_role is the server-to-server key (master dashboard ingestion). It
-- bypasses RLS by design; the blanket REVOKE above must not catch it.
GRANT ALL ON public.cards TO service_role;

-- The only direct-read path that survives: an allowlisted admin, signed in.
CREATE POLICY cards_admin_read ON public.cards
    FOR SELECT TO authenticated
    USING (public.is_admin());

-- 9.2 Master dashboard view: make it respect the policy above, and take it away
--     from anon. service_role (server-to-server ingestion) keeps its access.
DO $lock$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'loyalty_branch_summary') THEN
        -- security_invoker needs PG15+. On an older project the REVOKE below is
        -- still what matters; the view just keeps running as its owner.
        BEGIN
            EXECUTE 'ALTER VIEW public.loyalty_branch_summary SET (security_invoker = true)';
        EXCEPTION WHEN others THEN
            RAISE NOTICE 'security_invoker not supported on this Postgres version; skipped.';
        END;
        EXECUTE 'REVOKE ALL ON public.loyalty_branch_summary FROM PUBLIC, anon';
        EXECUTE 'GRANT SELECT ON public.loyalty_branch_summary TO authenticated, service_role';
    END IF;
END $lock$;

-- 9.3 Functions: `anon` may call exactly these three, nothing else.
--     (Postgres grants EXECUTE to PUBLIC by default, hence the explicit REVOKE.)
REVOKE ALL ON FUNCTION public.card_lookup(text, text)                FROM PUBLIC;
REVOKE ALL ON FUNCTION public.card_register(text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.card_record_visit(text, text, text)    FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.card_lookup(text, text)                TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.card_register(text, text, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.card_record_visit(text, text, text)    TO anon, authenticated;

-- 9.4 Private helpers are unreachable over the API (wrong schema) but revoke
--     anyway, so a future `GRANT USAGE ON SCHEMA app_private` cannot open them.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES    IN SCHEMA app_private FROM PUBLIC, anon, authenticated;

-- 9.5 Stop new objects in `public` from being world-executable by default.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;


-- ============================================================================
-- 10. MANUAL STEPS -- the migration is not finished until these are done
-- ============================================================================
--
-- 10.1 CREATE THE ADMIN LOGIN
--      a) Supabase Dashboard -> Authentication -> Users -> "Add user".
--         Use a real address you control and a long random password.
--      b) Dashboard -> Authentication -> Providers -> Email:
--         turn OFF "Enable sign ups". Otherwise anyone can create an account
--         (they still would not be an admin, but there is no reason to allow it).
--      c) Add that user to the allowlist:
--
--          INSERT INTO app_private.admin_users (user_id, email)
--          SELECT id, email FROM auth.users WHERE email = 'you@yolkshire.com'
--          ON CONFLICT (user_id) DO NOTHING;
--
--      Repeat (a) and (c) per admin. Removing an admin is a DELETE from
--      app_private.admin_users -- no redeploy, no shared secret to rotate.
--
-- 10.2 ROTATE THE STAFF PINS  <<< DO THIS, "2010" IS PUBLIC >>>
--      Give each branch its own PIN so a leak is scoped and revocable:
--
--          UPDATE app_private.staff_pins
--          SET pin_hash = crypt('7431', gen_salt('bf', 10)), updated_at = now()
--          WHERE branch = 'Kothrud';
--
--      ...once per branch, each with a different 4-digit PIN. The plaintext is
--      never stored; brute force is capped at 10 wrong guesses per IP and 5 per
--      card per 15 minutes, then a 30 minute block.
--
-- 10.3 VERIFY THE LOCKDOWN
--      With PUBLISHABLE_KEY set to the key in js/app.js, all three of these
--      must fail:
--
--        # Expect: permission denied for table cards
--        curl -s "https://tslqynxiwlndudvwihby.supabase.co/rest/v1/cards?select=*" \
--             -H "apikey: $PUBLISHABLE_KEY"
--
--        # Expect: permission denied
--        curl -s -X PATCH "https://tslqynxiwlndudvwihby.supabase.co/rest/v1/cards?id=eq.YSLC001" \
--             -H "apikey: $PUBLISHABLE_KEY" -H "Content-Type: application/json" \
--             -d '{"visits": 9}'
--
--        # Expect: {"ok":false,"error":"bad_pin"}
--        curl -s -X POST "https://tslqynxiwlndudvwihby.supabase.co/rest/v1/rpc/card_record_visit" \
--             -H "apikey: $PUBLISHABLE_KEY" -H "Content-Type: application/json" \
--             -d '{"p_card_id":"YSLC001","p_campaign":"public","p_staff_pin":"0000"}'
--
--      And this must succeed, returning one card with a masked phone:
--
--        curl -s -X POST "https://tslqynxiwlndudvwihby.supabase.co/rest/v1/rpc/card_lookup" \
--             -H "apikey: $PUBLISHABLE_KEY" -H "Content-Type: application/json" \
--             -d '{"p_card_id":"YSLC001","p_campaign":"public"}'
--
-- ============================================================================
