#  Future Features Pipeline

This document tracks upcoming features and enhancements for the Yolkshire Loyalty Card Tracker.

## 🛠️ UI/UX Enhancements

### 1. Final Milestone Styling

- **Task:** Increase text size for the "Yayy, you're a certified Eggomaniac now" line on the completion screen.
- **Goal:** Make the celebration feel more prominent and rewarding.

### 2. Landing Page Prominence

- **Task:** Make the "I am a Customer" and "I am an Admin" choice buttons more prominent.
- **Task:** Add an icon inside the circle for the Admin button (similar to the user icon for the Customer button).

### 3. Date & Time Formatting ✅ Completed

- **Status:** Customer profile and Admin "Last Visit" now format ISO timestamps as readable India-local date/time.
- **Format:** `5 Jun 2026, 9:57 pm`.
- **Note:** Visit history was already displaying correctly; the main Admin row and customer profile have now been aligned.

### 4. Terms & Conditions Integration

- **Task:** Add a TnC toggle/modal in two places:
  - "Find your Card" page.
  - "Activate Card" page.
- **Task:** Add an info (`i`) icon on the visit pages that opens the same Terms & Conditions.

## 🔒 Security & Data Integrity

### 5. Advanced Authentication & Authorization

- **Description:** Replace the simple PIN-based login (`2010`) with a robust, secure authentication system.
- **Details:**
  - Unique admin accounts with individual passwords.
  - Role-based access control (Staff vs. Manager views).

### 6. Verify and Strengthen Duplicate Phone Check ✅ Completed

- **Description:** Ensure that no two cards can be registered with the same phone number.
- **Status:** Registration now compares canonical phone numbers across all SheetDB rows.
- **Covered Cases:**
  - `+919876543210`
  - `919876543210`
  - `+91 98765 43210`
  - formatted/punctuated phone numbers.
- **Remaining Risk:** This is still client-side validation. Two simultaneous registrations could theoretically bypass it until uniqueness is enforced through a backend or database-level rule.

### 7. Escape Admin Dashboard Data

- **Description:** The Admin Dashboard renders SheetDB values into `innerHTML`.
- **Why It Matters:** Names, phones, branches, and IDs should be escaped before rendering to prevent broken layout or accidental HTML injection from spreadsheet data.
- **Action:**
  - Add/reuse an `escapeHTML` helper in `js/admin.js`.
  - Escape customer name, phone, card ID, branch, last visit, and history fields before inserting them into table rows/cards.
  - Keep numeric KPIs as parsed numbers, not raw strings.

### 8. Fix New Card Visit Count Display

- **Description:** Customer profile currently uses `Math.max(1, visits)` for display.
- **Why It Matters:** Activated cards with `0` actual stamps can appear as `1/9`, which may confuse staff and customers.
- **Action:**
  - Show `0/9` for activated cards with no collected stamps if card activation should not count as a stamp.
  - Confirm progress bar should start at `0%` for `0` visits.
  - Check reward prompts still appear only on true stamp milestones.

### 9. Normalize Admin History Numbering

- **Description:** Admin history uses `index + 1` for all history entries, while the customer view treats the first entry as card activation.
- **Why It Matters:** Activation can be mislabeled as a visit, making reports and customer histories inconsistent.
- **Action:**
  - Treat first history entry as "Card Activation" or "Card Collection".
  - Number later stamp entries as Visit #1, Visit #2, etc.
  - Keep milestone highlighting on true reward visits, not activation.

### 10. Improve Admin Calendar Filters

- **Description:** Admin date filters use rolling hour/day differences for "Today", "This Week", and "This Month".
- **Why It Matters:** Business reporting usually expects calendar-day/week/month boundaries in Asia/Kolkata, not rolling 24/7/30-day windows.
- **Action:**
  - Use Asia/Kolkata date keys for "Today".
  - Define "This Week" and "This Month" using calendar boundaries.
  - Keep "Last 7 Days" and "Last 30 Days" as rolling-window filters.
  - Ensure custom date range includes the full selected end day.

### 11. Backend-Level Data Integrity

- **Description:** Current duplicate phone and daily visit checks run in the static frontend.
- **Why It Matters:** Frontend checks are helpful but not authoritative against simultaneous actions or manual SheetDB edits.
- **Action:**
  - Evaluate adding a small backend/API layer for registration and stamping.
  - Enforce phone uniqueness and one-stamp-per-day server-side.
  - Move API keys and staff/admin auth out of public client code.

---

*Note: This pipeline is continually updated based on stakeholder feedback and business needs.*
