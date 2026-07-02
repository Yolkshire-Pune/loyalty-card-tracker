// --- CONSTANTS ---
const PUBLIC_API_URL = "https://sheetdb.io/api/v1/im2qg2cit3cco";
const PYC_API_URL = "https://sheetdb.io/api/v1/u51z5e743v1jr";
const BUSINESS_WHATSAPP = '+918446536065';
const INSTAGRAM_HANDLE = 'yolkshire';
const BRAND_NAME = "Yolkshire's Golden Yolk Loyalty Program";
const CAMPAIGNS = {
    public: {
        key: 'public',
        apiUrl: PUBLIC_API_URL,
        totalVisits: 9,
        rewards: {
            3: 'Free Beverage',
            6: 'Free Dessert',
            9: 'Free Meal'
        },
        fixedBranch: null,
        requiresMemberId: false,
        title: BRAND_NAME
    },
    pyc: {
        key: 'pyc',
        apiUrl: PYC_API_URL,
        totalVisits: 10,
        rewards: {
            5: 'Free Drink/Dessert',
            10: 'Free Dish/Dessert'
        },
        fixedBranch: 'PYC',
        requiresMemberId: true,
        title: "YolKlub Loyalty Program"
    }
};
// [min, max] digit length (mobile) per ISD code
const PHONE_RULES = {
    '+91': [10, 10],  // India
    '+1': [10, 10],  // USA / Canada
    '+44': [10, 10],  // UK
    '+61': [9, 9],    // Australia
    '+64': [8, 10],   // New Zealand
    '+971': [9, 9],    // UAE
    '+966': [9, 9],    // Saudi Arabia
    '+974': [8, 8],    // Qatar
    '+968': [8, 8],    // Oman
    '+965': [8, 8],    // Kuwait
    '+973': [8, 8],    // Bahrain
    '+65': [8, 8],    // Singapore
    '+60': [9, 10],   // Malaysia
    '+66': [9, 9],    // Thailand
    '+62': [9, 12],   // Indonesia
    '+63': [10, 10],  // Philippines
    '+81': [10, 10],  // Japan
    '+86': [11, 11],  // China
    '+82': [9, 10],   // South Korea
    '+852': [8, 8],    // Hong Kong
    '+49': [10, 11],  // Germany
    '+33': [9, 9],    // France
    '+39': [9, 10],   // Italy
    '+34': [9, 9],    // Spain
    '+31': [9, 9],    // Netherlands
    '+41': [9, 9],    // Switzerland
    '+46': [9, 9],    // Sweden
    '+47': [8, 8],    // Norway
    '+353': [9, 9],    // Ireland
    '+92': [10, 10],  // Pakistan
    '+880': [10, 10],  // Bangladesh
    '+94': [9, 9],    // Sri Lanka
    '+977': [10, 10],  // Nepal
};
// Production guard: one stamp per card per Asia/Kolkata calendar day.
const ENABLE_DAILY_LIMIT_CHECK = false; // Set to false for testing as requested by the user.

// --- STATE ---
const urlParams = new URLSearchParams(window.location.search);
const cardId = urlParams.get('id');
const campaignParam = String(urlParams.get('campaign') || 'public').toLowerCase();
const activeCampaign = CAMPAIGNS[campaignParam] || CAMPAIGNS.public;
const API_URL = activeCampaign.apiUrl;
let currentUser = null;
let registering = false;
let _dialogOnCancel = null;

// --- VERIFICATION MODE CONFIGURATION ---
// Set to true to verify real phone numbers for free via a WhatsApp pre-filled message.
// When enabled, it bypasses the paid Firebase SMS OTP verification.
const ENABLE_WHATSAPP_VERIFICATION = true;

// --- FIREBASE CONFIGURATION (FOR PHONE NUMBER VERIFICATION) ---
// Set your Firebase Web App configuration credentials below to enable automated SMS OTP verification.
// Leave the fields empty to run without phone number verification.
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyAmsluv1zmLZLsZW-gkxBzomaNXnvufGiI",
    authDomain: "yolkshire-loyalty-program.firebaseapp.com",
    projectId: "yolkshire-loyalty-program",
    storageBucket: "yolkshire-loyalty-program.firebasestorage.app",
    messagingSenderId: "837492183538",
    appId: "1:837492183538:web:69f8044f4ebc1412439b6b"
};

const ENABLE_PHONE_VERIFICATION = ENABLE_WHATSAPP_VERIFICATION ? false : Boolean(FIREBASE_CONFIG.apiKey);
let confirmationResultObj = null;

if (ENABLE_PHONE_VERIFICATION) {
    try {
        firebase.initializeApp(FIREBASE_CONFIG);
    } catch (e) {
        console.error("Firebase initialization failed:", e);
    }
}

// --- SANITIZATION HELPERS ---
function escapeHTML(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function sanitizeName(raw) {
    const t = (raw || '').trim().replace(/\s+/g, ' ');
    return /^[A-Za-z. ]{2,50}$/.test(t) ? t : null;
}
function validatePhone(isd, raw) {
    const digits = (raw || '').replace(/\D/g, '');
    const [min, max] = PHONE_RULES[isd] || [7, 15];
    if (digits.length < min || digits.length > max) {
        const label = min === max ? `${min}` : `${min}–${max}`;
        return { ok: false, reason: `Phone must be ${label} digits for ${isd}.` };
    }
    return { ok: true, digits };
}

function findPhoneCodeFromDigits(digits) {
    return Object.keys(PHONE_RULES)
        .sort((a, b) => b.length - a.length)
        .find(code => digits.startsWith(code.replace(/\D/g, ''))) || '';
}

function canonicalPhoneFromParts(isd, digits) {
    const code = String(isd || '').trim();
    const cleanDigits = String(digits || '').replace(/\D/g, '');
    return code && cleanDigits ? code + cleanDigits : '';
}

function canonicalPhoneFromStored(stored) {
    const digits = String(stored || '').replace(/\D/g, '');
    if (!digits) return '';

    const code = findPhoneCodeFromDigits(digits);
    if (!code) return '';

    const codeDigits = code.replace(/\D/g, '');
    const nationalDigits = digits.slice(codeDigits.length);
    return canonicalPhoneFromParts(code, nationalDigits);
}

function hasRegisteredPhone(row) {
    return Boolean(
        row &&
        String(row.phone || '').trim() &&
        String(row.name || '').trim()
    );
}

function phoneAlreadyRegistered(rows, canonicalPhone, currentCardId) {
    return (Array.isArray(rows) ? rows : []).some(row =>
        hasRegisteredPhone(row) &&
        String(row.id || '').trim() !== String(currentCardId || '').trim() &&
        canonicalPhoneFromStored(row.phone) === canonicalPhone
    );
}

function normalizeMemberId(raw) {
    const value = String(raw || '').trim().toUpperCase();
    return /^[A-Z]-\d{4}$/.test(value) || /^DM\d{4}$/.test(value) ? value : null;
}

function memberIdAlreadyRegistered(rows, memberId, currentCardId) {
    return (Array.isArray(rows) ? rows : []).some(row =>
        String(row.member_id || '').trim().toUpperCase() === memberId &&
        String(row.id || '').trim() !== String(currentCardId || '').trim()
    );
}

function splitPhone(stored) {
    const s = String(stored || '').trim();
    // With a leading + — match longest known ISD prefix.
    if (s.startsWith('+')) {
        for (let len = 4; len >= 1; len--) {
            const tryCode = s.slice(0, len + 1);
            if (PHONE_RULES[tryCode]) return { code: tryCode, digits: s.slice(len + 1) };
        }
        return { code: s.slice(0, 3), digits: s.slice(3) };
    }
    // No leading + (Google Sheets can strip it when a column auto-formats as number).
    // Reconstruct by matching longest known ISD prefix without the +.
    for (let len = 4; len >= 1; len--) {
        const candidate = '+' + s.slice(0, len);
        if (PHONE_RULES[candidate]) return { code: candidate, digits: s.slice(len) };
    }
    return { code: '', digits: s };
}

function formatPhone(stored) {
    const { code, digits } = splitPhone(stored);
    if (!code) return stored;
    const grouped =
        digits.length === 10 ? `${digits.slice(0, 5)} ${digits.slice(5)}` :
            digits.length === 9 ? `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}` :
                digits.length === 8 ? `${digits.slice(0, 4)} ${digits.slice(4)}` :
                    digits.length === 11 ? `${digits.slice(0, 3)} ${digits.slice(3, 7)} ${digits.slice(7)}` :
                        digits;
    return `(${code}) ${grouped}`;
}

// --- DATE / GREETING HELPERS ---
function extractHistoryDate(entry) {
    return String(entry || '').split('@')[0];
}

function parseStoredDate(value) {
    const raw = extractHistoryDate(value).trim();
    if (!raw) return null;

    const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/i);
    if (!match) {
        const direct = new Date(raw);
        return isNaN(direct) ? null : direct;
    }

    const [, day, month, year, hour = '0', minute = '0', second = '0', meridiem] = match;
    let h = parseInt(hour, 10);
    if (meridiem) {
        const m = meridiem.toLowerCase();
        if (m === 'pm' && h < 12) h += 12;
        if (m === 'am' && h === 12) h = 0;
    }

    const parsed = new Date(
        parseInt(year, 10),
        parseInt(month, 10) - 1,
        parseInt(day, 10),
        h,
        parseInt(minute, 10),
        parseInt(second, 10)
    );
    return isNaN(parsed) ? null : parsed;
}

