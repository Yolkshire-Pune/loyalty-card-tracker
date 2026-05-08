// --- CONSTANTS ---
const API_URL = "https://sheetdb.io/api/v1/im2qg2cit3cco";
const BUSINESS_WHATSAPP = '+918446536065';
const INSTAGRAM_HANDLE = 'yolkshire';
const BRAND_NAME = "Yolkshire's Golden Yolk Loyalty Program";
// [min, max] digit length (mobile) per ISD code
const PHONE_RULES = {
    '+91':  [10, 10],  // India
    '+1':   [10, 10],  // USA / Canada
    '+44':  [10, 10],  // UK
    '+61':  [9, 9],    // Australia
    '+64':  [8, 10],   // New Zealand
    '+971': [9, 9],    // UAE
    '+966': [9, 9],    // Saudi Arabia
    '+974': [8, 8],    // Qatar
    '+968': [8, 8],    // Oman
    '+965': [8, 8],    // Kuwait
    '+973': [8, 8],    // Bahrain
    '+65':  [8, 8],    // Singapore
    '+60':  [9, 10],   // Malaysia
    '+66':  [9, 9],    // Thailand
    '+62':  [9, 12],   // Indonesia
    '+63':  [10, 10],  // Philippines
    '+81':  [10, 10],  // Japan
    '+86':  [11, 11],  // China
    '+82':  [9, 10],   // South Korea
    '+852': [8, 8],    // Hong Kong
    '+49':  [10, 11],  // Germany
    '+33':  [9, 9],    // France
    '+39':  [9, 10],   // Italy
    '+34':  [9, 9],    // Spain
    '+31':  [9, 9],    // Netherlands
    '+41':  [9, 9],    // Switzerland
    '+46':  [9, 9],    // Sweden
    '+47':  [8, 8],    // Norway
    '+353': [9, 9],    // Ireland
    '+92':  [10, 10],  // Pakistan
    '+880': [10, 10],  // Bangladesh
    '+94':  [9, 9],    // Sri Lanka
    '+977': [10, 10],  // Nepal
};
// Production guard: one stamp per card per Asia/Kolkata calendar day.
const ENABLE_DAILY_LIMIT_CHECK = true;

// --- STATE ---
const urlParams = new URLSearchParams(window.location.search);
const cardId = urlParams.get('id');
let currentUser = null;
let registering = false;
let _dialogOnCancel = null;

