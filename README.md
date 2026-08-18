# Yolkshire Loyalty Card Tracker

Static web app and print-production helper files for Yolkshire's Golden Yolk Loyalty Program.

The tracker lets customers activate a physical loyalty card by scanning its QR code, view their stamp progress, and let staff mark eligible visits with a staff PIN. It also includes an admin dashboard for viewing loyalty records and QR/card generation scripts for producing physical cards.

## Current Program Rules

- Customers collect stamps on a physical loyalty card.
- A stamp can be earned only when the bill value is ₹200 or more.
- Only one visit/stamp can be marked per card per day.
- One phone number can be registered with only one loyalty card.
- **Single-Branch Lock**: Members can only collect stamps and redeem rewards at their registered Home Branch.
- After 9 visits (public) or 10 visits (PYC), the card is complete and no more visits should be marked on that card.
- The original physical card is required for stamping.
- Lost physical cards cannot be replaced with recovered stamps.
- The offer is valid until 31 December 2026 (Dine-in only, not valid on delivery/takeaway).

## Terms And Conditions Modal

Terms and Conditions are built directly into the web application:
- Accessible via the `(i)` floating icon on the Customer Profile.
- Accessible via the "View Terms & Conditions" trigger on the Card Lookup and Registration pages.
- Dynamic campaign support (Public 9-visit terms vs. PYC Gymkhana 10-visit terms).

## Security Model

The app is a static site, so **nothing enforced in the browser is enforced at all**. Every
rule that matters lives in Postgres. Setup script: `supabase_security.sql`.

- The publishable key in `js/app.js` has **no table access**. It may call exactly three
  functions: `card_lookup`, `card_register`, `card_record_visit`.
- A customer reaches exactly one card: the ID printed on the card in their hand. There is
  no endpoint that returns more than one row to a customer.
- Phone numbers are **masked server-side** (`+91 XXXXXX 3210`). The raw number never
  reaches a customer's browser.
- Stamping sends only the card ID and the staff PIN. The new visit count, the branch and
  the timestamp are all derived in Postgres, so a customer cannot stamp their own card or
  jump to a reward.
- Staff PINs are **bcrypt-hashed, per branch**, and never leave the database. Brute force
  is capped at 10 wrong guesses per IP and 5 per card per 15 minutes.
- The admin dashboard requires a **Supabase Auth login** that also appears in the
  `app_private.admin_users` allowlist. Removing an admin is a `DELETE` — no redeploy, no
  shared secret to rotate.

Run `bash verify-migration.sh` (needs Docker) to prove these properties against a
throwaway Postgres before applying the migration to production.

## Master Dashboard Feed API

The loyalty engine exposes aggregated data feeds for external Master Dashboards
(e.g., Viva Foods BI). **These require the `service_role` key** and must be called from a
server, never from a browser:
- **Aggregated Branch KPI Feed**: `GET https://tslqynxiwlndudvwihby.supabase.co/rest/v1/loyalty_branch_summary`
- **Transactional Ledger Feed**: `GET https://tslqynxiwlndudvwihby.supabase.co/rest/v1/cards?select=*`
- Database schema setup script is located in `supabase_master_api.sql`.

## App Flow

### Customer Entry

- `index.html` is the main customer-facing tracker.
- If opened without a card ID, it shows a landing page with customer/admin choices and manual card lookup.
- If opened with a card ID query string, such as `?id=YSLC001`, it searches the SheetDB data source for that card.
- Unregistered cards show the activation form.
- Registered cards show profile, progress, rewards, visit history, and the staff PIN stamping area.

### Card Activation

Customers register with:

- Full name.
- Phone number with country code.
- Collection branch.

The app validates the name, validates phone length by ISD code, normalizes phone numbers, and checks existing SheetDB rows to prevent the same phone number being used on another card.

### Visit Marking

Staff select the branch, enter the staff PIN, and tap `Collect Stamp`.

The app checks:

- Branch is selected.
- PIN is `2010`.
- The card has not already received a stamp today.
- The card is not complete.

When a stamp is recorded, the app updates:

- `visits`
- `last_visit`
- `history`

History entries store date/time and branch in this format:

```text
ISO_DATE@Branch Name
```

Multiple history entries are separated with `|`.

### Rewards

The customer UI highlights reward milestones:

- 3 visits: Free Beverage.
- 6 visits: Free Dessert.
- 9 visits: Free Meal.

The current implementation treats reward redemption confirmation as part of the next stamping flow for earlier rewards, and shows a celebration on milestone completion.

## Admin Dashboard

`admin.html` opens the admin dashboard.

Current access:

- Admin name: free text.
- Admin PIN: `2010`.

Dashboard features:

- Loads loyalty records from SheetDB.
- Searches by customer name, phone, or card ID.
- Filters by branch.
- Filters by status: all, completed, uncompleted.
- Filters by date range.
- Shows customer, active-card, average-visit, completed-card, reward, and branch-performance stats.
- Expands rows to show visit history.

Security note: the current admin login is a simple client-side PIN. `PIPELINE.md` tracks replacing this with stronger authentication and authorization.

## Data Source

Both customer and admin flows use Supabase REST API:

```js
https://tslqynxiwlndudvwihby.supabase.co/rest/v1/cards
```

The database supports both public and PYC campaigns filtered by `campaign` column (`public` vs `pyc`).

Expected database fields:

- `id`: card ID, for example `YSLC001`.
- `name`: registered customer name.
- `phone`: canonical phone number with country code.
- `visits`: current visit/stamp count.
- `last_visit`: latest visit timestamp.
- `history`: pipe-separated activation/visit history with optional branch suffixes.

PYC records use the same fields plus:

- `member_id`: normalized PYC member ID.

Data integrity notes:

- Duplicate phone checks are currently done in the frontend.
- Daily visit checks are currently done in the frontend.
- SheetDB/API credentials and staff auth are visible in the static client code.
- For stronger enforcement, add a backend/API layer before scaling or exposing this broadly.

## Files

- `index.html`: customer-facing loyalty tracker.
- `admin.html`: admin dashboard.
- `js/app.js`: customer activation, profile, rewards, and visit-stamping logic.
- `js/admin.js`: admin login, filters, dashboard stats, and table rendering.
- `css/styles.css`: shared custom styling.
- `yolkshire-new-logo-fhd.png`: logo used by the app and QR generation.
- `PIPELINE.md`: future features, bug fixes, and security backlog.
- `qr-gen/`: QR/card production scripts and generated assets.

## QR And Card Production

The `qr-gen` folder contains scripts and outputs for physical cards.

### Generate QR Codes

`qr-gen/generate_qrs.py` creates:

- `qrs/YSLC001.png` through `qrs/YSLC999.png`.
- `qrs.csv`
- `qrs-indesign.csv`
- `qrs-chunk-*.csv`
- `qrs-xlsx-*.xlsx`

Install dependencies once:

```powershell
pip install "qrcode[pil]" openpyxl
```

Run:

```powershell
cd qr-gen
python generate_qrs.py
```

Generated QR URLs currently point to:

```text
https://yolkshire-pune.github.io/loyalty-card-tracker/?id=YSLC###
```

### Build Card PDFs

`qr-gen/build_cards_pdf.py` overlays QR codes and card IDs on the card template PDF.

Install dependencies once:

```powershell
pip install pymupdf
```

Run a sample:

```powershell
cd qr-gen
python build_cards_pdf.py --sample
```

Run the full 999-card output:

```powershell
cd qr-gen
python build_cards_pdf.py
```

Outputs are written to:

```text
qr-gen/print/
```

The script depends on the Canva template path configured inside `build_cards_pdf.py`. Update `TEMPLATE` if the source PDF moves.

### Affinity Publisher Merge

`qr-gen/codex/AFFINITY_DATA_MERGE_STEPS.md` documents an alternate Affinity Publisher data merge flow, including QR size, card ID position, and the 31 December 2026 expiry-date correction.

## Running Locally

This is a static site. You can open `index.html` directly in a browser, but a local static server is better for testing browser behavior.

Example:

```powershell
python -m http.server 8000
```

Then open:

```text
http://localhost:8000/
```

Example card URL:

```text
http://localhost:8000/?id=YSLC001
```

## Deployment

The QR generator points customers to the GitHub Pages URL:

```text
https://yolkshire-pune.github.io/loyalty-card-tracker/
```

If the production hosting URL changes, update `BASE_URL` in `qr-gen/generate_qrs.py` and regenerate any QR assets that need to point at the new URL.

## Known Backlog

See `PIPELINE.md` for the current feature and technical backlog. Key items include:

- Add Terms & Conditions modal/toggle to customer lookup, activation, and visit pages.
- Improve final milestone styling.
- Make landing-page choice buttons more prominent.
- Replace simple PIN login with secure staff/manager accounts.
- Escape admin dashboard data before rendering.
- Review new-card visit count display.
- Normalize admin history numbering.
- Improve calendar-boundary date filters.
- Add backend-level duplicate phone and one-stamp-per-day enforcement.

## Important Operating Notes

- Staff should only stamp after billing is completed.
- Staff should verify the online update before signing/stamping the physical card.
- Manual exceptions should be handled by a manager.
- Do not share the staff PIN with customers.
- Keep physical card stamping aligned with online stamping wherever possible.