function formatDateTime(value) {
    const d = parseStoredDate(value);
    if (!d) return value || 'N/A';
    return d.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    }).replace(/\b(am|pm)\b/i, m => m.toLowerCase());
}

function getKolkataDateKey(value) {
    const d = value instanceof Date ? value : parseStoredDate(value);
    if (!d) return '';
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(d);
}

function getLatestStampDate(user) {
    const visits = parseInt(user?.visits) || 0;
    if (visits <= 0) return null;

    const logs = user?.history ? user.history.split('|').filter(Boolean) : [];
    for (let i = logs.length - 1; i >= 0; i--) {
        const d = parseStoredDate(logs[i]);
        if (d) return d;
    }

    return parseStoredDate(user?.last_visit);
}

function hasStampedToday(user) {
    const latestStampDate = getLatestStampDate(user);
    return Boolean(
        latestStampDate &&
        getKolkataDateKey(latestStampDate) === getKolkataDateKey(new Date())
    );
}

function getLastVisitLabel(user) {
    return getLatestStampDate(user) ? formatDateTime(getLatestStampDate(user)) : 'N/A';
}

function getGreeting(firstName) {
    const hr = parseInt(new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }).format(new Date()));
    if (hr >= 5 && hr < 11) return { headline: `Good morning, ${firstName}!`, tagline: 'Ready for your morning protein fix?' };
    if (hr >= 11 && hr < 16) return { headline: `Egg-cellent choice for lunch, ${firstName}!`, tagline: 'Your stamp awaits.' };
    if (hr >= 16 && hr < 21) return { headline: `Winding down, ${firstName}?`, tagline: 'Perfect time for a Golden Yolk visit.' };
    return { headline: `Late-night cravings, ${firstName}?`, tagline: "Yolkshire's got your back." };
}
function getJoinDate(user) {
    const visits = parseInt(user?.visits) || 0;
    if (visits === 0 && user?.last_visit) {
        try {
            const d = parseStoredDate(user.last_visit);
            if (d && !isNaN(d)) {
                return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
            }
        } catch {}
    }
    if (!user?.history) return '—';
    try {
        let first = user.history.split('|').filter(Boolean)[0];
        const d = parseStoredDate(first);
        if (isNaN(d)) return '—';
        return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch { return '—'; }
}
function getLastBranch(user) {
    if (activeCampaign.fixedBranch) return activeCampaign.fixedBranch;
    if (!user || !user.history) return '—';
    const logs = user.history.split('|').filter(Boolean);
    if (logs.length === 0) return '—';
    const latest = logs[logs.length - 1];
    if (latest.includes('@')) {
        return latest.split('@')[1];
    }
    return '—';
}
function groupLogsByMonth(logs) {
    const parsed = [];
    logs.forEach((entry, i) => {
        let iso = extractHistoryDate(entry);
        let branch = '';
        if (entry && entry.includes('@')) {
            branch = entry.split('@')[1];
        }
        try {
            const d = parseStoredDate(iso);
            if (isNaN(d)) return;
            parsed.push({ d, branch, visitIndex: i + 1 });
        } catch { }
    });
    parsed.reverse(); // newest first
    const groups = [];
    let current = null;
    for (const p of parsed) {
        const label = p.d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
        if (!current || current.label !== label) {
            current = { label, items: [] };
            groups.push(current);
        }
        current.items.push(p);
    }
    return groups;
}

// --- COMPONENT FACTORIES ---
function getRewardName(visits) {
    const reward = activeCampaign.rewards[visits];
    if (reward) return reward;
    return "Free Reward";
}

function getRewardMilestones() {
    return Object.keys(activeCampaign.rewards)
        .map(Number)
        .sort((a, b) => a - b);
}

function isRewardVisit(visits) {
    return Boolean(activeCampaign.rewards[visits]);
}

function getRewardIndex(visits) {
    const idx = getRewardMilestones().indexOf(visits);
    return idx >= 0 ? idx + 1 : null;
}

const PrimaryButton = (label, onClick) => `<button onclick="${onClick}" id="${onClick.split('(')[0]}Btn" class="btn-primary mb-3">${label}</button>`;

const SecondaryButton = (label, onClick) => `<button onclick="${onClick}" class="w-full bg-surfaceVariant text-onSurfaceVariant rounded-full py-4 md:py-3.5 font-bold text-sm md:text-xs uppercase tracking-wider active:scale-95 transition-transform">${label}</button>`;

const OutlinedTextField = (id, label, placeholder, type = 'text', additionalHTML = '') => `
    <div class="mb-4 text-left">
        <label for="${id}" class="block text-xs font-semibold text-onSurfaceVariant mb-2 ml-1">${label}</label>
        <div class="flex gap-2">
            ${additionalHTML}
            <input type="${type}" id="${id}" placeholder="${placeholder}" class="flex-1 w-full border border-outline rounded-xl px-4 py-3.5 font-bold text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all">
        </div>
    </div>`;

const ProfileStat = (label, value) => `
    <div class="flex flex-col text-left">
        <p class="text-[9px] font-bold text-onSurfaceVariant uppercase tracking-widest leading-snug">${label}</p>
        <p class="text-xs font-bold text-onSurface">${value}</p>
    </div>`;

const HistoryItem = (d, visitIndex, branch) => {
    const isMilestone = isRewardVisit(visitIndex);
    const isActivation = visitIndex === 1;
    const titleText = isActivation ? "Visit #1 (Card Collection)" : `Visit #${visitIndex}`;
    const baseClasses = (isMilestone || isActivation)
        ? 'bg-warning/15 border border-warning/40'
        : 'bg-surfaceVariant border border-gray-100';
    const icon = isMilestone ? `<i class="fa-solid fa-gift text-warning text-sm mr-1.5"></i>` : (isActivation ? `<i class="fa-solid fa-id-card text-warning text-sm mr-1.5"></i>` : '');
    const chip = isMilestone
        ? `<span class="ml-2 text-[9px] font-black text-warning uppercase tracking-widest bg-warning/10 px-1.5 py-0.5 rounded-md border border-warning/30">${getRewardName(visitIndex)}</span>`
        : '';
    const branchText = branch ? `<p class="text-[10px] font-semibold text-onSurfaceVariant mt-1"><i class="fa-solid fa-location-dot mr-1"></i>${escapeHTML(branch)}</p>` : '';
    return `
        <div class="${baseClasses} p-4 rounded-xl flex justify-between items-center text-left mb-2">
            <div class="flex-1 min-w-0">
                <p class="text-xs font-bold text-onSurfaceVariant uppercase flex items-center">${icon}${titleText}${chip}</p>
                <p class="font-bold text-onSurface">${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                ${branchText}
            </div>
            <div class="text-right">
                <p class="text-xs font-semibold text-onSurfaceVariant">${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</p>
            </div>
        </div>`;
};

const MonthHeader = (label) => `
    <div class="sticky top-0 bg-yolkBg/95 backdrop-blur-sm py-2 px-1 text-[10px] font-black uppercase tracking-[0.2em] text-primary z-10">${label}</div>`;

// --- DIALOG CONTROLLER ---
function showDialog(title, message, opts = {}) {
    const { confirmLabel = 'OK', cancelLabel = null, onConfirm = null, onCancel = null } = opts;
    const dialog = document.getElementById('dialog');
    const confirmBtn = document.getElementById('dialog-confirm-btn');
    const cancelBtn = document.getElementById('dialog-cancel-btn');

    document.getElementById('dialog-title').textContent = title;
    document.getElementById('dialog-message').textContent = message;

    if (cancelLabel) {
        cancelBtn.textContent = cancelLabel;
        cancelBtn.classList.remove('hidden');
        confirmBtn.className = 'flex-1 bg-primary text-onPrimary rounded-full py-3 font-semibold text-sm uppercase tracking-wider active:scale-95 transition-transform';
    } else {
        cancelBtn.classList.add('hidden');
        confirmBtn.className = 'flex-1 bg-surfaceVariant text-onSurfaceVariant rounded-full py-3 font-semibold text-sm uppercase tracking-wider active:scale-95 transition-transform';
    }
    confirmBtn.textContent = confirmLabel;

    _dialogOnCancel = onCancel; // backdrop-dismiss fires this
    confirmBtn.onclick = () => { _dialogOnCancel = null; closeDialog(); if (onConfirm) onConfirm(); };
    cancelBtn.onclick = () => { _dialogOnCancel = null; closeDialog(); if (onCancel) onCancel(); };

    dialog.classList.remove('hidden');
    void dialog.offsetWidth; // force reflow so transition runs from closed→open
    dialog.classList.add('dialog-open');
}

function closeDialog() {
    const dialog = document.getElementById('dialog');
    const pending = _dialogOnCancel;
    _dialogOnCancel = null;
    dialog.classList.remove('dialog-open');
    setTimeout(() => dialog.classList.add('hidden'), 300);
    if (pending) pending();
}

const ConfirmDialog = (title, msg, onYes, onNo) =>
    showDialog(title, msg, { confirmLabel: 'Yes, Redeemed', cancelLabel: 'No, Skip', onConfirm: onYes, onCancel: onNo });

// --- CELEBRATION ---
function fireConfetti() {
    if (typeof confetti !== 'function') return;
    const colors = ['#fcc314', '#0d6a37', '#ffffff'];
    confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 }, colors });
    setTimeout(() => confetti({ particleCount: 60, angle: 60, spread: 55, origin: { x: 0 }, colors }), 250);
    setTimeout(() => confetti({ particleCount: 60, angle: 120, spread: 55, origin: { x: 1 }, colors }), 400);
}
function celebrateMilestone(rewardIdx, rewardName) {
    return new Promise(resolve => {
        const el = document.getElementById('milestone');
        const label = el.querySelector('[data-reward-num]');
        const title = el.querySelector('h2');
        if (title) title.textContent = `${rewardName.toUpperCase()} UNLOCKED`;
        if (label) label.textContent = `Reward ${rewardIdx}/${getRewardMilestones().length} Redeemed`;
        el.classList.remove('hidden');
        void el.offsetWidth;
        el.classList.add('milestone-active');
        fireConfetti();
        setTimeout(fireConfetti, 900);

        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            el.classList.add('hidden');
            el.classList.remove('milestone-active');
            el.removeEventListener('click', finish);
            resolve();
        };
        el.addEventListener('click', finish);
        setTimeout(finish, 2600);
    });
}

