const API_URL = "https://sheetdb.io/api/v1/im2qg2cit3cco";
let allData = [];
let expandedRows = new Set();
let selectedBranch = 'All';
let allBranches = new Set();

function login() {
    const pin = document.getElementById('adminPin').value;
    const name = document.getElementById('adminName').value.trim() || 'Admin';
    if (pin === "2010") {
        document.getElementById('welcome-msg').textContent = `Welcome, ${name}`;
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('dashboard-screen').classList.remove('hidden');
        fetchData();
    } else {
        document.getElementById('login-error').classList.remove('hidden');
    }
}

document.getElementById('adminPin').addEventListener('keypress', function (e) { if (e.key === 'Enter') login(); });

async function fetchData() {
    try {
        const res = await fetch(API_URL);
        const data = await res.json();
        allData = data.filter(row => row.id && row.id.trim() !== "");
        
        // Extract all unique branches
        allData.forEach(u => {
            if (u.history) {
                const logs = u.history.split('|').filter(Boolean);
                logs.forEach(log => {
                    if (log.includes('@')) {
                        allBranches.add(log.split('@')[1]);
                    }
                });
            }
        });
        
        renderBranchChips();
        renderTable();
    } catch (err) {
        document.getElementById('tableBody').innerHTML = '<tr><td colspan="7" class="p-8 text-center text-red-500 font-bold">Failed to load data.</td></tr>';
    }
}

function renderBranchChips() {
    const container = document.getElementById('branch-chips');
    container.innerHTML = '';
    
    const branches = ['All', ...Array.from(allBranches).sort()];
    
    branches.forEach(branch => {
        const isSelected = branch === selectedBranch;
        const btn = document.createElement('button');
        btn.textContent = branch === 'All' ? 'All Branches' : branch;
        btn.className = `px-4 py-1.5 rounded-full text-xs font-bold border transition-colors ${
            isSelected 
            ? 'border-primary bg-primary text-white' 
            : 'border-gray-300 bg-white text-gray-600 hover:border-primary'
        }`;
        btn.onclick = () => {
            selectedBranch = branch;
            renderBranchChips();
            renderTable();
        };
        container.appendChild(btn);
    });
}

function extractHistoryDetails(historyStr) {
    if (!historyStr) return [];
    const logs = historyStr.split('|').filter(Boolean);
    return logs.map((log, index) => {
        let date = log;
        let branch = 'Unknown';
        if (log.includes('@')) {
            [date, branch] = log.split('@');
        }
        return { date: new Date(date), branch, visitNumber: index + 1 };
    }).reverse(); // newest first
}

function toggleCustomDateRange() {
    const dateFilter = document.getElementById('dateFilter').value;
    const customDateRange = document.getElementById('customDateRange');
    if (dateFilter === 'Custom') {
        customDateRange.classList.remove('hidden');
        customDateRange.classList.add('flex');
    } else {
        customDateRange.classList.remove('flex');
        customDateRange.classList.add('hidden');
    }
    renderTable();
}

function toggleRow(id) {
    if (expandedRows.has(id)) expandedRows.delete(id);
    else expandedRows.add(id);
    renderTable();
}

