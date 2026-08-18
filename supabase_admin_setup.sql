-- ============================================================================
-- Yolkshire Loyalty Engine: Admin & Staff PIN Management
--
-- Everything here is RUNNABLE SQL, not commented-out examples -- edit the
-- values, select the block you want, and run it. (The snippets that used to
-- live inside comment markers in supabase_security.sql are here instead:
-- copying a commented block sends Postgres nothing but comments, which fails
-- with "syntax error at end of input" at LINE 0.)
--
-- Prerequisite: supabase_security.sql has been run in full.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. ADD ADMINS
--
-- Create each person in the Dashboard first: Authentication -> Users -> "Add
-- user". Then list their addresses below. Signing in is not enough on its own;
-- only addresses present in app_private.admin_users can read the dashboard.
--
-- Also turn OFF Authentication -> Providers -> Email -> "Enable sign ups", so
-- nobody can self-register an account.
-- ---------------------------------------------------------------------------
-- One statement per admin. Copy a line, change the address and the name.
-- Deliberately NOT a comma-separated VALUES list: deleting or adding an entry
-- there leaves a trailing comma, and Postgres reports it as a confusing
-- "syntax error at or near )" pointing at the line AFTER the mistake.
INSERT INTO app_private.admin_users (user_id, email, display_name)
SELECT id, email, 'Vaishali' FROM auth.users WHERE email = 'you@yolkshire.com'
ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name;

INSERT INTO app_private.admin_users (user_id, email, display_name)
SELECT id, email, 'Store Manager' FROM auth.users WHERE email = 'manager@yolkshire.com'
ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name;

-- Check it took. Any address you listed that is missing here does not yet exist
-- in Authentication -> Users -- the INSERT above skips those silently.
SELECT email, display_name, created_at FROM app_private.admin_users ORDER BY email;


-- ---------------------------------------------------------------------------
-- 1b. SET OR CHANGE DISPLAY NAMES
--
-- This is what the dashboard greets them with ("Welcome, Vaishali"). Without
-- it, the greeting falls back to the local part of the address, so
-- vaishali@yolkshire.com shows as "Vaishali" anyway -- set these only when you
-- want something different from that.
-- ---------------------------------------------------------------------------
UPDATE app_private.admin_users SET display_name = 'Vaishali'      WHERE email = 'you@yolkshire.com';
UPDATE app_private.admin_users SET display_name = 'Store Manager' WHERE email = 'manager@yolkshire.com';

SELECT email, display_name FROM app_private.admin_users ORDER BY email;


-- ---------------------------------------------------------------------------
-- 2. REMOVE AN ADMIN
--
-- Takes effect on their next request. No redeploy, no shared secret to rotate.
-- (Their Supabase Auth account still exists; delete it in the Dashboard too if
-- they should not be able to sign in at all.)
-- ---------------------------------------------------------------------------
-- DELETE FROM app_private.admin_users
-- WHERE email = 'former.employee@yolkshire.com';


-- ---------------------------------------------------------------------------
-- 3. ROTATE STAFF PINS -- all branches at once
--
-- Give every branch a DIFFERENT pin, so a leak is scoped to one branch and can
-- be rotated without disturbing the others. Only the bcrypt hash is stored; the
-- plaintext below is never saved, so keep your own record of what you set.
--
-- Brute force is capped by supabase_security.sql at 10 wrong guesses per IP and
-- 5 per card per 15 minutes, then a 30 minute block.
-- ---------------------------------------------------------------------------
UPDATE app_private.staff_pins AS s
SET pin_hash = crypt(v.pin, gen_salt('bf', 10)),
    updated_at = now()
FROM (VALUES
    ('Kothrud',         '0000'),
    ('Aundh',           '0000'),
    ('Salunkhe Vihar',  '0000'),
    ('Pimple Saudagar', '0000'),
    ('Wadgaon Sheri',   '0000'),
    ('Wakad',           '0000'),
    ('Bavdhan',         '0000'),
    ('PYC',             '0000')
) AS v(branch, pin)
WHERE s.branch = v.branch;
-- If this errors with "syntax error at or near )", check for a trailing comma
-- after the last branch above -- every row needs a comma EXCEPT the last.

-- All eight updated_at values should be the current time.
SELECT branch, active, updated_at FROM app_private.staff_pins ORDER BY branch;


-- ---------------------------------------------------------------------------
-- 4. ROTATE ONE BRANCH
-- ---------------------------------------------------------------------------
-- UPDATE app_private.staff_pins
-- SET pin_hash = crypt('1234', gen_salt('bf', 10)), updated_at = now()
-- WHERE branch = 'Kothrud';


-- ---------------------------------------------------------------------------
-- 5. ADD A BRANCH
--
-- New branches need a PIN row, or stamping at that branch returns 'bad_pin'.
-- Add the branch name to app_private.branch_ok() in supabase_security.sql too,
-- otherwise registration there is rejected as 'invalid_branch'.
-- ---------------------------------------------------------------------------
-- INSERT INTO app_private.staff_pins (branch, pin_hash)
-- VALUES ('Baner', crypt('1234', gen_salt('bf', 10)))
-- ON CONFLICT (branch) DO NOTHING;


-- ---------------------------------------------------------------------------
-- 6. SUSPEND A BRANCH'S STAMPING
--
-- Use if a PIN leaks and you need stamping stopped at that branch right now.
-- Re-enable by setting active = true, ideally with a fresh PIN via section 4.
-- ---------------------------------------------------------------------------
-- UPDATE app_private.staff_pins SET active = false WHERE branch = 'Kothrud';


-- ---------------------------------------------------------------------------
-- 7. CLEAR A RATE-LIMIT BLOCK
--
-- If staff lock themselves out by mistyping a PIN, this releases the block
-- rather than making them wait 30 minutes.
-- ---------------------------------------------------------------------------
-- Inspect what is currently blocked:
-- SELECT bucket, hits, blocked_until FROM app_private.rpc_throttle
-- WHERE blocked_until > now() ORDER BY blocked_until DESC;

-- Release one card, or one branch's device:
-- DELETE FROM app_private.rpc_throttle WHERE bucket = 'pinfail:card:YSLC001';
-- DELETE FROM app_private.rpc_throttle WHERE bucket LIKE 'pinfail:ip:%';
