# Master Product, UI/UX & Engineering Implementation Plan

Comprehensive implementation roadmap and architectural specification for the **Yolkshire Loyalty Card Tracker**, incorporating single-branch membership locking, external Master Dashboard feed APIs, in-app Terms & Conditions, and frontend/security hardening.

---

## 1. Goal Description & Context

The **Yolkshire Loyalty Card Tracker** is a production static web application and database engine supporting physical-to-digital loyalty programs:
1. **Public Campaign ("Golden Yolk Loyalty Program")**: 9-visit milestone stamp rewards.
2. **PYC Campaign ("YolKlub Loyalty Program")**: 10-visit partner club milestone stamp rewards.

This plan details the technical and product upgrades required to enforce **Single-Branch Membership Locking**, build an **External Master Dashboard Data Feed API**, integrate **In-App Terms & Conditions**, and modernize the **Admin & Security Architecture**.

---

## 2. Strategic Constraints & Rules

> [!IMPORTANT]
> **Single-Branch Membership Rule (Active Enforcement)**:
> Members are permanently locked to their registered Home Branch at card activation. Stamps and reward redemptions cannot be earned at any other branch.

> [!NOTE]
> **Master Dashboard Integration**:
> An external Master Dashboard (Viva Foods BI / Management Hub) will ingest live and aggregated loyalty metrics. We expose high-performance Supabase PostgREST endpoints and dedicated SQL Analytics Views with secure API-key authentication.

---

## 3. Master Dashboard Feed API Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    MASTER DASHBOARD DATA INTEGRATION                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   VIVA FOODS MASTER DASHBOARD / BI                                          │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ • Real-time Outlet KPIs                                             │   │
│   │ • Cross-Brand Customer Lifetime Value (LTV)                         │   │
│   │ • Milestone Redemption Velocity                                     │   │
│   └───────────────────▲─────────────────────────────▲───────────────────┘   │
│                       │                             │                       │
│     1. REST Polling / Extraction          2. Realtime CDC / Webhooks        │
│                       │                             │                       │
│   SUPABASE REST API / POSTGREST (HTTPS Bearer Auth)                         │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ Endpoint 1: `/rest/v1/cards?select=*` (Full Transactional Ledger)   │   │
│   │ Endpoint 2: `/rest/v1/loyalty_branch_summary` (Aggregated KPIs)    │   │
│   │ Endpoint 3: `/rest/v1/loyalty_daily_velocity` (Time-Series Activity)│   │
│   └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### API Endpoints for Master Dashboard Ingestion

#### 1. Real-Time Branch Summary View (`GET /rest/v1/loyalty_branch_summary`)
Provides immediate high-level health per outlet without calculating sums on the client:

```sql
-- Database View for Master Dashboard Aggregation
CREATE OR REPLACE VIEW public.loyalty_branch_summary AS
SELECT 
    COALESCE(branch, 'Unassigned') AS branch,
    campaign,
    COUNT(*) AS total_registered_cards,
    COUNT(*) FILTER (WHERE visits > 0 AND visits < CASE WHEN campaign = 'pyc' THEN 10 ELSE 9 END) AS active_cards,
    COUNT(*) FILTER (WHERE visits >= CASE WHEN campaign = 'pyc' THEN 10 ELSE 9 END) AS completed_cards,
    ROUND(AVG(LEAST(visits, CASE WHEN campaign = 'pyc' THEN 10 ELSE 9 END))::numeric, 2) AS avg_stamps_per_card,
    MAX(last_visit) AS latest_activity_at
FROM public.cards
WHERE name IS NOT NULL AND name != ''
GROUP BY branch, campaign;
```

* **HTTP Method**: `GET`
* **Headers**: `apikey: <MASTER_SERVICE_KEY>`, `Authorization: Bearer <MASTER_SERVICE_KEY>`
* **Sample Response Payload**:
```json
[
  {
    "branch": "Kothrud",
    "campaign": "public",
    "total_registered_cards": 342,
    "active_cards": 210,
    "completed_cards": 48,
    "avg_stamps_per_card": 4.12,
    "latest_activity_at": "2026-08-15T16:45:00.000Z"
  },
  {
    "branch": "Aundh",
    "campaign": "public",
    "total_registered_cards": 289,
    "active_cards": 180,
    "completed_cards": 35,
    "avg_stamps_per_card": 3.85,
    "latest_activity_at": "2026-08-15T17:10:00.000Z"
  },
  {
    "branch": "PYC",
    "campaign": "pyc",
    "total_registered_cards": 156,
    "active_cards": 98,
    "completed_cards": 22,
    "avg_stamps_per_card": 5.40,
    "latest_activity_at": "2026-08-15T15:20:00.000Z"
  }
]
```

#### 2. Transactional Ledger Feed (`GET /rest/v1/cards`)
Supports full ETL extraction with standard query filters, pagination, and sorting:
* `GET /rest/v1/cards?select=id,name,phone,branch,visits,last_visit,campaign,created_at&last_visit=gte.2026-08-01`
* `Order`: `last_visit.desc`
* `Pagination`: `limit=100&offset=0` (or `Range: 0-99` header)

---

