# Future Features Pipeline

This document tracks upcoming features and enhancements for the Yolkshire Loyalty Card Tracker.

## 🛠️ UI/UX Enhancements

### 1. Final Milestone Styling
- **Task:** Increase text size for the "Yayy, you're a certified Eggomaniac now" line on the completion screen.
- **Goal:** Make the celebration feel more prominent and rewarding.

### 2. Landing Page Prominence
- **Task:** Make the "I am a Customer" and "I am an Admin" choice buttons more prominent.
- **Task:** Add an icon inside the circle for the Admin button (similar to the user icon for the Customer button).

### 3. Date & Time Formatting
- **Task:** Update "Last Visit" and "Completed Date" fields to show both Date and Time.
- **Format:** `5 Jun 2026, 9:57 pm`.
- **Change:** Transition from `6/5/2026` to a more readable long-form date format.

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

### 6. Verify and Strengthen Duplicate Phone Check
- **Description:** Ensure that no two cards can be registered with the same phone number.
- **Action:** Double-check the existing implementation in `handleRegistration` and ensure it covers all edge cases (ISD codes, formatting differences).

---
*Note: This pipeline is continually updated based on stakeholder feedback and business needs.*
