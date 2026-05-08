# Yolkshire Loyalty Card Tracker

Static web app and print-production helper files for Yolkshire's Golden Yolk Loyalty Program.

The tracker lets customers activate a physical loyalty card by scanning its QR code, view their stamp progress, and let staff mark eligible visits with a staff PIN. It also includes an admin dashboard for viewing loyalty records and QR/card generation scripts for producing physical cards.

## Current Program Rules

- Customers collect stamps on a physical loyalty card.
- A stamp can be earned only when the bill value is ₹200 or more.
- Only one visit/stamp can be marked per card per day.
- One phone number can be registered with only one loyalty card.
- Customers can complete their 9 visits at any Yolkshire branch.
- After 9 visits, the card is complete and no more visits should be marked on that card.
- The original physical card is required for stamping.
- Lost physical cards cannot be replaced with recovered stamps.
- The offer is valid until 31 December 2026.

## Staff Instructions

1. Give the loyalty card to the customer.
2. Ask the customer to scan the QR code and register the card with their name and phone number.
3. On every visit after registration, either the customer or staff can scan the card QR code.
4. Staff must enter the staff PIN (`2010`) to mark the visit.
5. After marking the visit online, staff should also sign/stamp the physical card. This is not mandatory but recommended.
6. Mark a visit only when the bill value is ₹200 or more.
7. Only one visit can be marked per day. The system will not allow more than one visit on the same day.
8. The customer can complete their 9 visits at any Yolkshire branch.
9. After 9 visits, the card is complete. No more visits can be marked on that card.
10. One phone number can be registered with only one loyalty card. The system will not allow the same phone number to be used again.
11. If the card is lost, we cannot replace the stamps or recover the physical card.
12. Always check that the visit is successfully updated on the phone before signing/stamping the card.
13. Do not mark visits before billing is completed.
14. Do not share the staff PIN with customers.
15. If the QR code does not work, the card is damaged, or the system shows an error, inform the manager before marking anything manually.

## Terms And Conditions

These terms should be shown in the tracker later, especially on the card lookup, activation, and visit pages.

- Minimum order of ₹200 to earn a stamp.
- Card is non-transferable.
- Not valid on delivery or takeaway.
- One card per person during the offer period.
- Original physical card required for stamping.
- Valid until 31st December 2026.

Implementation note: `PIPELINE.md` already tracks Terms & Conditions integration as a future feature. Add these terms to the in-app modal/toggle when that work is implemented.

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

Both customer and admin flows use SheetDB:

```js
https://sheetdb.io/api/v1/im2qg2cit3cco
```

Expected SheetDB fields:

- `id`: card ID, for example `YSLC001`.
- `name`: registered customer name.
- `phone`: canonical phone number with country code.
- `visits`: current visit/stamp count.
- `last_visit`: latest visit timestamp.
- `history`: pipe-separated activation/visit history with optional branch suffixes.

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