// --- SANITIZATION HELPERS ---
function escapeHTML(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
        digits.length === 10 ? `${digits.slice(0,5)} ${digits.slice(5)}` :
        digits.length === 9  ? `${digits.slice(0,3)} ${digits.slice(3,6)} ${digits.slice(6)}` :
        digits.length === 8  ? `${digits.slice(0,4)} ${digits.slice(4)}` :
        digits.length === 11 ? `${digits.slice(0,3)} ${digits.slice(3,7)} ${digits.slice(7)}` :
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
    const stampLogs = logs.slice(1);
    for (let i = stampLogs.length - 1; i >= 0; i--) {
        const d = parseStoredDate(stampLogs[i]);
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
    if (hr >= 5  && hr < 11) return { headline: `Good morning, ${firstName}!`,                    tagline: 'Ready for your morning protein fix?' };
    if (hr >= 11 && hr < 16) return { headline: `Egg-cellent choice for lunch, ${firstName}!`,    tagline: 'Your stamp awaits.' };
    if (hr >= 16 && hr < 21) return { headline: `Winding down, ${firstName}?`,                    tagline: 'Perfect time for a Golden Yolk visit.' };
    return                         { headline: `Late-night cravings, ${firstName}?`,              tagline: "Yolkshire's got your back." };
}
function getJoinDate(user) {
    if (!user.history) return '—';
    try {
        let first = user.history.split('|').filter(Boolean)[0];
        const d = parseStoredDate(first);
        if (isNaN(d)) return '—';
        return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch { return '—'; }
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
            parsed.push({ d, branch, visitIndex: i });
        } catch {}
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
    if (visits === 3) return "Free Beverage";
    if (visits === 6) return "Free Dessert";
    if (visits === 9) return "Free Meal";
    return "Free Reward";
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
    const isMilestone = visitIndex > 0 && visitIndex % 3 === 0;
    const isActivation = visitIndex === 0;
    const titleText = isActivation ? "Card Collection Date" : `Visit #${visitIndex}`;
    const baseClasses = (isMilestone || isActivation)
        ? 'bg-warning/15 border border-warning/40'
        : 'bg-surfaceVariant border border-gray-100';
    const icon = (isMilestone || isActivation) ? `<i class="fa-solid fa-${isActivation ? 'id-card' : 'gift'} text-warning text-sm mr-1.5"></i>` : '';
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
    cancelBtn.onclick  = () => { _dialogOnCancel = null; closeDialog(); if (onCancel)  onCancel();  };

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
    setTimeout(() => confetti({ particleCount: 60, angle: 60,  spread: 55, origin: { x: 0 }, colors }), 250);
    setTimeout(() => confetti({ particleCount: 60, angle: 120, spread: 55, origin: { x: 1 }, colors }), 400);
}
function celebrateMilestone(rewardIdx, rewardName) {
    return new Promise(resolve => {
        const el = document.getElementById('milestone');
        const label = el.querySelector('[data-reward-num]');
        const title = el.querySelector('h2');
        if (title) title.textContent = `${rewardName.toUpperCase()} UNLOCKED`;
        if (label) label.textContent = `Reward ${rewardIdx}/3 Redeemed`;
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
            window.location.href = '?id=' + encodeURIComponent(id);
        }
    }
}

async function init() {
    if (!cardId) return render('home');
    try {
        const res = await fetch(`${API_URL}/search?id=${encodeURIComponent(cardId)}`);
        const data = await res.json();
        if (data.length === 0) return showError("Card ID not found in database.");
        currentUser = data[0];
        render();
    } catch (err) { showError("Database connection failed. Check your SheetDB setup."); }
}

function render(view = 'default') {
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    const container = document.getElementById('main-content');

    // --- VIEW: HOME (Landing Page) ---
    if (view === 'home') {
        container.innerHTML = `
            <p class="text-sm font-semibold text-primary mb-8">${BRAND_NAME}</p>
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

                <button onclick="window.location.href='admin.html'" class="btn-choice">
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
            <p class="text-sm font-semibold text-primary mb-4">${BRAND_NAME}</p>
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
                <p class="text-sm font-semibold text-primary mb-6">${BRAND_NAME}</p>
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
        container.innerHTML = `
            <h2 class="text-xl font-semibold text-primary mb-2">Join Yolkshire's</h2>
            <p class="text-primary font-semibold mb-6">Golden Yolk Loyalty Program</p>
            ${OutlinedTextField("regName", "Full Name", "John Doe")}
            ${OutlinedTextField("regPhone", "Phone Number", "9876543210", "tel", isdHTML)}
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
                        <option value="PYC">PYC</option>
                        <option value="Bavdhan">Bavdhan</option>
                    </select>
                    <i class="fa-solid fa-chevron-down absolute right-4 top-4 text-gray-400 pointer-events-none"></i>
                </div>
            </div>
            <div class="mt-8">${PrimaryButton("Complete Activation", "handleRegistration()")}</div>
        `;
    }
    // --- VIEW: SUCCESS ---
    else if (view === 'success') {
        container.innerHTML = `
            <div class="py-10">
                <div class="w-16 h-16 bg-green-100 text-primary rounded-full flex items-center justify-center mx-auto mb-6 text-2xl">✓</div>
                <h2 class="text-2xl font-bold text-gray-800 mb-2 tracking-tight">Welcome aboard!</h2>
                <p class="text-sm text-gray-500 mb-3 font-medium">Your loyalty card #${escapeHTML(currentUser.id)} is now active.</p>
                <p class="text-sm font-semibold text-primary mb-10">${BRAND_NAME}</p>
                ${PrimaryButton("Go to Profile", "location.reload()")}
            </div>
        `;
    }
    // --- VIEW: PROFILE ---
    else if (view === 'default' || view === 'profile') {
        const visits = parseInt(currentUser.visits) || 0;
        const displayVisits = Math.min(Math.max(1, visits), 9);
        const progress = Math.min((displayVisits / 9) * 100, 100);
        const firstName = escapeHTML((currentUser.name || '').split(' ')[0]);
        const g = getGreeting(firstName);
        const isCardComplete = visits >= 10;
        const isRewardEarned = !isCardComplete && visits > 0 && visits % 3 === 0;
        const isNextReward = !isRewardEarned && !isCardComplete && (visits + 1) % 3 === 0;

        const profileHeader = `
            <p class="text-sm font-semibold text-primary mb-4 md:mb-3 md:text-xs">${BRAND_NAME}</p>
            <h2 class="text-xl font-bold text-gray-800 mb-1 tracking-tight leading-tight md:text-lg">${escapeHTML(g.headline)}</h2>
            <p class="text-sm text-onSurfaceVariant font-medium mb-6 md:mb-5 md:text-xs">${escapeHTML(g.tagline)}</p>

            <div class="relative w-full bg-surfaceVariant h-5 rounded-full mb-6 p-1 shadow-inner">
                <div id="pBar" class="progress-transition bg-primary h-full rounded-full" style="width: 0%"></div>
            </div>

            <div class="flex justify-between items-center mb-8 px-2 border-b border-gray-100 pb-8 gap-4">
                <div class="text-left leading-none flex items-baseline">
                    <span class="text-6xl font-black text-primary">${displayVisits}</span>
                    <span class="text-xl text-onSurfaceVariant font-bold">/ 9</span>
                </div>
                <div class="grid grid-cols-2 gap-x-4 gap-y-2">
                    ${ProfileStat("Card ID", escapeHTML(currentUser.id))}
                    ${ProfileStat("Join Date", getJoinDate(currentUser))}
                    ${ProfileStat("Phone", escapeHTML(formatPhone(currentUser.phone)))}
                    ${ProfileStat(isCardComplete ? "Completed Date" : "Last Visit", escapeHTML(getLastVisitLabel(currentUser)))}
                </div>
            </div>
        `;

        if (isCardComplete) {
            container.innerHTML = `
                ${profileHeader}
                <div class="bg-gradient-to-br from-warning/25 to-warning/5 border-2 border-warning reward-glow rounded-3xl p-6 mb-6 text-center">
                    <i class="fa-solid fa-trophy text-warning text-5xl mb-3 gift-wiggle"></i>
                    <p class="text-sm text-onSurface font-bold mb-2">🎉 Yayy, you're a certified Eggomaniac now</p>
                    <p class="text-sm text-onSurface font-medium mb-4">
                        You've collected all 9 stamps and earned a Free Meal. Thank you for being part of ${BRAND_NAME}!
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

            const rewardName = getRewardName(visits);
            const heroBanner = isRewardEarned ? `
                <div class="mb-5 text-center">
                    <i class="fa-solid fa-gift gift-wiggle text-warning text-5xl mb-3"></i>
                    <h3 class="text-lg font-black text-primary tracking-tight leading-tight uppercase">YOU'VE EARNED<br>A ${rewardName}</h3>
                    <p class="text-xs text-onSurfaceVariant font-semibold mt-2">Show this screen to your server</p>
                </div>
            ` : '';

            const nextRewardName = getRewardName(visits + 1);
            const nextRewardPill = isNextReward ? `
                <div class="mb-4 py-1.5 px-3 bg-warning bg-opacity-10 text-primary text-[10px] font-black uppercase tracking-widest border border-warning border-opacity-20 rounded-lg text-center">${nextRewardName} on next visit</div>
            ` : '';

            container.innerHTML = `
                ${profileHeader}
                <div class="${rewardCardClasses} rounded-3xl p-6 mb-6">
                    ${heroBanner}
                    <div class="mb-4 text-left">
                        <select id="branchSelect" class="w-full border border-outline rounded-xl px-4 py-3 font-bold text-sm outline-none bg-surface focus:border-primary focus:ring-1 focus:ring-primary transition-all">
                            <option value="" disabled selected>Select Branch...</option>
                            <option value="Kothrud">Kothrud</option>
                            <option value="Aundh">Aundh</option>
                            <option value="Salunkhe Vihar">Salunkhe Vihar</option>
                            <option value="Pimple Saudagar">Pimple Saudagar</option>
                            <option value="Wadgaon Sheri">Wadgaon Sheri</option>
                            <option value="Wakad">Wakad</option>
                            <option value="PYC">PYC</option>
                            <option value="Bavdhan">Bavdhan</option>
                        </select>
                    </div>
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
                    ${PrimaryButton("Collect Stamp", "handleVisit(" + visits + ")")}
                </div>

                <button onclick="render('history')" class="text-primary font-bold text-xs uppercase tracking-[0.2em] border-b-2 border-primary border-opacity-20 pb-1 mx-auto block">Visit History</button>
            `;
        }
        setTimeout(() => { const bar = document.getElementById('pBar'); if (bar) bar.style.width = progress + '%'; }, 200);
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
}

async function handleRegistration() {
    if (registering) return;
    const btn = document.getElementById('handleRegistrationBtn');
    const rawName = document.getElementById('regName').value;
    const isd = document.getElementById('isd').value;
    const rawPhone = document.getElementById('regPhone').value;
    const branchSelect = document.getElementById('regBranch');
    const branchName = branchSelect ? branchSelect.value : '';

    if (!branchName) return showDialog("Select Branch", "Please select the collection branch.");

    const name = sanitizeName(rawName);
    if (!name) return showDialog("Invalid Name", "Please enter a valid name (2-50 letters, spaces or dots).");

    const phoneCheck = validatePhone(isd, rawPhone);
    if (!phoneCheck.ok) return showDialog("Invalid Phone", phoneCheck.reason);

    const fullPhone = canonicalPhoneFromParts(isd, phoneCheck.digits);

    registering = true;
    if (btn) { btn.disabled = true; btn.innerHTML = "Verifying..."; }

    try {
        const res = await fetch(API_URL);
        const globalUsers = await res.json();
        
        if (phoneAlreadyRegistered(globalUsers, fullPhone, cardId)) {
            registering = false;
            if (btn) { btn.disabled = false; btn.innerHTML = "Complete Activation"; }
            return showDialog("Phone Exists", "Phone number already registered. Please try a different number.");
        }

        const todayStr = new Date().toISOString();
        const historyLog = `${todayStr}@${branchName}`;

        await fetch(`${API_URL}/id/${encodeURIComponent(cardId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, phone: fullPhone, visits: 0, last_visit: todayStr, history: historyLog })
        });
        render('success');
    } catch (err) {
        registering = false;
        showError("Database connection failed. Refresh and try again.");
    }
}

async function handleVisit(currentVisits) {
    const btn = document.getElementById('handleVisitBtn');
    if (btn && btn.disabled) return;
    if (btn) btn.disabled = true;
    const reenable = () => { if (btn) btn.disabled = false; };

    const newVisitCount = currentVisits + 1;
    // Celebration fires on the stamp AFTER a reward was earned (confirms redemption),
    // plus on the final stamp itself (card-complete moment, no next visit available).
    const isPostRewardStamp = currentVisits > 0 && currentVisits % 3 === 0 && currentVisits < 9; 
    const isFinalStamp = currentVisits === 9; // redeeming the 9th stamp 
    const shouldCelebrate = isPostRewardStamp || isFinalStamp;
    const rewardIdx = isFinalStamp ? 3 : (isPostRewardStamp ? currentVisits / 3 : null);

    console.log(`[DEBUG] handleVisit: currentVisits=${currentVisits} → newVisitCount=${newVisitCount}, postReward=${isPostRewardStamp}, final=${isFinalStamp}, rewardIdx=${rewardIdx}`);

    const pin = document.getElementById('staffPin').value;
    const branchSelect = document.getElementById('branchSelect');
    const branchName = branchSelect ? branchSelect.value : '';

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
    } else {
        console.log("[DEBUG] Daily Limit check is DISABLED for testing.");
    }

    if (currentVisits >= 10) {
        reenable();
        return showDialog("Card Complete", "Guest has already completed this card. Please generate a new card number.");
    }

    if (shouldCelebrate) {
        const firstName = (currentUser.name || '').split(' ')[0] || 'the guest';
        const rName = getRewardName(rewardIdx * 3);
        const message = isFinalStamp
            ? `Final stamp of the card! Did ${firstName} redeem their ${rName} today? Stamping will proceed regardless.`
            : `Welcome back! Did ${firstName} redeem their ${rName} from their last visit? Stamping will proceed regardless.`;
        ConfirmDialog(
            `${rName} 🎁`,
            message,
            () => proceedStamp(newVisitCount, rewardIdx, branchName),
            () => proceedStamp(newVisitCount, rewardIdx, branchName)
        );
    } else {
        proceedStamp(newVisitCount, null, branchName);
    }
}

async function proceedStamp(newVisitCount, rewardIdx, branchName) {
    const btn = document.getElementById('handleVisitBtn');
    if (btn) btn.innerHTML = "Stamping...";

    const now = new Date();
    const nowIso = now.toISOString();
    const logEntry = branchName ? now.toISOString() + "@" + branchName : now.toISOString();
    const updatedHistory = currentUser.history ? currentUser.history + "|" + logEntry : logEntry;

    try {
        await fetch(`${API_URL}/id/${encodeURIComponent(cardId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                visits: newVisitCount,
                last_visit: nowIso,
                history: updatedHistory
            })
        });

        if (rewardIdx != null) {
            await celebrateMilestone(rewardIdx, getRewardName(rewardIdx * 3));
        }
        location.reload();
    } catch (err) { showError("Database connection failed. Visit not stamped."); }
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
