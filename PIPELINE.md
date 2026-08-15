#  Future Features Pipeline

This document tracks upcoming features and enhancements for the Yolkshire Loyalty Card Tracker.

## 🛠️ UI/UX Enhancements

### 1. Final Milestone Styling ✅ Completed

- **Status:** Completion screen now features an enlarged bold "CERTIFIED EGGOMANIAC!" headline, trophy glow, and social feedback actions.

### 2. Landing Page Prominence ✅ Completed

- **Status:** Prominent dual role-selection cards with high elevation, dedicated icons (user & shield), and direct routing.

### 3. Date & Time Formatting ✅ Completed

- **Status:** Customer profile and Admin "Last Visit" format ISO timestamps as readable India-local date/time (`5 Jun 2026, 9:57 pm`).

### 4. Terms & Conditions Integration ✅ Completed

- **Status:** Accessible modal drawer implemented on customer profile (`(i)` trigger), card lookup, and activation screens.

### 5. Single-Branch Membership Locking ✅ Completed

- **Status:** Registered cards are permanently locked to their home branch; stamping validates branch match and blocks cross-branch usage.

## 🔒 Security & Data Integrity

### 6. Escape Admin Dashboard Data ✅ Completed

- **Status:** Full XSS sanitization implemented via `escapeHTML()` on all dynamic customer table fields.

### 7. Advanced Authentication & Authorization

- **Description:** Replace the simple PIN-based login (`2010`) with a robust, secure authentication system.
- **Details:**
  - Unique admin accounts with individual passwords.
  - Role-based access control (Staff vs. Manager views).

### 8. Verify and Strengthen Duplicate Phone Check ✅ Completed

- **Status:** Registration compares canonical E.164 phone numbers across all records.

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
