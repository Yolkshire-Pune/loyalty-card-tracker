#!/usr/bin/env bash
# ============================================================================
# Proves supabase_security.sql before it touches production.
#
# Spins up a throwaway Postgres 15, stubs the Supabase-provided objects
# (auth schema, anon/authenticated/service_role roles), creates a `cards` table
# with the OLD text column types so the type migration is exercised, runs the
# migration, then asserts the security properties actually hold.
#
# Usage:  start Docker Desktop, then  bash verify-migration.sh
# ============================================================================
set -euo pipefail

CONTAINER=yolk-migration-test
PSQL="docker exec -i $CONTAINER psql -U postgres -v ON_ERROR_STOP=1 -q"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> Starting throwaway Postgres 15"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=pw postgres:15 >/dev/null
for _ in $(seq 1 60); do
    docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
    sleep 1
done

echo "==> Stubbing the Supabase environment"
$PSQL <<'SQL'
-- Supabase installs pgcrypto into an `extensions` schema, NOT into public.
-- Any SECURITY DEFINER function with a pinned search_path that omits it cannot
-- see crypt(), and 500s at runtime. Mirror that layout so the harness catches it.
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);

-- Supabase derives auth.uid() from the JWT. Here it reads a GUC the tests set.
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('test.uid', true), '')::uuid;
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;

-- The pre-migration schema: everything text, as the Google Sheets import left
-- it, INCLUDING text defaults. A default that cannot be cast to the new type
-- aborts ALTER COLUMN TYPE, so the migration must drop it first.
CREATE TABLE public.cards (
    id         text,
    name       text DEFAULT '',
    phone      text DEFAULT '',
    visits     text DEFAULT '0',
    last_visit text DEFAULT '',
    history    text DEFAULT '',
    branch     varchar(50),
    campaign   varchar(20),
    member_id  varchar(20)
);
GRANT ALL ON public.cards TO anon, authenticated, service_role;

-- Representative legacy rows.
INSERT INTO public.cards (id, name, phone, visits, last_visit, history) VALUES
    ('YSLC001', 'Asha Rao',  '+919876543210', '3',  '2026-08-01T10:00:00.000Z',
     '2026-08-01T10:00:00.000Z@Kothrud|2026-07-20T10:00:00.000Z@Kothrud|2026-07-01T10:00:00.000Z@Kothrud'),
    ('YSLC002', 'Ravi Nair', '+919812345678', '0', '2026-07-01T10:00:00.000Z',
     '2026-07-01T10:00:00.000Z@Aundh'),
    ('YSLC003', '',          '',              '0',  '',   '');
UPDATE public.cards SET visits = '8' WHERE id = 'YSLC001';

-- The master dashboard view from supabase_master_api.sql. It reads cards.visits,
-- which blocks retyping that column unless the migration drops and recreates it.
CREATE OR REPLACE VIEW public.loyalty_branch_summary AS
WITH normalized_cards AS (
    SELECT id,
        COALESCE(NULLIF(TRIM(branch), ''), 'Unassigned') AS branch,
        campaign, name, phone,
        COALESCE(NULLIF(regexp_replace(visits::text, '[^0-9]', '', 'g'), '')::integer, 0) AS visit_count,
        last_visit
    FROM public.cards
    WHERE name IS NOT NULL AND TRIM(name) != ''
)
SELECT branch, campaign,
    COUNT(*) AS total_registered_cards,
    COUNT(*) FILTER (WHERE visit_count > 0 AND visit_count < CASE WHEN campaign = 'pyc' THEN 10 ELSE 9 END) AS active_cards,
    COUNT(*) FILTER (WHERE visit_count >= CASE WHEN campaign = 'pyc' THEN 10 ELSE 9 END) AS completed_cards,
    ROUND(AVG(LEAST(visit_count, CASE WHEN campaign = 'pyc' THEN 10 ELSE 9 END))::numeric, 2) AS avg_stamps_per_card,
    MAX(last_visit) AS latest_activity_at
FROM normalized_cards
GROUP BY branch, campaign
ORDER BY branch ASC, campaign ASC;
GRANT SELECT ON public.loyalty_branch_summary TO anon, authenticated, service_role;
SQL

echo "==> Running supabase_security.sql"
$PSQL < supabase_security.sql

echo "==> Asserting security properties"
$PSQL <<'SQL'
DO $test$
DECLARE
    v_res    json;
    v_admin  uuid := '11111111-1111-1111-1111-111111111111';
    v_visits integer;
    v_ok     boolean;