function renderTable() {
    const tbody = document.getElementById('tableBody');
    tbody.innerHTML = '';

    const search = document.getElementById('searchInput').value.toLowerCase();
    const statusFilter = document.getElementById('statusFilter').value;
    const dateFilter = document.getElementById('dateFilter').value;

    let filtered = allData.filter(u => u.name && u.name.trim() !== "");

    // Apply Text Search
    if (search) {
        filtered = filtered.filter(u => 
            (u.name && u.name.toLowerCase().includes(search)) ||
            (u.phone && u.phone.includes(search)) ||
            (u.id && u.id.toLowerCase().includes(search))
        );
    }

    // Apply Status Filter
    if (statusFilter === 'Completed') {
        filtered = filtered.filter(u => parseInt(u.visits) >= 10);
    } else if (statusFilter === 'Uncompleted') {
        filtered = filtered.filter(u => parseInt(u.visits) < 10);
    }

    // Apply Date & Branch Filter
    const now = new Date();
    let totalMatchingStamps = 0;
    
    let customStart = null;
    let customEnd = null;
    if (dateFilter === 'Custom') {
        const s = document.getElementById('startDate').value;
        const e = document.getElementById('endDate').value;
        if (s) customStart = new Date(s);
        if (e) customEnd = new Date(e);
        if (customEnd) customEnd.setHours(23, 59, 59, 999);
    }

    filtered = filtered.filter(u => {
        const history = extractHistoryDetails(u.history);
        let matchingVisits = history;

        if (selectedBranch !== 'All') {
            matchingVisits = matchingVisits.filter(v => v.branch === selectedBranch);
        }

        if (dateFilter !== 'All') {
            matchingVisits = matchingVisits.filter(v => {
                if (!v.date || isNaN(v.date)) return false;
                if (dateFilter === 'Custom') {
                    if (customStart && v.date < customStart) return false;
                    if (customEnd && v.date > customEnd) return false;
                    return true;
                }
                const diffDays = (now - v.date) / (1000 * 60 * 60 * 24);
                if (dateFilter === 'Today' && diffDays > 1) return false;
                if ((dateFilter === 'ThisWeek' || dateFilter === 'Last7Days') && diffDays > 7) return false;
                if ((dateFilter === 'ThisMonth' || dateFilter === 'Last30Days') && diffDays > 30) return false;
                if (dateFilter === 'ThisYear' && diffDays > 365) return false;
                return true;
            });
        }

        if (matchingVisits.length > 0 || (dateFilter === 'All' && selectedBranch === 'All')) {
            if (dateFilter !== 'All' || selectedBranch !== 'All') {
                totalMatchingStamps += matchingVisits.length;
            } else {
                totalMatchingStamps += parseInt(u.visits) || 0;
            }
            return true;
        }
        return false;
    });

    // Sort by latest visit
    filtered.sort((a, b) => {
        const ha = extractHistoryDetails(a.history);
        const hb = extractHistoryDetails(b.history);
        const da = ha.length ? ha[0].date : 0;
        const db = hb.length ? hb[0].date : 0;
        return db - da;
    });

    // Update Stats for filtered
    const totalCustomers = filtered.length;
    const completedCards = filtered.filter(u => parseInt(u.visits) >= 10).length;
    const activeCards = filtered.filter(u => parseInt(u.visits) > 0 && parseInt(u.visits) < 10).length;
    const avgVisits = totalCustomers > 0 ? (filtered.reduce((sum, u) => sum + Math.min(parseInt(u.visits)||0, 10), 0) / totalCustomers).toFixed(1) : 0;
    
    document.getElementById('stat-total').textContent = totalCustomers;
    if(document.getElementById('stat-avg')) document.getElementById('stat-avg').textContent = avgVisits;
    if(document.getElementById('stat-active')) document.getElementById('stat-active').textContent = activeCards;
    document.getElementById('stat-completed').textContent = completedCards;

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="p-8 text-center text-gray-400">No matching records found.</td></tr>';
        return;
    }

    filtered.forEach(user => {
        const visits = parseInt(user.visits) || 0;
        const history = extractHistoryDetails(user.history);
        const lastBranch = history.length ? history[0].branch : '—';
        const displayVisits = Math.min(visits, 9);
        const badgeClass = visits >= 10 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700';
        const isExpanded = expandedRows.has(user.id);

        const tr = document.createElement('tr');
        tr.className = 'border-b border-gray-100 transition-colors main-row block sm:table-row bg-white sm:bg-transparent rounded-2xl sm:rounded-none shadow-sm sm:shadow-none mb-4 sm:mb-0';
        tr.onclick = () => toggleRow(user.id);
        tr.innerHTML = `
            <td class="p-4 sm:p-4 text-gray-500 font-semibold block sm:table-cell flex justify-between items-center"><span class="sm:hidden text-[10px] font-bold text-gray-400 uppercase">Card ID</span>#${user.id}</td>
            <td class="p-4 sm:p-4 font-bold text-gray-800 block sm:table-cell flex justify-between items-center border-t border-gray-50 sm:border-none"><span class="sm:hidden text-[10px] font-bold text-gray-400 uppercase">Name</span>${user.name || '—'}</td>
            <td class="p-4 sm:p-4 text-gray-600 block sm:table-cell flex justify-between items-center border-t border-gray-50 sm:border-none"><span class="sm:hidden text-[10px] font-bold text-gray-400 uppercase">Phone</span>${user.phone || '—'}</td>
            <td class="p-4 sm:p-4 text-center block sm:table-cell flex justify-between items-center border-t border-gray-50 sm:border-none">
                <span class="sm:hidden text-[10px] font-bold text-gray-400 uppercase">Visits</span>
                <span class="${badgeClass} px-2.5 py-1 rounded-md text-xs font-black tracking-widest">${displayVisits}/9</span>
            </td>
            <td class="p-4 sm:p-4 text-gray-600 block sm:table-cell flex justify-between items-center border-t border-gray-50 sm:border-none"><span class="sm:hidden text-[10px] font-bold text-gray-400 uppercase">Last Branch</span>${lastBranch}</td>
            <td class="p-4 sm:p-4 text-gray-600 block sm:table-cell flex justify-between items-center border-t border-gray-50 sm:border-none"><span class="sm:hidden text-[10px] font-bold text-gray-400 uppercase">Last Visit</span>${user.last_visit || '—'}</td>
            <td class="p-4 sm:p-4 text-gray-400 sm:text-right block sm:table-cell flex justify-center border-t border-gray-50 sm:border-none cursor-pointer hover:bg-gray-50 rounded-b-2xl sm:rounded-none">
                <span class="sm:hidden text-xs font-bold mr-2">History</span> <i class="fa-solid fa-chevron-${isExpanded ? 'up' : 'down'}"></i>
            </td>
        `;
        tbody.appendChild(tr);

        if (isExpanded) {
            const histTr = document.createElement('tr');
            histTr.className = 'history-row border-b border-gray-200 block sm:table-row bg-gray-50 sm:bg-transparent rounded-b-2xl sm:rounded-none mb-4 sm:mb-0 -mt-4 sm:mt-0 relative z-0';
            
            let histHTML = '<td colspan="7" class="p-4 sm:p-6 block sm:table-cell">';
            histHTML += '<p class="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Visit History</p>';
            histHTML += '<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">';
            
            if (history.length === 0) {
                histHTML += '<p class="text-sm text-gray-500">No visits recorded.</p>';
            } else {
                history.forEach(item => {
                    const d = item.date;
                    const dateStr = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
                    const timeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
                    histHTML += `
                        <div class="bg-white border border-gray-200 p-3 rounded-xl flex justify-between items-center">
                            <div>
                                <p class="text-xs font-bold text-gray-500 uppercase">Visit #${item.visitNumber}</p>
                                <p class="font-bold text-gray-800">${dateStr}</p>
                                <p class="text-[10px] font-semibold text-gray-500 mt-1"><i class="fa-solid fa-location-dot mr-1"></i>${item.branch}</p>
                            </div>
                            <p class="text-xs font-semibold text-gray-400">${timeStr}</p>
                        </div>
                    `;
                });
            }
            
            histHTML += '</div></td>';
            histTr.innerHTML = histHTML;
            tbody.appendChild(histTr);
        }
    });
}

window.login = login;
window.renderTable = renderTable;
window.toggleCustomDateRange = toggleCustomDateRange;
window.toggleRow = toggleRow;