## 4. Proposed Changes by Component

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            COMPONENT CHANGE MAP                             │
├──────────────────────┬──────────────────────────────────────────────────────┤
│ 1. [js/app.js]       │ • Single-Branch registration payload & lock badge    │
│                      │ • Branch-mismatch validation guard on handleVisit()  │
│                      │ • Terms & Conditions drawer modal controller         │
│                      │ • Eggomaniac completion banner styling pop           │
├──────────────────────┼──────────────────────────────────────────────────────┤
│ 2. [js/admin.js]     │ • XSS escaping on all DOM interpolations             │
│                      │ • Registered Home Branch column in table             │
│                      │ • Asia/Kolkata calendar-boundary date filters        │
├──────────────────────┼──────────────────────────────────────────────────────┤
│ 3. [index.html]      │ • Terms & Conditions modal template & triggers       │
│                      │ • Accessible ARIA roles & progress bar semantics     │
│                      │ • Landing page role cards (Customer vs Staff)        │
├──────────────────────┼──────────────────────────────────────────────────────┤
│ 4. [css/styles.css]  │ • M3 drawer transition & backdrop-blur styles        │
│                      │ • High-contrast badge classes for reward text        │
├──────────────────────┼──────────────────────────────────────────────────────┤
│ 5. [Documentation]   │ • README.md, PIPELINE.md, and Master API Blueprint   │
└──────────────────────┴──────────────────────────────────────────────────────┘
```

---

### Component 1: Customer Tracker App (`index.html` & `js/app.js`)

#### [MODIFY] [`js/app.js`](file:///c:/Users/VaishaliVyas/OneDrive%20-%20Viva%20Foods/Built%20Tools/loyalty-card-tracker/js/app.js)
1. **Branch Locking on Registration**:
   * Collect `regBranch` and save to `payload.branch`.
   * Initialize `history` as `ISO_DATE@Branch`.
2. **Single-Branch Guard on Stamping**:
   * Pre-select or lock stamping branch to `currentUser.branch`.
   * If a branch mismatch is detected during visit collection, display a blocking error dialog.
3. **Terms & Conditions Modal**:
   * Implement `openTnCModal()` and `closeTnCModal()` with keyboard and focus trap handlers.
4. **Enhanced Eggomaniac Banner**:
   * Enlarge completion headline, add gold trophy badge styling, and retain Instagram/WhatsApp feedback action buttons.

#### [MODIFY] [`index.html`](file:///c:/Users/VaishaliVyas/OneDrive%20-%20Viva%20Foods/Built%20Tools/loyalty-card-tracker/index.html)
1. Inject the `#tnc-modal` bottom-drawer / dialog container.
2. Add contextual `(i)` trigger in the header bar.
3. Upgrade landing page choice cards with clear visual hierarchy and distinct role icons.

---

### Component 2: Admin Dashboard (`admin.html` & `js/admin.js`)

#### [MODIFY] [`js/admin.js`](file:///c:/Users/VaishaliVyas/OneDrive%20-%20Viva%20Foods/Built%20Tools/loyalty-card-tracker/js/admin.js)
1. **XSS Hardening**: Wrap all rendered row elements (`user.id`, `user.name`, `user.phone`, `user.branch`, `user.member_id`) through `escapeHTML()`.
2. **Home Branch Column**: Replace *"Last Branch"* table header with **"Home Branch"**.
3. **Calendar Date Filtering**: Standardize date calculations to Asia/Kolkata calendar day/week/month boundaries rather than 24-hour rolling windows.

---

### Component 3: Database & API Setup (Supabase)

#### Database Migration & Views
1. Add `branch` column on `cards` table with index.
2. Create `loyalty_branch_summary` database view for the Master Dashboard.
3. Apply Row Level Security (RLS) policies allowing public read/write by card ID and privileged master API extraction.

---

## 5. Verification Plan

### Automated & Manual Test Cases

| ID | Test Case | Steps | Expected Outcome |
| :--- | :--- | :--- | :--- |
| **TC-01** | Single-Branch Registration | Register new card `YSLC991` with branch `Kothrud`. | Card record in Supabase has `branch = 'Kothrud'`. Profile displays `Home Branch: Kothrud 🔒`. |
| **TC-02** | Branch Mismatch Stamping Block | Attempt to collect stamp on `YSLC991` selecting branch `Aundh`. | System displays "Branch Mismatch Alert" and halts without modifying visits count. |
| **TC-03** | Valid Home Branch Stamping | Enter PIN `2010` for `YSLC991` at `Kothrud`. | Stamp increments from 0 to 1; history log records `ISO@Kothrud`. |
| **TC-04** | Terms & Conditions Modal | Tap `(i)` info icon on profile. | Modal slides in with backdrop-blur; pressing `Escape` or "I Understand" closes it. |
| **TC-05** | Master Dashboard View API | Query `GET /rest/v1/loyalty_branch_summary`. | Returns valid JSON array of per-branch active, completed, and average visit KPIs. |
| **TC-06** | Admin Dashboard XSS Test | Mock customer name `<script>alert(1)</script>`. | Admin table renders safe sanitized text without executing JavaScript. |
| **TC-07** | Certified Eggomaniac Celebration | Collect 9th visit on public card. | Cracking egg animation triggers; gold completion card displays enlarged celebratory typography. |

---

## 6. Implementation & Release Order

1. **Step 1**: Commit & push master architectural plan and blueprint document.
2. **Step 2**: Apply database migration & create `loyalty_branch_summary` view for Master Dashboard ingestion.
3. **Step 3**: Implement frontend single-branch locking and terms modal in `index.html` and `js/app.js`.
4. **Step 4**: Implement admin XSS sanitization and calendar filter updates in `admin.html` and `js/admin.js`.
5. **Step 5**: Run end-to-end multi-branch validation test suite.