// --- TOAST NOTIFICATIONS ---
function ensureToastElement() {
    if (!document.getElementById('toast')) {
        const div = document.createElement('div');
        div.id = 'toast';
        div.className = 'fixed top-6 left-1/2 transform -translate-x-1/2 z-[9999] flex items-center gap-2 bg-gray-900 text-white px-4 py-2.5 rounded-xl shadow-xl transition-all duration-300 opacity-0 pointer-events-none -translate-y-2';
        div.innerHTML = `
            <i class="fa-solid fa-circle-check text-green-400 text-sm"></i>
            <span id="toast-message" class="text-xs font-bold"></span>
        `;
        document.body.appendChild(div);
    }
}
function showToast(message) {
    ensureToastElement();
    const toast = document.getElementById('toast');
    const msgSpan = document.getElementById('toast-message');
    if (toast && msgSpan) {
        msgSpan.textContent = message;
        toast.classList.remove('opacity-0', 'pointer-events-none', '-translate-y-2');
        toast.classList.add('opacity-100', 'translate-y-0');
    }
}
function hideToast() {
    const toast = document.getElementById('toast');
    if (toast) {
        toast.classList.remove('opacity-100', 'translate-y-0');
        toast.classList.add('opacity-0', 'pointer-events-none', '-translate-y-2');
    }
}

// --- FEATURE HELPERS ---
function openWhatsAppFeedback(visits) {
    const suffix = ['st', 'nd', 'rd'][visits - 1] || 'th';
    const msg = encodeURIComponent(`Hi Yolkshire, I just finished my ${visits}${suffix} visit and wanted to say...`);
    window.open(`https://wa.me/${BUSINESS_WHATSAPP.replace(/\D/g, '')}?text=${msg}`, '_blank');
}
function updatePinDots(val) {
    const input = document.getElementById('staffPin');
    const digits = (val || '').replace(/\D/g, '').slice(0, 4);
    if (digits !== val && input) input.value = digits;
    const dots = document.querySelectorAll('.pin-dot');
    dots.forEach((d, i) => {
        const shouldFill = i < digits.length;
        const wasFilled = d.classList.contains('filled');
        if (shouldFill && !wasFilled) {
            d.classList.add('filled');
        } else if (!shouldFill && wasFilled) {
            d.classList.remove('filled');
        }
    });
}

// --- MAIN APP LOGIC ---
function handleManualId() {
    const input = document.getElementById('manualCardId');
    if (input) {
        const id = input.value.trim().toUpperCase();
        if (id) {
            const campaignPart = activeCampaign.key === 'public' ? '' : `campaign=${encodeURIComponent(activeCampaign.key)}&`;
            window.location.href = '?' + campaignPart + 'id=' + encodeURIComponent(id);
        }
    }
}