BEGIN
    -- 1. Column types were migrated.
    ASSERT (SELECT data_type FROM information_schema.columns
            WHERE table_name = 'cards' AND column_name = 'visits') = 'integer',
        'visits should be integer';
    ASSERT (SELECT data_type FROM information_schema.columns
            WHERE table_name = 'cards' AND column_name = 'last_visit') = 'timestamp with time zone',
        'last_visit should be timestamptz';

    -- 2. anon has no direct table privileges left.
    ASSERT NOT has_table_privilege('anon', 'public.cards', 'SELECT'), 'anon must not SELECT cards';
    ASSERT NOT has_table_privilege('anon', 'public.cards', 'UPDATE'), 'anon must not UPDATE cards';
    ASSERT NOT has_table_privilege('anon', 'public.cards', 'INSERT'), 'anon must not INSERT cards';
    ASSERT NOT has_table_privilege('anon', 'public.cards', 'DELETE'), 'anon must not DELETE cards';
    ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.cards'::regclass), 'RLS must be on';

    -- 2b. The dependent view survived the retype, still works, and lost anon.
    ASSERT EXISTS (SELECT 1 FROM pg_views
                   WHERE schemaname = 'public' AND viewname = 'loyalty_branch_summary'),
        'loyalty_branch_summary must be recreated after the column retype';
    PERFORM count(*) FROM public.loyalty_branch_summary;
    ASSERT NOT has_table_privilege('anon', 'public.loyalty_branch_summary', 'SELECT'),
        'anon must not read the branch summary view';
    ASSERT has_table_privilege('service_role', 'public.loyalty_branch_summary', 'SELECT'),
        'service_role keeps the BI feed';

    -- 3. anon may execute exactly the three card RPCs, and nothing private.
    ASSERT has_function_privilege('anon', 'public.card_lookup(text,text)', 'EXECUTE'), 'card_lookup callable';
    ASSERT has_function_privilege('anon', 'public.card_record_visit(text,text,text)', 'EXECUTE'), 'card_record_visit callable';
    ASSERT NOT has_schema_privilege('anon', 'app_private', 'USAGE'), 'app_private must be unreachable';
    ASSERT NOT has_function_privilege('anon', 'public.is_admin()', 'EXECUTE'), 'is_admin not for anon';

    -- 4. Lookup returns one card, and the phone is masked.
    v_res := public.card_lookup('YSLC001', 'public');
    ASSERT (v_res ->> 'ok')::boolean, 'lookup should succeed';
    ASSERT v_res -> 'card' ->> 'phone_display' NOT LIKE '%9876543210%',
        'raw phone must never leave the database: ' || (v_res -> 'card' ->> 'phone_display');
    ASSERT v_res -> 'card' ->> 'phone_display' LIKE '%3210', 'last 4 digits should show';
    ASSERT (v_res -> 'card' ->> 'branch') = 'Kothrud', 'home branch derived from history';

    -- 5. A garbage / unknown card ID is rejected, not created.
    ASSERT (public.card_lookup('DROP TABLE', 'public') ->> 'error') = 'invalid_card', 'bad id rejected';
    ASSERT (public.card_lookup('PYCLC001', 'public') ->> 'error') = 'invalid_card', 'campaign/prefix mismatch rejected';

    -- 6. First scan of a valid unused ID creates a blank row.
    v_res := public.card_lookup('YSLC777', 'public');
    ASSERT (v_res ->> 'ok')::boolean, 'first scan should create the row';
    ASSERT NOT (v_res -> 'card' ->> 'registered')::boolean, 'new card is unregistered';

    -- 7. A wrong PIN is refused.
    ASSERT (public.card_record_visit('YSLC001', 'public', '0000') ->> 'error') = 'bad_pin', 'wrong pin refused';

    -- 8. The right PIN increments by exactly one, server-side.
    SELECT visits INTO v_visits FROM public.cards WHERE id = 'YSLC001';
    UPDATE public.cards SET last_visit = now() - interval '3 days',
        history = '2026-01-01T00:00:00.000Z@Kothrud' WHERE id = 'YSLC001';
    v_res := public.card_record_visit('YSLC001', 'public', '2010');
    ASSERT (v_res ->> 'ok')::boolean, 'correct pin should stamp: ' || v_res::text;
    ASSERT (v_res -> 'card' ->> 'visits')::integer = v_visits + 1,
        'must increment by exactly 1, got ' || (v_res -> 'card' ->> 'visits');

    -- 9. The daily limit is enforced in Postgres, not the browser.
    ASSERT (public.card_record_visit('YSLC001', 'public', '2010') ->> 'error') = 'daily_limit',
        'second stamp same day must be refused';

    -- 10. The completion cap holds.
    UPDATE public.cards SET visits = 9, last_visit = now() - interval '3 days',
        history = '2026-01-01T00:00:00.000Z@Kothrud' WHERE id = 'YSLC001';
    ASSERT (public.card_record_visit('YSLC001', 'public', '2010') ->> 'error') = 'card_complete',
        'completed card must be refused';

    -- 11. Registration validates, and refuses a duplicate phone.
    v_res := public.card_register('YSLC003', 'public', 'Meera Joshi', '+919000000001', 'Aundh', NULL);
    ASSERT (v_res ->> 'ok')::boolean, 'valid registration should succeed: ' || v_res::text;
    ASSERT (public.card_register('YSLC778', 'public', 'Copycat', '+919000000001', 'Aundh', NULL) ->> 'error')
        IS NOT DISTINCT FROM 'invalid_card', 'unknown card cannot register';

    PERFORM public.card_lookup('YSLC779', 'public');
    ASSERT (public.card_register('YSLC779', 'public', 'Copycat', '+919000000001', 'Aundh', NULL) ->> 'error')
        = 'phone_taken', 'duplicate phone must be refused';
    ASSERT (public.card_register('YSLC779', 'public', 'A1234', '+919000000002', 'Aundh', NULL) ->> 'error')
        = 'invalid_name', 'digits in name refused';
    ASSERT (public.card_register('YSLC779', 'public', 'Valid Name', '+919000000002', 'Narnia', NULL) ->> 'error')
        = 'invalid_branch', 'unknown branch refused';

    -- 12. A card cannot be re-registered over the original owner.
    ASSERT (public.card_register('YSLC003', 'public', 'Someone Else', '+919000000009', 'Aundh', NULL) ->> 'error')
        = 'already_registered', 're-registration must be refused';

    -- 13. is_admin gates on the allowlist, not merely on being signed in.
    INSERT INTO auth.users (id, email) VALUES (v_admin, 'admin@yolkshire.com');
    PERFORM set_config('test.uid', v_admin::text, true);
    ASSERT NOT public.is_admin(), 'signed in but not allowlisted => not admin';
    INSERT INTO app_private.admin_users (user_id, email) VALUES (v_admin, 'admin@yolkshire.com');
    ASSERT public.is_admin(), 'allowlisted => admin';
    PERFORM set_config('test.uid', '', true);
    ASSERT NOT public.is_admin(), 'anonymous => not admin';

    -- 13b. admin_me returns the caller's own row only, with a usable name.
    PERFORM set_config('test.uid', v_admin::text, true);
    ASSERT (public.admin_me() ->> 'is_admin')::boolean, 'admin_me: allowlisted => true';
    ASSERT (public.admin_me() ->> 'display_name') = 'Admin',
        'admin_me: falls back to the email local part, got ' || (public.admin_me() ->> 'display_name');
    UPDATE app_private.admin_users SET display_name = 'Vaishali' WHERE user_id = v_admin;
    ASSERT (public.admin_me() ->> 'display_name') = 'Vaishali', 'admin_me: uses display_name once set';
    PERFORM set_config('test.uid', '', true);
    ASSERT NOT (public.admin_me() ->> 'is_admin')::boolean, 'admin_me: anonymous => false';
    ASSERT public.admin_me() ->> 'email' IS NULL, 'admin_me must leak nothing when not an admin';

    RAISE NOTICE 'ALL ASSERTIONS PASSED';
END $test$;
SQL

echo "==> Asserting the PIN brute-force throttle blocks"
# One transaction per attempt, matching how PostgREST serves real requests.
BLOCKED=0
for n in 1 2 3 4 5 6 7 8; do
    R=$(docker exec -i "$CONTAINER" psql -U postgres -q -t -A \
        -c "SELECT public.card_record_visit('YSLC002','public','9999')->>'error';")
    echo "    attempt $n: $R"
    [ "$R" = "rate_limited" ] && BLOCKED=$((BLOCKED + 1))
done
if [ "$BLOCKED" -eq 0 ]; then
    echo "    *** FAIL: repeated wrong PINs were never throttled ***"
    exit 1
fi
echo "    OK: throttled after repeated failures"

echo "==> Asserting anon really is locked out, as the anon role itself"
docker exec -i "$CONTAINER" psql -U postgres -q <<'SQL'
SET ROLE anon;
\echo '-- expect: permission denied for table cards'
SELECT count(*) FROM public.cards;
SQL

echo
echo "==> DONE. Review the output above:"
echo "    'ALL ASSERTIONS PASSED' and a 'permission denied for table cards' both required."