function normalizeUserRecord(user) {
    if (!user) return;
    let visits = parseInt(user.visits) || 0;
    const logs = user.history ? user.history.split('|').filter(Boolean) : [];
    if (logs.length > 0 && logs.length === visits + 1) {
        // Self-healing migration: remove old-schema activation log from history log
        user.history = logs.slice(1).join('|');
    }
}

function getVisitSuffix(n) {
    if (n === 11 || n === 12 || n === 13) return 'th';
    const last = n % 10;
    if (last === 1) return 'st';
    if (last === 2) return 'nd';
    if (last === 3) return 'rd';
    return 'th';
}

function getVisitSuccessMessage(visits) {
    const suffix = getVisitSuffix(visits);
    if (visits >= activeCampaign.totalVisits) {
        return `${visits}${suffix} Visit Completed. You have completed your card! See you soon.`;
    }
    const milestones = Object.keys(activeCampaign.rewards).map(Number).sort((a, b) => a - b);
    const nextMilestone = milestones.find(m => m > visits) || activeCampaign.totalVisits;
    const remaining = nextMilestone - visits;
    return `${visits}${suffix} Visit Completed. ${remaining} more visit${remaining > 1 ? 's' : ''} before your free reward. See you soon.`;
}

async function init() {
    if (!cardId) return render('home');
    if (!API_URL) return showError("PYC SheetDB API URL is not configured yet.");
    try {
        const res = await fetch(`${API_URL}/search?id=${encodeURIComponent(cardId)}`);
        const data = await res.json();
        if (data.length === 0) return showError("Card ID not found in database.");
        currentUser = data[0];

        // Self-healing: normalize old records in-memory
        normalizeUserRecord(currentUser);

        render();
    } catch (err) { showError("Database connection failed. Check your SheetDB setup."); }
}

function render(view = 'default') {
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    const container = document.getElementById('main-content');
    const adminHref = activeCampaign.key === 'public' ? 'admin.html' : `admin.html?campaign=${encodeURIComponent(activeCampaign.key)}`;

    // --- VIEW: HOME (Landing Page) ---
    if (view === 'home') {
        container.innerHTML = `
            <p class="text-sm font-semibold text-primary mb-8">${escapeHTML(activeCampaign.title)}</p>
            <h1 class="text-2xl font-bold text-gray-800 mb-8 tracking-tight">Who's checking in?</h1>
            
            <div class="space-y-4">
                <button onclick="render('customer_entry')" class="btn-choice">
                    <div class="flex items-center gap-4">
                        <div class="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 group-hover:bg-primary/10 group-hover:text-primary transition-all">
                            <i class="fa-solid fa-user text-xl"></i>
                        </div>
                        <div class="text-left">
                            <h2 class="text-lg font-bold">I am a Customer</h2>
                            <p class="text-xs text-gray-500 font-medium group-hover:text-primary/80 transition-colors">View your loyalty card</p>
                        </div>
                    </div>
                    <i class="fa-solid fa-chevron-right text-gray-300 group-hover:text-primary transition-colors"></i>
                </button>

                <button onclick="window.location.href='${adminHref}'" class="btn-choice">
                    <div class="flex items-center gap-4">
                        <div class="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 group-hover:bg-primary/10 group-hover:text-primary transition-all">
                            <i class="fa-solid fa-shield-halved text-xl"></i>
                        </div>
                        <div class="text-left">
                            <h2 class="text-lg font-bold">I am an Admin</h2>
                            <p class="text-xs text-gray-500 font-medium group-hover:text-primary/80 transition-colors">Manage customer records</p>
                        </div>
                    </div>
                    <i class="fa-solid fa-chevron-right text-gray-300 group-hover:text-primary transition-colors"></i>
                </button>
            </div>
        `;
    }
    // --- VIEW: CUSTOMER ENTRY ---
    else if (view === 'customer_entry') {
        container.innerHTML = `
            <div class="absolute top-6 left-6 text-gray-400 hover:text-gray-800 transition-colors cursor-pointer" onclick="render('home')">
                <i class="fa-solid fa-arrow-left text-xl"></i>
            </div>
            <p class="text-sm font-semibold text-primary mb-4">${escapeHTML(activeCampaign.title)}</p>
            <h2 class="text-xl font-bold text-gray-800 mb-2 tracking-tight">Find Your Card</h2>
            
            <!-- 3D flipping card animation -->
            <div class="card-scene">
                <div class="card-container">
                    <div class="card-face card-front">
                        <img src="assets/card-front.png" alt="Card Front" class="card-img" onerror="this.src='https://placehold.co/400x250/0d6a37/ffffff?text=Golden+Yolk+Card'">
                    </div>
                    <div class="card-face card-back">
                        <img src="assets/card-back.png" alt="Card Back" class="card-img" onerror="this.src='https://placehold.co/400x250/fcc314/0d6a37?text=Scan+QR+to+Earn'">
                    </div>
                </div>
            </div>

            <p class="text-sm text-gray-600 mb-6 font-medium leading-relaxed text-left">
                To view your loyalty card, simply scan the QR code on your physical card using your phone's camera.
                <br><br>
                Alternatively, enter the 7-character ID printed below your QR code here:
            </p>

            <div class="flex gap-2">
                <input type="text" id="manualCardId" placeholder="e.g., YSLC001" class="flex-1 border border-outline rounded-xl px-4 py-3.5 font-bold text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary uppercase transition-all">
                <button onclick="handleManualId()" class="bg-primary text-white rounded-xl px-6 font-bold uppercase tracking-wider active:scale-95 transition-transform"><i class="fa-solid fa-arrow-right"></i></button>
            </div>
        `;
    }
    // --- VIEW: SCAN (Initial) ---
    else if (!currentUser?.name && view === 'default') {
        container.innerHTML = `
            <div class="p-6">
                <p class="text-sm font-semibold text-primary mb-6">${escapeHTML(activeCampaign.title)}</p>
                <p class="text-xs uppercase tracking-[0.2em] text-onSurfaceVariant font-semibold mb-3">Scan Detected</p>
                <h1 class="text-2xl font-bold text-primary mb-12">#${escapeHTML(cardId)}</h1>
                ${PrimaryButton("Activate Card", "render('register')")}
            </div>`;
    }
    // --- VIEW: REGISTER ---
    else if (view === 'register') {
        const isdHTML = `
            <select id="isd" class="border border-outline rounded-xl px-2.5 font-bold text-sm outline-none bg-white max-w-[140px]">
                <optgroup label="India & Subcontinent">
                    <option value="+91" selected>🇮🇳 +91 India</option>
                    <option value="+92">🇵🇰 +92 Pakistan</option>
                    <option value="+880">🇧🇩 +880 Bangladesh</option>
                    <option value="+94">🇱🇰 +94 Sri Lanka</option>
                    <option value="+977">🇳🇵 +977 Nepal</option>
                </optgroup>
                <optgroup label="Middle East">
                    <option value="+971">🇦🇪 +971 UAE</option>
                    <option value="+966">🇸🇦 +966 Saudi Arabia</option>
                    <option value="+974">🇶🇦 +974 Qatar</option>
                    <option value="+968">🇴🇲 +968 Oman</option>
                    <option value="+965">🇰🇼 +965 Kuwait</option>
                    <option value="+973">🇧🇭 +973 Bahrain</option>
                </optgroup>
                <optgroup label="North America">
                    <option value="+1">🇺🇸 +1 USA / Canada</option>
                </optgroup>
                <optgroup label="Europe">
                    <option value="+44">🇬🇧 +44 United Kingdom</option>
                    <option value="+353">🇮🇪 +353 Ireland</option>
                    <option value="+49">🇩🇪 +49 Germany</option>
                    <option value="+33">🇫🇷 +33 France</option>
                    <option value="+39">🇮🇹 +39 Italy</option>
                    <option value="+34">🇪🇸 +34 Spain</option>
                    <option value="+31">🇳🇱 +31 Netherlands</option>
                    <option value="+41">🇨🇭 +41 Switzerland</option>
                    <option value="+46">🇸🇪 +46 Sweden</option>
                    <option value="+47">🇳🇴 +47 Norway</option>
                </optgroup>
                <optgroup label="Asia Pacific">
                    <option value="+65">🇸🇬 +65 Singapore</option>
                    <option value="+61">🇦🇺 +61 Australia</option>
                    <option value="+64">🇳🇿 +64 New Zealand</option>
                    <option value="+60">🇲🇾 +60 Malaysia</option>
                    <option value="+66">🇹🇭 +66 Thailand</option>
                    <option value="+62">🇮🇩 +62 Indonesia</option>
                    <option value="+63">🇵🇭 +63 Philippines</option>
                    <option value="+852">🇭🇰 +852 Hong Kong</option>
                    <option value="+86">🇨🇳 +86 China</option>
                    <option value="+82">🇰🇷 +82 South Korea</option>
                    <option value="+81">🇯🇵 +81 Japan</option>
                </optgroup>
            </select>`;
        const memberIdHTML = activeCampaign.requiresMemberId
            ? `${OutlinedTextField("regMemberId", "PYC Member ID", "B-0251 or DM1234")}`
            : '';
        const branchHTML = activeCampaign.fixedBranch
            ? `
            <div class="mt-4 text-left">
                <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 ml-1">Collection Branch</label>
                <div class="w-full border-2 border-gray-100 rounded-xl px-4 py-3.5 font-bold text-sm text-gray-800 bg-gray-50">
                    ${escapeHTML(activeCampaign.fixedBranch)}
                </div>
            </div>`
            : `
            <div class="mt-4 text-left">
                <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 ml-1">Collection Branch</label>
                <div class="relative">
                    <select id="regBranch" class="w-full border-2 border-gray-200 rounded-xl px-4 py-3.5 font-bold text-sm text-gray-800 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 appearance-none bg-white transition-all">
                        <option value="" disabled selected>Select Branch...</option>
                        <option value="Kothrud">Kothrud</option>
                        <option value="Aundh">Aundh</option>
                        <option value="Salunkhe Vihar">Salunkhe Vihar</option>
                        <option value="Pimple Saudagar">Pimple Saudagar</option>
                        <option value="Wadgaon Sheri">Wadgaon Sheri</option>
                        <option value="Wakad">Wakad</option>
                        <option value="Bavdhan">Bavdhan</option>
                    </select>
                    <i class="fa-solid fa-chevron-down absolute right-4 top-4 text-gray-400 pointer-events-none"></i>
                </div>
            </div>`;
        const buttonLabel = ENABLE_WHATSAPP_VERIFICATION 
            ? "Verify via WhatsApp" 
            : (ENABLE_PHONE_VERIFICATION ? "Verify Phone & Activate" : "Complete Activation");
            
        const helperText = ENABLE_WHATSAPP_VERIFICATION 
            ? `<p class="text-xs text-gray-500 mt-4 font-semibold text-center leading-relaxed"><i class="fa-brands fa-whatsapp text-green-600 mr-1 text-sm"></i> We will verify your phone number via a free WhatsApp message.</p>` 
            : '';

        container.innerHTML = `
            <h2 class="text-xl font-semibold text-primary mb-2">Join Yolkshire's</h2>
            <p class="text-primary font-semibold mb-6">${escapeHTML(activeCampaign.title.replace("Yolkshire's ", ""))}</p>
            ${OutlinedTextField("regName", "Full Name", "John Doe")}
            ${OutlinedTextField("regPhone", "Phone Number", "9876543210", "tel", isdHTML)}
            ${memberIdHTML}
            ${branchHTML}
            <div id="otp-area" class="hidden mt-4 text-left">
                <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 ml-1">SMS OTP Verification Code</label>
                <input type="tel" id="otpCode" placeholder="Enter 6-digit OTP" class="w-full border border-outline rounded-xl px-4 py-3.5 font-bold text-sm text-gray-800 outline-none focus:border-primary focus:ring-1 focus:ring-primary appearance-none bg-white transition-all">
                <div class="mt-2 text-right">
                    <button type="button" onclick="cancelOTP()" class="text-xs text-primary font-bold hover:underline">Change Number / Resend</button>
                </div>
            </div>
            <div id="recaptcha-container" class="mt-4 flex justify-center"></div>
            ${helperText}
            <div class="mt-8">${PrimaryButton(buttonLabel, "handleRegistration()")}</div>
        `;
    }
    // --- VIEW: SUCCESS ---
    else if (view === 'success') {
        container.innerHTML = `
            <div class="py-10">
                <div class="w-16 h-16 bg-green-100 text-primary rounded-full flex items-center justify-center mx-auto mb-6 text-2xl">✓</div>
                <h2 class="text-2xl font-bold text-gray-800 mb-2 tracking-tight">Welcome aboard!</h2>
                <p class="text-sm text-gray-500 mb-3 font-medium">Your loyalty card #${escapeHTML(currentUser.id)} is now active.</p>
                <p class="text-sm font-semibold text-primary mb-10">${escapeHTML(activeCampaign.title)}</p>
                ${PrimaryButton("Go to Profile", "location.reload()")}
            </div>
        `;
    }
    // --- VIEW: WHATSAPP VERIFY ---
    else if (view === 'whatsapp_verify') {
        const name = currentUser ? currentUser.name : '';
        const waMessage = `Hello Yolkshire, please verify my loyalty card #${cardId}. My registered name is ${name}.`;
        const waUrl = `https://wa.me/${BUSINESS_WHATSAPP.replace(/\D/g, '')}?text=${encodeURIComponent(waMessage)}`;
        
        container.innerHTML = `
            <div class="py-6">
                <div class="w-16 h-16 bg-[#25D366]/10 text-[#25D366] rounded-full flex items-center justify-center mx-auto mb-6 text-3xl">
                    <i class="fa-brands fa-whatsapp"></i>
                </div>
                <h2 class="text-2xl font-bold text-gray-800 mb-3 tracking-tight">Verify via WhatsApp</h2>
                <p class="text-sm text-gray-600 mb-8 font-medium leading-relaxed px-2 text-left">
                    To complete activation, click the button below to send a pre-filled verification message to our business WhatsApp.
                    <br><br>
                    <strong>Your card will be active instantly after you open WhatsApp.</strong>
                </p>
                <a href="${waUrl}" target="_blank" rel="noopener" onclick="render('success')" class="w-full bg-[#25D366] hover:bg-[#20ba5a] text-white rounded-full py-4 px-6 font-bold text-sm uppercase tracking-wider block text-center active:scale-95 transition-transform animate-bounce">
                    <i class="fa-brands fa-whatsapp text-lg mr-2"></i> Open WhatsApp & Activate
                </a>
            </div>
        `;
    }
    // --- VIEW: PROFILE ---
    else if (view === 'default' || view === 'profile') {
        const visits = parseInt(currentUser.visits) || 0;
        const firstName = escapeHTML((currentUser.name || '').split(' ')[0]);
        const g = getGreeting(firstName);
        const isCardComplete = visits >= activeCampaign.totalVisits;
        
        const nextVisitNumber = visits + 1;
        const isRewardEarned = !isCardComplete && isRewardVisit(nextVisitNumber);
        const isNextReward = !isRewardEarned && !isCardComplete && isRewardVisit(nextVisitNumber + 1);

        const memberStat = activeCampaign.requiresMemberId
            ? ProfileStat("Member ID", escapeHTML(currentUser.member_id || '—'))
            : ProfileStat("", "");
        const finalRewardName = getRewardName(activeCampaign.totalVisits);

        // Generate dynamic capsule progress steps
        let capsulesHTML = '<div class="flex justify-between items-center gap-1.5 mb-8 w-full">';
        const total = activeCampaign.totalVisits;
        for (let i = 1; i <= total; i++) {
            const isFilled = i <= visits;
            const isReward = isRewardVisit(i);
            
            let bgClass = '';
            let content = '';
            
            if (isReward) {
                if (isFilled) {
                    bgClass = 'bg-warning text-primary flex items-center justify-center shadow-inner';
                    content = '<i class="fa-solid fa-check text-[10px]"></i>';
                } else {
                    bgClass = 'bg-warning/5 border border-warning/35 flex items-center justify-center text-warning/70';
                    content = `<span class="text-[10px] font-black">${i}</span>`;
                }
            } else {
                if (isFilled) {
                    bgClass = 'bg-primary text-white flex items-center justify-center shadow-inner';
                    content = '<i class="fa-solid fa-check text-[10px]"></i>';
                } else {
                    bgClass = 'bg-surfaceVariant bg-opacity-65 border border-outline/20 flex items-center justify-center text-onSurfaceVariant/45';
                    content = `<span class="text-[10px] font-black">${i}</span>`;
                }
            }
            
            capsulesHTML += `<div class="flex-1 h-5 rounded-full transition-all duration-300 ${bgClass}">${content}</div>`;
        }
        capsulesHTML += '</div>';

        const profileHeader = `
            <p class="text-sm font-semibold text-primary mb-4 md:mb-3 md:text-xs">${escapeHTML(activeCampaign.title)}</p>
            <h2 class="text-xl font-bold text-gray-800 mb-1 tracking-tight leading-tight md:text-lg">${escapeHTML(g.headline)}</h2>
            <p class="text-sm text-onSurfaceVariant font-medium mb-6 md:mb-5 md:text-xs">${escapeHTML(g.tagline)}</p>

            ${capsulesHTML}

            <div class="w-full mb-8 px-2 border-b border-gray-100 pb-8">
                ${activeCampaign.requiresMemberId ? `
                <div class="grid grid-cols-2 gap-x-5 gap-y-2.5 text-left w-full">
                    ${ProfileStat("Card ID", escapeHTML(currentUser.id))}
                    ${memberStat}
                    ${ProfileStat("Branch", getLastBranch(currentUser))}
                    ${ProfileStat("Phone", escapeHTML(formatPhone(currentUser.phone)))}
                    ${ProfileStat("Join Date", getJoinDate(currentUser))}
                    ${ProfileStat(isCardComplete ? "Completed Date" : "Last Visit", escapeHTML(getLastVisitLabel(currentUser)))}
                </div>
                ` : `
                <div class="grid grid-cols-2 gap-x-5 gap-y-2.5 text-left w-full">
                    ${ProfileStat("Card ID", escapeHTML(currentUser.id))}
                    ${ProfileStat("Phone", escapeHTML(formatPhone(currentUser.phone)))}
                    ${ProfileStat("Join Date", getJoinDate(currentUser))}
                    ${ProfileStat(isCardComplete ? "Completed Date" : "Last Visit", escapeHTML(getLastVisitLabel(currentUser)))}
                </div>
                `}
            </div>
        `;

        if (isCardComplete) {
            container.innerHTML = `
                ${profileHeader}
                <div class="bg-gradient-to-br from-warning/25 to-warning/5 border-2 border-warning reward-glow rounded-3xl p-6 mb-6 text-center">
                    <i class="fa-solid fa-trophy text-warning text-5xl mb-3 gift-wiggle"></i>
                    <p class="text-sm text-onSurface font-bold mb-2">Yayy, you're a certified Eggomaniac now</p>
                    <p class="text-sm text-onSurface font-medium mb-4">
                        You've collected all ${activeCampaign.totalVisits} stamps and earned a ${finalRewardName}. Thank you for being part of ${escapeHTML(activeCampaign.title)}!
                    </p>
                    <p class="text-sm text-onSurfaceVariant font-medium">
                        Follow us on Instagram
                        <a href="https://instagram.com/${INSTAGRAM_HANDLE}" target="_blank" rel="noopener" class="text-primary font-bold"><i class="fa-brands fa-instagram"></i> @${INSTAGRAM_HANDLE}</a>
                        for new offers like this.
                    </p>
                </div>

                <button onclick="openWhatsAppFeedback(${visits})" class="w-full bg-[#25D366] text-white rounded-full py-3 font-bold text-sm uppercase tracking-wider mb-3 flex items-center justify-center gap-2 active:scale-95 transition-transform">
                    <i class="fa-brands fa-whatsapp text-lg"></i> Share Feedback
                </button>

                <button onclick="render('history')" class="text-primary font-bold text-xs uppercase tracking-[0.2em] border-b-2 border-primary border-opacity-20 pb-1 mx-auto block">Visit History</button>
            `;
        } else {
            const rewardCardClasses = isRewardEarned
                ? 'bg-gradient-to-br from-warning/25 to-warning/5 border-2 border-warning reward-glow'
                : 'bg-surfaceVariant bg-opacity-30 border border-gray-100';

            const rewardName = getRewardName(nextVisitNumber);
            const heroBanner = isRewardEarned ? `
                <div class="mb-5 text-center">
                    <i class="fa-solid fa-gift gift-wiggle text-warning text-5xl mb-3"></i>
                    <h3 class="text-lg font-black text-primary tracking-tight leading-tight uppercase">YOU'VE EARNED<br>A ${rewardName}</h3>
                    <p class="text-xs text-onSurfaceVariant font-semibold mt-2">Show this screen to your server</p>
                </div>
            ` : '';

            const nextRewardName = getRewardName(nextVisitNumber + 1);
            const nextRewardPill = isNextReward ? `
                <div class="mb-4 py-1.5 px-3 bg-warning bg-opacity-10 text-primary text-[10px] font-black uppercase tracking-widest border border-warning border-opacity-20 rounded-lg text-center">${nextRewardName} on next visit</div>
            ` : '';
            const branchControl = activeCampaign.fixedBranch
                ? ''
                : `
                    <div class="mb-4 text-left">
                        <select id="branchSelect" class="w-full border border-outline rounded-xl px-4 py-3 font-bold text-sm outline-none bg-surface focus:border-primary focus:ring-1 focus:ring-primary transition-all">
                            <option value="" disabled selected>Select Branch...</option>
                            <option value="Kothrud">Kothrud</option>
                            <option value="Aundh">Aundh</option>
                            <option value="Salunkhe Vihar">Salunkhe Vihar</option>
                            <option value="Pimple Saudagar">Pimple Saudagar</option>
                            <option value="Wadgaon Sheri">Wadgaon Sheri</option>
                            <option value="Wakad">Wakad</option>
                            <option value="Bavdhan">Bavdhan</option>
                        </select>
                    </div>`;

            container.innerHTML = `
                ${profileHeader}
                <div class="${rewardCardClasses} rounded-3xl p-6 mb-6">
                    ${heroBanner}
                    ${branchControl}
                    <div class="flex items-center gap-2 mb-4 justify-center">
                        <label class="block text-xs font-bold text-onSurfaceVariant uppercase tracking-widest">Staff PIN</label>
                        <button onclick="showDialog('Staff Area', 'Ask your server to enter their pin to collect stamp.')" class="text-onSurfaceVariant text-xs hover:text-primary transition-colors"><i class="fa-solid fa-circle-info"></i></button>
                    </div>
                    <div class="relative h-14 mb-5">
                        <div class="absolute inset-0 flex justify-center items-center gap-4 pointer-events-none bg-surface border border-outline rounded-xl">
                            <span class="pin-dot w-4 h-4 rounded-full bg-surfaceVariant"></span>
                            <span class="pin-dot w-4 h-4 rounded-full bg-surfaceVariant"></span>
                            <span class="pin-dot w-4 h-4 rounded-full bg-surfaceVariant"></span>
                            <span class="pin-dot w-4 h-4 rounded-full bg-surfaceVariant"></span>
                        </div>
                        <input type="tel" inputmode="numeric" pattern="[0-9]*" maxlength="4" id="staffPin" oninput="updatePinDots(this.value)" autocomplete="off" class="absolute inset-0 w-full h-full opacity-0">
                    </div>
                    ${nextRewardPill}
                    ${PrimaryButton(`Collect Stamp for Visit #${visits + 1}`, "handleVisit(" + visits + ")")}
                </div>

                <button onclick="render('history')" class="text-primary font-bold text-xs uppercase tracking-[0.2em] border-b-2 border-primary border-opacity-20 pb-1 mx-auto block">Visit History</button>
            `;
        }
    }
    // --- VIEW: HISTORY ---
    else if (view === 'history') {
        const logs = currentUser.history ? currentUser.history.split('|').filter(x => x) : [];
        const groups = groupLogsByMonth(logs);
        const groupsHTML = groups.length > 0
            ? groups.map(g => `
                ${MonthHeader(g.label)}
                <div class="space-y-2 mb-4">
                    ${g.items.map(item => HistoryItem(item.d, item.visitIndex, item.branch)).join('')}
                </div>
            `).join('')
            : '<p class="text-onSurfaceVariant py-10 font-bold italic">No visits recorded yet.</p>';

        const whatsAppBtn = logs.length > 0 ? `
            <button onclick="openWhatsAppFeedback(${logs.length})" class="w-full bg-[#25D366] text-white rounded-full py-3 font-bold text-sm uppercase tracking-wider mb-3 flex items-center justify-center gap-2 active:scale-95 transition-transform">
                <i class="fa-brands fa-whatsapp text-lg"></i> Share Feedback
            </button>
        ` : '';

        container.innerHTML = `
            <h2 class="text-xl font-semibold text-primary mb-6 text-left">Visit History</h2>
            <div class="history-scroll max-h-96 overflow-y-auto pr-1 mb-6">
                ${groupsHTML}
            </div>
            ${whatsAppBtn}
            ${SecondaryButton("Back to Profile", "render('profile')")}
        `;
    }
function cancelOTP() {
    confirmationResultObj = null;
    
    // Hide OTP area and clear input
    const otpArea = document.getElementById('otp-area');
    if (otpArea) otpArea.classList.add('hidden');
    const otpInput = document.getElementById('otpCode');
    if (otpInput) otpInput.value = '';
    
    // Re-enable registration fields
    const nameInput = document.getElementById('regName');
    if (nameInput) nameInput.disabled = false;
    const isdSelect = document.getElementById('isd');
    if (isdSelect) isdSelect.disabled = false;
    const phoneInput = document.getElementById('regPhone');
    if (phoneInput) phoneInput.disabled = false;
    const memberIdInput = document.getElementById('regMemberId');
    if (memberIdInput) memberIdInput.disabled = false;
    const branchSelect = document.getElementById('regBranch');
    if (branchSelect) branchSelect.disabled = false;
    
    // Reset button
    const btn = document.getElementById('handleRegistrationBtn');
    if (btn) {
        btn.disabled = false;
        btn.innerHTML = ENABLE_PHONE_VERIFICATION ? "Verify Phone & Activate" : (ENABLE_WHATSAPP_VERIFICATION ? "Verify via WhatsApp" : "Complete Activation");
    }
}

async function handleRegistration() {
    if (registering) return;
    const btn = document.getElementById('handleRegistrationBtn');
    const rawName = document.getElementById('regName').value;
    const isd = document.getElementById('isd').value;
    const rawPhone = document.getElementById('regPhone').value;
    const branchSelect = document.getElementById('regBranch');
    const branchName = activeCampaign.fixedBranch || (branchSelect ? branchSelect.value : '');
    const memberId = activeCampaign.requiresMemberId
        ? normalizeMemberId(document.getElementById('regMemberId')?.value)
        : '';
    const resetButton = () => {
        registering = false;
        if (btn) { 
            btn.disabled = false; 
            btn.innerHTML = ENABLE_PHONE_VERIFICATION 
                ? "Verify Phone & Activate" 
                : (ENABLE_WHATSAPP_VERIFICATION ? "Verify via WhatsApp" : "Complete Activation"); 
        }
    };

    if (!branchName) return showDialog("Select Branch", "Please select the collection branch.");

    if (activeCampaign.requiresMemberId && !memberId) {
        return showDialog("Invalid Member ID", "Enter a valid PYC member ID, such as B-0251, S-0072, DM1234, or DM0067.");
    }

    const name = sanitizeName(rawName);
    if (!name) return showDialog("Invalid Name", "Please enter a valid name (2-50 letters, spaces or dots).");

    const phoneCheck = validatePhone(isd, rawPhone);
    if (!phoneCheck.ok) return showDialog("Invalid Phone", phoneCheck.reason);

    const fullPhone = canonicalPhoneFromParts(isd, phoneCheck.digits);

    // If Firebase verification is enabled and OTP hasn't been sent yet:
    if (ENABLE_PHONE_VERIFICATION && !confirmationResultObj) {
        registering = true;
        if (btn) { btn.disabled = true; btn.innerHTML = "Sending OTP..."; }
        try {
            // First check if phone number already exists to avoid sending unnecessary SMS
            const res = await fetch(API_URL);
            const globalUsers = await res.json();

            if (phoneAlreadyRegistered(globalUsers, fullPhone, cardId)) {
                resetButton();
                return showDialog("Phone Exists", "Phone number already registered. Please try a different number.");
            }

            if (activeCampaign.requiresMemberId && memberIdAlreadyRegistered(globalUsers, memberId, cardId)) {
                resetButton();
                return showDialog("Member ID Exists", "This PYC member ID is already registered. Please check the ID and try again.");
            }

            // Setup invisible recaptcha
            if (!window.recaptchaVerifier) {
                window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
                    'size': 'invisible'
                });
            }
            if (window.recaptchaWidgetId === undefined) {
                window.recaptchaWidgetId = await window.recaptchaVerifier.render();
            }

            const confirmationResult = await firebase.auth().signInWithPhoneNumber(fullPhone, window.recaptchaVerifier);
            confirmationResultObj = confirmationResult;

            // Show OTP input and change button
            document.getElementById('otp-area').classList.remove('hidden');
            // Disable other fields to prevent modification after OTP is sent
            document.getElementById('regName').disabled = true;
            document.getElementById('isd').disabled = true;
            document.getElementById('regPhone').disabled = true;
            if (document.getElementById('regMemberId')) document.getElementById('regMemberId').disabled = true;
            if (document.getElementById('regBranch')) document.getElementById('regBranch').disabled = true;

            registering = false;
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = "Verify OTP & Complete";
            }
            showDialog("OTP Sent", "A 6-digit verification code has been sent to " + formatPhone(fullPhone));
        } catch (err) {
            resetButton();
            console.error("SMS OTP Send Failed:", err);
            
            // Reset reCAPTCHA so they can retry
            if (typeof grecaptcha !== 'undefined' && window.recaptchaWidgetId !== undefined) {
                try {
                    grecaptcha.reset(window.recaptchaWidgetId);
                } catch (recaptchaErr) {
                    console.error("Failed to reset reCAPTCHA:", recaptchaErr);
                }
            }

            let errorMessage = "Failed to send verification SMS. Please check the number and try again.";
            if (err.code) {
                if (err.code === 'auth/unauthorized-domain') {
                    errorMessage = "This domain is not authorized in your Firebase Console. Please add this domain under Firebase Authentication -> Settings -> Authorized Domains.";
                } else if (err.code === 'auth/invalid-phone-number') {
                    errorMessage = "The phone number format is invalid. Please make sure the number is correct.";
                } else if (err.code === 'auth/quota-exceeded') {
                    errorMessage = "SMS quota exceeded for this project. Please upgrade to the Blaze plan or try again later.";
                } else if (err.code === 'auth/invalid-app-credential') {
                    errorMessage = "Invalid app credential. This might be due to an incorrect API key, or missing SHA certificates (if on mobile).";
                } else {
                    errorMessage = `Failed to send verification SMS: ${err.message} (${err.code})`;
                }
            } else if (err.message) {
                errorMessage = `Failed to send verification SMS: ${err.message}`;
            }
            showDialog("OTP Failed", errorMessage);
        }
        return;
    }

    // If OTP was sent and needs verification:
    if (ENABLE_PHONE_VERIFICATION && confirmationResultObj) {
        const otpCode = document.getElementById('otpCode').value.trim();
        if (!otpCode || otpCode.length !== 6) {
            return showDialog("Invalid OTP", "Please enter the 6-digit verification code sent to your phone.");
        }
        registering = true;
        if (btn) { btn.disabled = true; btn.innerHTML = "Verifying OTP..."; }
        try {
            await confirmationResultObj.confirm(otpCode);
        } catch (err) {
            registering = false;
            if (btn) { btn.disabled = false; btn.innerHTML = "Verify OTP & Complete"; }
            console.error("OTP Verification Failed:", err);
            let errorMessage = "The verification code entered is incorrect or expired.";
            if (err.code) {
                if (err.code === 'auth/invalid-verification-code') {
                    errorMessage = "The verification code entered is incorrect. Please try again.";
                } else if (err.code === 'auth/session-expired') {
                    errorMessage = "The verification code has expired. Please request a new OTP.";
                } else {
                    errorMessage = `Verification failed: ${err.message} (${err.code})`;
                }
            }
            return showDialog("Verification Failed", errorMessage);
        }
    }

    // Direct registration (either phone verification is disabled, or OTP was verified successfully):
    registering = true;
    if (btn) { btn.disabled = true; btn.innerHTML = "Activating..."; }

    try {
        const res = await fetch(API_URL);
        const globalUsers = await res.json();

        if (phoneAlreadyRegistered(globalUsers, fullPhone, cardId)) {
            resetButton();
            return showDialog("Phone Exists", "Phone number already registered. Please try a different number.");
        }

        if (activeCampaign.requiresMemberId && memberIdAlreadyRegistered(globalUsers, memberId, cardId)) {
            resetButton();
            return showDialog("Member ID Exists", "This PYC member ID is already registered. Please check the ID and try again.");
        }

        const todayStr = new Date().toISOString();
        const payload = { name, phone: fullPhone, visits: 0, last_visit: todayStr, history: "" };
        if (activeCampaign.requiresMemberId) payload.member_id = memberId;

        await fetch(`${API_URL}/id/${encodeURIComponent(cardId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        currentUser = { id: cardId, ...payload };

        if (ENABLE_WHATSAPP_VERIFICATION) {
            render('whatsapp_verify');
        } else {
            render('success');
        }
    } catch (err) {
        resetButton();
        showError("Database connection failed. Refresh and try again.");
    }
}

async function handleVisit(currentVisits) {
    const btn = document.getElementById('handleVisitBtn');
    if (btn && btn.disabled) return;
    if (btn) btn.disabled = true;
    const reenable = () => { if (btn) btn.disabled = false; };

    const newVisitCount = currentVisits + 1;
    const pin = document.getElementById('staffPin').value;
    const branchSelect = document.getElementById('branchSelect');
    const branchName = activeCampaign.fixedBranch || (branchSelect ? branchSelect.value : '');

    if (!branchName) {
        reenable();
        return showDialog("Select Branch", "Please select a branch before entering the PIN.");
    }

    if (pin !== "2010") {
        reenable();
        return showDialog("Invalid PIN", "You entered an incorrect Staff authorization PIN.");
    }

    if (ENABLE_DAILY_LIMIT_CHECK) {
        if (hasStampedToday(currentUser)) {
            reenable();
            return showDialog("Daily Limit", "Oops! Guest is allowed only one visit per day to collect a stamp.");
        }
    }

    if (currentVisits >= activeCampaign.totalVisits) {
        reenable();
        return showDialog("Card Complete", "Guest has already completed this card.");
    }

    // Clear PIN input immediately so it doesn't linger
    const pinInput = document.getElementById('staffPin');
    if (pinInput) {
        pinInput.value = '';
        updatePinDots('');
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const logEntry = branchName ? nowIso + "@" + branchName : nowIso;
    const updatedHistory = currentUser.history ? currentUser.history + "|" + logEntry : logEntry;

    // Trigger API call in the background
    fetch(`${API_URL}/id/${encodeURIComponent(currentUser.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            visits: newVisitCount,
            last_visit: nowIso,
            history: updatedHistory
        })
    }).catch(err => {
        console.error("Background sync failed:", err);
    });

    const isReward = isRewardVisit(newVisitCount);

    if (isReward) {
        // Reward visit: show confetti immediately, update UI in-place immediately
        fireConfetti();
        currentUser.visits = newVisitCount;
        currentUser.last_visit = nowIso;
        currentUser.history = updatedHistory;
        render();
    } else {
        // Normal visit: show clean toast, wait 1.5s, then update UI
        ensureToastElement();
        showToast(`Stamp collected for Visit ${newVisitCount}!`);
        
        setTimeout(() => {
            hideToast();
            currentUser.visits = newVisitCount;
            currentUser.last_visit = nowIso;
            currentUser.history = updatedHistory;
            render();
        }, 1500);
    }
}

function showError(msg) {
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('main-content').innerHTML = `
        <div class="py-10">
            <div class="text-5xl mb-6 flex justify-center">⚠️</div>
            <h2 class="text-2xl font-semibold text-gray-800 mb-2 tracking-tight">System Error</h2>
            <p class="text-sm text-gray-500 mb-10 font-medium">${escapeHTML(msg)}</p>
            ${SecondaryButton("Try Again", "location.reload()")}
        </div>
    `;
}

init();

window.render = render;
window.handleManualId = handleManualId;
window.handleRegistration = handleRegistration;
window.handleVisit = handleVisit;
