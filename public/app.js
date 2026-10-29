// public/app.js
let token = '';
let currentUser = null;
let cachedReports = [];
let allMetadataZones = [];
let allMetadataTeams = [];
let cachedUsersList = [];
let currentSummaryReportId = null;

// Restore session automatically on page refresh
window.addEventListener('DOMContentLoaded', () => {
  const savedToken = sessionStorage.getItem('clinic_token');
  const savedUser = sessionStorage.getItem('clinic_user');
  if (savedToken && savedUser) {
    token = savedToken;
    currentUser = JSON.parse(savedUser);
    initAppView();
  }
});

const submitBtn = document.getElementById('btnGoToSubmit');
  if (submitBtn) {
    if (currentUser.role === 'ADMIN') {
      submitBtn.classList.add('hidden');
    } else {
      submitBtn.classList.remove('hidden');
    }
  }

async function login() {
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  if (!res.ok) return alert(data.error);

  token = data.token;
  currentUser = data.user;
  sessionStorage.setItem('clinic_token', token);
  sessionStorage.setItem('clinic_user', JSON.stringify(currentUser));
  initAppView();
}

async function initAppView() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('detailScreen').classList.add('hidden');
  document.getElementById('appScreen').classList.remove('hidden');

  const greetingEl = document.getElementById('userGreeting');
  if (greetingEl) {
    greetingEl.innerText = `${currentUser.full_name} (${currentUser.role})`;
  }
  
  let hierarchyMeta = `Zone: ${currentUser.zone_name || 'All'} | Team: ${currentUser.team_name || 'All'}`;
  if (currentUser.role === 'TIER_4') {
    hierarchyMeta += ` | Leader: ${currentUser.leader_name || 'Not Assigned'} | Manager: ${currentUser.manager_name || 'Not Assigned'}`;
  } else if (currentUser.role === 'TIER_3') {
    hierarchyMeta += ` | Manager: ${currentUser.manager_name || 'Not Assigned'}`;
  }
  
  const metaEl = document.getElementById('userMeta');
  if (metaEl) {
    metaEl.innerText = hierarchyMeta;
  }

  const navSubmitLink = document.getElementById('navSubmitLink');
  const dashboardSection = document.getElementById('reportDashboardSection');
  const userBox = document.getElementById('userManagementBox');

  // ADMIN: Show ONLY User Management (Hide dashboard & submit link)
  if (currentUser.role === 'ADMIN') {
    if (navSubmitLink) navSubmitLink.classList.add('hidden');
    if (dashboardSection) dashboardSection.classList.add('hidden');
    if (userBox) userBox.classList.remove('hidden');
    try { await loadMetadataAndUsers(); } catch (e) { console.error(e); }
    return;
  }

  // ALL OTHER ROLES
  if (navSubmitLink) navSubmitLink.classList.remove('hidden');
  if (dashboardSection) dashboardSection.classList.remove('hidden');

  if (currentUser.role === 'SUPER_ADMIN') {
    if (userBox) userBox.classList.remove('hidden');
    const csvBox = document.getElementById('csvImportSection');
    const migBox = document.getElementById('migrationBox');
    if (csvBox) csvBox.classList.remove('hidden');
    if (migBox) migBox.classList.remove('hidden');
    try { await loadMetadataAndUsers(); } catch (e) { console.error(e); }
    try { await loadUsersForMigration(); } catch (e) { console.error(e); }
  } else {
    if (userBox) userBox.classList.add('hidden');
  }

  try {
    if (typeof loadDashboardFiltersMetadata === 'function') {
      await loadDashboardFiltersMetadata();
    }
  } catch (e) {
    console.error('Metadata load error:', e);
  }

  try {
    await loadReports();
  } catch (e) {
    console.error('Reports load error:', e);
  }
}

function logout() {
  sessionStorage.removeItem('clinic_token');
  sessionStorage.removeItem('clinic_user');
  location.reload();
}

// SUBMIT NEW REPORT
async function submitReportForm(e) {
  e.preventDefault();
  try {
    const form = e.target;
    const formData = new FormData(form);
    const res = await fetch('/api/reports', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error || 'Failed to submit report');

    alert(data.message);
    form.reset();
    loadReports();
  } catch (err) {
    alert('Error submitting report: ' + err.message);
  }
  return false;
}

// LOAD DASHBOARD REPORTS & FILTERS
let globalZonesList = [];
let globalTeamsList = [];

async function loadDashboardFiltersMetadata() {
  const res = await fetch('/api/metadata/zones-teams', { headers: { Authorization: `Bearer ${token}` } });
  if (res.ok) {
    const meta = await res.json();
    globalZonesList = meta.zones || [];
    globalTeamsList = meta.teams || [];

    // Target Masterlist dropdowns (filterZoneMaster / filterTeamMaster)
    const zoneMasterEl = document.getElementById('filterZoneMaster');
    if (zoneMasterEl) {
      zoneMasterEl.innerHTML = '<option value="">All Zones</option>' + 
        globalZonesList.map(z => `<option value="${z.name}">${z.name}</option>`).join('');
    }

    const teamMasterEl = document.getElementById('filterTeamMaster');
    if (teamMasterEl) {
      updateTeamFilterDropdownMaster();
    }

    // Support legacy filter elements if present
    const legacyZone = document.getElementById('filterZone');
    if (legacyZone) {
      legacyZone.innerHTML = '<option value="">All Zones</option>' + 
        globalZonesList.map(z => `<option value="${z.name}">${z.name}</option>`).join('');
    }
  }
}

function updateTeamFilterDropdownMaster(zoneName = '') {
  const teamSelect = document.getElementById('filterTeamMaster');
  if (!teamSelect) return;

  let teams = globalTeamsList;
  if (zoneName) {
    const zoneObj = globalZonesList.find(z => z.name === zoneName);
    if (zoneObj) {
      teams = teams.filter(t => Number(t.zone_id) === Number(zoneObj.id));
    }
  }

  teamSelect.innerHTML = '<option value="">All Teams</option>' + 
    teams.map(t => `<option value="${t.name}">${t.name}</option>`).join('');
}

function onMasterZoneFilterChange() {
  const selectedZone = document.getElementById('filterZoneMaster') ? document.getElementById('filterZoneMaster').value : '';
  updateTeamFilterDropdownMaster(selectedZone);
  loadReports();
}

function updateTeamFilterDropdown(zoneName = '') {
  const teamSelect = document.getElementById('filterTeam');
  let teams = globalTeamsList;
  if (zoneName) {
    const zoneObj = globalZonesList.find(z => z.name === zoneName);
    if (zoneObj) {
      teams = teams.filter(t => Number(t.zone_id) === Number(zoneObj.id));
    }
  }
  teamSelect.innerHTML = '<option value="">All Teams</option>' + 
    teams.map(t => `<option value="${t.name}">${t.name}</option>`).join('');
}

function onZoneFilterChange() {
  const selectedZoneName = document.getElementById('filterZone').value;
  updateTeamFilterDropdown(selectedZoneName);
  loadReports();
}

function resetDashboardFilters() {
  document.getElementById('filterMonth').value = '';
  if (document.getElementById('filterZone')) document.getElementById('filterZone').value = '';
  if (document.getElementById('filterTeam')) document.getElementById('filterTeam').value = '';
  document.getElementById('filterStatus').value = '';
  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.value = '';
  updateTeamFilterDropdown();
  loadReports();
}

function formatStatus(status) {
  switch ((status || '').trim()) {
    case 'PENDING_T3': return 'Pending Team Leader';
    case 'PENDING_T2': return 'Pending Sales Manager';
    case 'PENDING_T1': return 'Pending Sales Director';
    case 'APPROVED_CLOSED': return 'Approved & Closed';
    case 'REJECTED': return 'Rejected';
    default: return status || '-';
  }
}

async function openCompletionModalPreSelected(refNo) {
  await openCompletionModal();
  const selectEl = document.getElementById('comp_report_id');
  if (selectEl) {
    for (let opt of selectEl.options) {
      if (opt.text.includes(refNo)) {
        selectEl.value = opt.value;
        break;
      }
    }
  }
}

async function openMonthlyProofModalPreSelected(refNo) {
  await openMonthlyProofModal();
  const selectEl = document.getElementById('proof_report_id');
  if (selectEl) {
    for (let opt of selectEl.options) {
      if (opt.text.includes(refNo)) {
        selectEl.value = opt.value;
        break;
      }
    }
  }
}

// Populate Zone and Team filter dropdowns on dashboard load
async function loadReports() {
  try {
    const searchInput = document.getElementById('searchInput');
    const search = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const filterZone = document.getElementById('filterZoneMaster') ? document.getElementById('filterZoneMaster').value : '';
    const filterTeam = document.getElementById('filterTeamMaster') ? document.getElementById('filterTeamMaster').value : '';

    const res = await fetch('/api/masterlist', {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (!res.ok) return;
    let records = await res.json();

    // Apply Search & Dropdown Filters
    if (search) {
      records = records.filter(r => 
        (r.clinic_name && r.clinic_name.toLowerCase().includes(search)) ||
        (r.sr_ref_no && r.sr_ref_no.toLowerCase().includes(search)) ||
        (r.pic_name && r.pic_name.toLowerCase().includes(search)) ||
        (r.ne_name && r.ne_name.toLowerCase().includes(search)) ||
        (r.payee_name && r.payee_name.toLowerCase().includes(search))
      );
    }

    if (filterZone) {
      records = records.filter(r => r.zone_name === filterZone);
    }

    if (filterTeam) {
      records = records.filter(r => r.team_name === filterTeam);
    }

    cachedReports = records;
    const tbody = document.getElementById('reportTableBody');
    const role = (currentUser.role || '').trim();

    if (!records || records.length === 0) {
      tbody.innerHTML = `<tr><td colspan="11" class="text-center py-8 text-slate-400 text-xs italic">No Master List SR requests found matching your filters.</td></tr>`;
      return;
    }

    tbody.innerHTML = records.map(r => {
      const status = r.approval_status || 'PENDING_T3';
      const canGenerateInvoice = status === 'APPROVED_CLOSED';

      let canApprove = false;
      if (role === 'TIER_3' && status === 'PENDING_T3') canApprove = true;
      if (role === 'TIER_2' && (status === 'PENDING_T2' || status === 'PENDING_T3')) canApprove = true;
      if (role === 'TIER_1' && ['PENDING_T1', 'PENDING_T2', 'PENDING_T3'].includes(status)) canApprove = true;
      if (role === 'SUPER_ADMIN' && status !== 'APPROVED_CLOSED') canApprove = true;

      const badgeColor = status === 'REJECTED' ? 'bg-red-100 text-red-700' :
                         status === 'APPROVED_CLOSED' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700';

      // 1. Calculate Active / Expiring / Expired SR Status based on dates
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const startDate = r.start_date ? new Date(r.start_date) : today;
      startDate.setHours(0, 0, 0, 0);

      const endDate = r.end_date ? new Date(r.end_date) : today;
      endDate.setHours(0, 0, 0, 0);
      
      const diffTime = endDate - today;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      const isActive = today >= startDate && today <= endDate;
      const isExpired = today > endDate;
      const isExpiring = !isExpired && diffDays >= 0 && diffDays <= 7;

      let srStatusHtml = '';
      if (isExpired) {
        srStatusHtml = `<span class="bg-slate-200 text-slate-700 px-2 py-1 rounded font-bold text-[10px] inline-block">🔴 Expired (${Math.abs(diffDays)}d ago)</span>`;
      } else if (isActive && isExpiring) {
        srStatusHtml = `<span class="bg-amber-100 text-amber-800 px-2 py-1 rounded font-bold text-[10px] inline-block">⏰ Expiring Soon (${diffDays}d left)</span>`;
      } else if (isActive) {
        srStatusHtml = `<span class="bg-emerald-100 text-emerald-800 px-2 py-1 rounded font-bold text-[10px] inline-block">🟢 Active SR</span>`;
      } else {
        srStatusHtml = `<span class="bg-blue-100 text-blue-800 px-2 py-1 rounded font-bold text-[10px] inline-block">🔵 Upcoming</span>`;
      }

      // 2. Photo Verification & Workflow Warnings
      const photos = r.photos || [];
      const hasSignedAgreement = photos.some(p => 
        (p.doc_type || '').toLowerCase().includes('signed agreement') || 
        (p.doc_type || '').toLowerCase().includes('booking form') ||
        (p.doc_type || '').toLowerCase().includes('agreement')
      );

      const hasInitialPosmPhoto = photos.some(p => 
        (p.doc_type || '').toLowerCase().includes('posm in place') || 
        (p.doc_type || '').toLowerCase().includes('initial')
      );

      let photoStatusHtml = '';

      if (!hasSignedAgreement || !hasInitialPosmPhoto) {
        if (status === 'APPROVED_CLOSED') {
          photoStatusHtml += `<span class="text-red-600 font-extrabold text-[10px] block bg-red-50 p-1 rounded border border-red-200 mb-1">
            ⚠️ WARNING: Final approved! Please submit Signed Agreement & Initial POSM Photo.
          </span>`;
        } else {
          photoStatusHtml += `<span class="text-amber-600 font-semibold text-[10px] block">
            ⏳ Awaiting Director Approval before Agreement submission.
          </span>`;
        }
      } else {
        photoStatusHtml += `<span class="text-emerald-700 font-bold text-[10px] block">✅ Signed Agreement & Initial Photo: Attached</span>`;

        // Track Monthly POSM Proof Photos based on contract duration start/end months
        let currentLoopDate = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
        const finalLoopDate = new Date(endDate.getFullYear(), endDate.getMonth(), 1);

        let missingMonthlyProof = false;
        let expectedMonthsCount = 0;
        let attachedMonthsCount = 0;

        while (currentLoopDate <= finalLoopDate && currentLoopDate <= today) {
          expectedMonthsCount++;
          const mStr = `${currentLoopDate.getFullYear()}-${String(currentLoopDate.getMonth() + 1).padStart(2, '0')}`;
          
          const hasThisMonth = photos.some(p => 
            (p.doc_type || '').includes(mStr) || (p.photo_date || '').includes(mStr)
          );

          if (hasThisMonth) {
            attachedMonthsCount++;
          } else if (today >= currentLoopDate) {
            missingMonthlyProof = true;
          }

          currentLoopDate.setMonth(currentLoopDate.getMonth() + 1);
        }

        if (missingMonthlyProof) {
          photoStatusHtml += `<span class="text-red-600 font-extrabold text-[10px] block bg-red-50 p-1 rounded border border-red-200 mt-1">
            ⚠️ WARNING: Monthly POSM Photo missing for active month! (${attachedMonthsCount}/${expectedMonthsCount} months uploaded)
          </span>`;
        } else {
          photoStatusHtml += `<span class="text-emerald-700 font-bold text-[10px] block mt-1">
            ✅ Monthly POSM Proofs Up-to-Date (${attachedMonthsCount}/${expectedMonthsCount} months)
          </span>`;
        }
      }

      const docCount = photos.length;
      const docButtonHtml = docCount > 0 
        ? `<button type="button" onclick="openDocumentsModal(${r.report_id || r.id})" class="bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 px-2.5 py-1 rounded text-[10px] font-bold cursor-pointer w-full">📄 View Docs (${docCount})</button>`
        : `<span class="text-[10px] text-slate-400">No docs attached</span>`;

      // Contextual Action Buttons (Edit, Approve, Reject, View Docs, PDF, Uploads)
      const targetId = r.report_id || r.id;

      let actionButtonsHtml = `
        <div class="flex space-x-1 mb-1">
          <button type="button" onclick="openMasterModal('edit', ${r.id})" class="bg-amber-500 hover:bg-amber-600 text-white px-2 py-1 rounded text-[10px] font-semibold cursor-pointer">Edit</button>
          ${canApprove ? `
            <button type="button" onclick="updateApproval(${targetId}, 'APPROVE')" class="bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1 rounded text-[10px] font-semibold cursor-pointer">Approve</button>
            <button type="button" onclick="openRejectModal(${targetId})" class="bg-red-600 hover:bg-red-700 text-white px-2 py-1 rounded text-[10px] font-semibold cursor-pointer">Reject</button>
          ` : ''}
        </div>
        <div class="mb-1">${docButtonHtml}</div>
      `;

      if (canGenerateInvoice) {
        actionButtonsHtml += `
          <div class="mb-1">
            <button type="button" onclick="openInvoiceModal(${r.report_id || r.id})" class="bg-indigo-600 hover:bg-indigo-700 text-white px-2.5 py-1 rounded text-[10px] font-semibold cursor-pointer w-full">
              🖨️ PDF Booking Form
            </button>
          </div>
        `;

        if (!hasSignedAgreement || !hasInitialPosmPhoto) {
          actionButtonsHtml += `
            <div>
              <button type="button" onclick="openCompletionModalPreSelected('${r.sr_ref_no}')" class="bg-purple-600 hover:bg-purple-700 text-white px-2 py-1 rounded text-[10px] font-bold cursor-pointer w-full">
                📸 Submit Agreement & POSM
              </button>
            </div>
          `;
        } else {
          actionButtonsHtml += `
            <div>
              <button type="button" onclick="openMonthlyProofModalPreSelected('${r.sr_ref_no}')" class="bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1 rounded text-[10px] font-bold cursor-pointer w-full">
                📅 Upload Monthly Proof
              </button>
            </div>
          `;
        }
      } else {
        actionButtonsHtml += `<div class="text-[10px] text-slate-400">PDF & Uploads Locked</div>`;
      }

      return `
        <tr class="border-b hover:bg-slate-50">
          <td class="p-3 font-mono font-bold text-blue-600 cursor-pointer hover:underline" onclick="window.location.href='/montly_report.html?ref=${r.sr_ref_no}'">
            ${r.sr_ref_no}
          </td>
          <td class="p-3 font-semibold text-[11px]">${r.zone_name || '-'}<br><span class="text-slate-500 font-normal">${r.team_name || '-'}</span></td>
          <td class="p-3"><b>${r.region || 'CREC'}</b><br><span class="text-slate-500">NE: ${r.ne_name || '-'}</span></td>
          <td class="p-3"><b>${r.clinic_name}</b><br><span class="text-slate-500">PIC: ${r.pic_name}</span></td>
          <td class="p-3"><b>${r.payee_name || '-'}</b><br><span class="text-slate-500 font-mono">Reg: ${r.business_reg_no || '-'}</span></td>
          <td class="p-3 text-[11px]">${r.start_date} to<br>${r.end_date} (${r.period_months || 0} mo)</td>
          <td class="p-3 font-bold text-blue-700">RM ${Number(r.total_amount || 0).toFixed(2)}</td>
          <td class="p-3">
            <span class="px-2 py-1 rounded text-[10px] font-bold ${badgeColor}">
              ${formatStatus(status)}
            </span>
          </td>
          <td class="p-3">${srStatusHtml}</td>
          <td class="p-3 max-w-xs">${photoStatusHtml}</td>
          <td class="p-3 space-y-1">${actionButtonsHtml}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading masterlist dashboard:', err);
  }
}

// FULL PAGE REF NO SUMMARY VIEW
function showSummary(id) {
  currentSummaryReportId = Number(id);
  document.getElementById('filterFromMonth').value = '';
  document.getElementById('filterToMonth').value = '';
  document.getElementById('appScreen').classList.add('hidden');
  document.getElementById('detailScreen').classList.remove('hidden');
  window.scrollTo(0, 0);
  renderSummaryByMonth();
}

function backToDashboard() {
  document.getElementById('detailScreen').classList.add('hidden');
  document.getElementById('appScreen').classList.remove('hidden');
}

function resetSummaryMonthFilter() {
  document.getElementById('filterFromMonth').value = '';
  document.getElementById('filterToMonth').value = '';
  renderSummaryByMonth();
}

function renderSummaryByMonth() {
  const clickedReport = cachedReports.find(x => Number(x.report_id || x.id) === Number(currentSummaryReportId));
  if (!clickedReport) return;

  const refNo = clickedReport.sr_ref_no || clickedReport.ref_no;
  const totalAmount = Number(clickedReport.total_amount || clickedReport.amount_paid || 0);
  const materialName = clickedReport.material_details || clickedReport.material || 'Standard POSM';

  const fromMonth = document.getElementById('filterFromMonth').value;
  const toMonth = document.getElementById('filterToMonth').value;

  const allClinicReports = cachedReports.filter(x => (x.sr_ref_no || x.ref_no) === refNo);

  const filteredReports = allClinicReports.filter(rep => {
    const repStartMonth = (rep.start_date || '').slice(0, 7);
    const repEndMonth = (rep.end_date || '').slice(0, 7);
    if (fromMonth && repEndMonth < fromMonth) return false;
    if (toMonth && repStartMonth > toMonth) return false;
    return true;
  });

  const filteredTotalPaid = filteredReports.reduce((sum, item) => sum + Number(item.total_amount || item.amount_paid || 0), 0);
  const allMaterials = [...new Set(filteredReports.map(item => item.material_details || item.material))].join(' | ') || materialName;

  document.getElementById('pageRefTitle').innerText = `REF No: ${refNo} (${clickedReport.clinic_name})`;
  document.getElementById('pageRefStatus').innerText = `Showing ${filteredReports.length} Record(s) | Latest Status: ${formatStatus(clickedReport.approval_status)}`;
  
  const formatOpts = { year: 'numeric', month: 'short', day: 'numeric' };
  const formatDuration = (start, end) => {
    if (!start || !end) return '-';
    const s = new Date(start).toLocaleDateString('en-MY', formatOpts);
    const e = new Date(end).toLocaleDateString('en-MY', formatOpts);
    return `${s} — ${e}`;
  };

  document.getElementById('pageSummaryDetails').innerHTML = `
    <div class="p-3 bg-slate-50 rounded-lg">
      <p class="text-xs text-slate-500">Clinic Name</p>
      <p class="font-bold text-base">${clickedReport.clinic_name}</p>
    </div>
    <div class="p-3 bg-slate-50 rounded-lg">
      <p class="text-xs text-slate-500">REF No</p>
      <p class="font-bold text-base text-blue-600">${refNo}</p>
    </div>
    <div class="p-3 bg-slate-50 rounded-lg">
      <p class="text-xs text-slate-500">Duration Period</p>
      <p class="font-semibold">${formatDuration(clickedReport.start_date, clickedReport.end_date)}</p>
    </div>
    <div class="p-3 bg-slate-50 rounded-lg">
      <p class="text-xs text-slate-500">Total Amount</p>
      <p class="font-bold text-emerald-700 text-base">RM ${filteredTotalPaid.toFixed(2)}</p>
    </div>
    <div class="p-3 bg-slate-50 rounded-lg md:col-span-2">
      <p class="text-xs text-slate-500">Sales Material Placed</p>
      <p class="font-semibold">${allMaterials}</p>
    </div>
    <div class="p-3 bg-slate-50 rounded-lg">
      <p class="text-xs text-slate-500">Person In Charge (PIC)</p>
      <p class="font-semibold">${clickedReport.pic_name || '-'}</p>
    </div>
    <div class="p-3 bg-slate-50 rounded-lg">
      <p class="text-xs text-slate-500">Sales Executive (NE)</p>
      <p class="font-semibold">${clickedReport.ne_name || clickedReport.creator_name || '-'}</p>
    </div>
  `;

  // Inside openSummary() or wherever report details are rendered in public/app.js:
  const actionContainer = document.getElementById('pageActionButtons');
  if (actionContainer) {
    if (report.approval_status === 'APPROVED_CLOSED') {
      actionContainer.innerHTML = `
        <button type="button" onclick="window.location.href='/booking.html?id=${report.id}'" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-4 py-2 rounded-lg shadow transition cursor-pointer">
          🖨️ Generate Space Rental Booking PDF
        </button>
      `;
    } else {
      actionContainer.innerHTML = `
        <span class="text-xs text-amber-600 bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-200 font-semibold">
          ⏳ PDF Generation Locked until Director Approval (APPROVED_CLOSED)
        </span>
      `;
    }
  }

const photosContainer = document.getElementById('pagePhotosContainer');
  const photos = targetReport.photos || [];

  if (photos.length === 0) {
    photosContainer.innerHTML = `
      <div class="col-span-2 text-center py-8 text-slate-400 text-sm border-2 border-dashed rounded-xl">
        No documents or photos uploaded for <b>${refNo}</b> yet. Use 'Upload Document', 'Submit Agreement', or 'Upload Monthly Proof' from the dashboard to add photos.
      </div>
    `;
    return;
  }

  photosContainer.innerHTML = `
    <div class="col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
      ${photos.map((p, idx) => `
        <div class="border rounded-xl overflow-hidden shadow-sm bg-white space-y-2 p-3">
          <div class="flex justify-between items-center text-xs bg-slate-800 text-white px-3 py-2 rounded-lg">
            <span><b>📁 ${p.doc_type || 'Supporting Document'}</b></span>
            <span class="text-emerald-300">${p.compressed_size_kb || 0} KB</span>
          </div>
          <div class="border rounded-lg overflow-hidden bg-slate-100 flex justify-center p-2">
            <img src="${p.file_path}" alt="Document Scan" class="max-h-64 object-contain" />
          </div>
          <div class="text-right">
            <a href="${p.file_path}" target="_blank" class="text-xs bg-slate-700 hover:bg-slate-800 text-white px-3 py-1.5 rounded font-semibold inline-block">
              🔍 Open Full Image
            </a>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// EDIT REJECTED REPORT
function openEditModal(id) {
  const r = cachedReports.find(x => Number(x.id) === Number(id));
  if (!r) return;
  document.getElementById('editModalTitle').innerText = `Edit Rejected: ${r.ref_no}`;
  document.getElementById('editRejectReason').innerHTML = `<b>Rejected Reason:</b> ${r.remarks || 'No remark provided'}`;
  document.getElementById('edit_report_id').value = r.id;
  document.getElementById('edit_clinic_name').value = r.clinic_name;
  document.getElementById('edit_pic_name').value = r.pic_name;
  document.getElementById('edit_material').value = r.material;
  document.getElementById('edit_start_date').value = r.start_date;
  document.getElementById('edit_end_date').value = r.end_date;
  document.getElementById('edit_amount_paid').value = r.amount_paid;
  document.getElementById('editModal').classList.remove('hidden');
}

function closeEditModal() {
  document.getElementById('editModal').classList.add('hidden');
}

async function submitEditReportForm(e) {
  e.preventDefault();
  const reportId = document.getElementById('edit_report_id').value;
  const formData = new FormData(e.target);
  formData.append('replace_photos', document.getElementById('edit_replace_photos').checked ? 'true' : 'false');

  const res = await fetch(`/api/reports/${reportId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: formData
  });
  const data = await res.json();
  if (!res.ok) return alert(data.error);

  alert(data.message);
  closeEditModal();
  loadReports();
}

// APPROVE / REJECT REPORT
async function updateApproval(id, action, remarks = '') {
  try {
    const res = await fetch(`/api/reports/${id}/approval`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, remarks })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to update approval status.');
      return;
    }
    alert(data.message || 'Status updated successfully!');
    await loadReports();
  } catch (err) {
    console.error('Approval update failed:', err);
    alert('Error connecting to server: ' + err.message);
  }
}

function openRejectModal(id) {
  const modal = document.getElementById('rejectModal');
  const idInput = document.getElementById('reject_report_id');
  const remarksInput = document.getElementById('reject_remarks');

  if (!modal || !idInput || !remarksInput) {
    // Fallback to prompt if modal elements are missing
    const promptRemarks = prompt('Please enter rejection remarks / reason:');
    if (promptRemarks === null) return;
    if (!promptRemarks.trim()) {
      alert('Rejection remarks are required.');
      return;
    }
    return updateApproval(id, 'REJECT', promptRemarks.trim());
  }

  idInput.value = id;
  remarksInput.value = '';
  modal.classList.remove('hidden');
}

function closeRejectModal() {
  const modal = document.getElementById('rejectModal');
  if (modal) modal.classList.add('hidden');
}

async function submitRejectForm(e) {
  e.preventDefault();
  const id = document.getElementById('reject_report_id').value;
  const remarks = document.getElementById('reject_remarks').value;

  if (!remarks || !remarks.trim()) {
    alert('Please enter a rejection reason.');
    return;
  }

  await updateApproval(id, 'REJECT', remarks.trim());
  closeRejectModal();
}

// USER MANAGEMENT
async function loadMetadataAndUsers() {
  const metaRes = await fetch('/api/metadata/zones-teams', { headers: { Authorization: `Bearer ${token}` } });
  if (metaRes.ok) {
    const meta = await metaRes.json();
    allMetadataZones = meta.zones || [];
    allMetadataTeams = meta.teams || [];

    document.getElementById('modal_zone_id').innerHTML = '<option value="">-- No Zone --</option>' + 
      allMetadataZones.map(z => `<option value="${z.id}">${z.name}</option>`).join('');
    document.getElementById('modal_team_id').innerHTML = '<option value="">-- No Team --</option>' + 
      allMetadataTeams.map(t => `<option value="${t.id}">${t.name}</option>`).join('');

    document.getElementById('newTeamZoneId').innerHTML = '<option value="">Select Zone...</option>' + 
      allMetadataZones.map(z => `<option value="${z.id}">${z.name}</option>`).join('');
  }
  loadUsersTable();
}

async function loadUsersTable() {
  const res = await fetch('/api/users', { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return;
  cachedUsersList = await res.json();
  const tbody = document.getElementById('userTableBody');

  tbody.innerHTML = cachedUsersList.map(u => {
    const isAdminViewingSuperAdmin = currentUser.role === 'ADMIN' && u.role === 'SUPER_ADMIN';

    const actionButtonsHtml = isAdminViewingSuperAdmin 
      ? `<span class="text-[10px] text-slate-400 italic">Protected</span>`
      : `
        <button type="button" onclick="openUserModal('edit', ${u.id})" class="bg-amber-500 hover:bg-amber-600 text-white px-2 py-1 rounded text-[10px] font-semibold cursor-pointer">Edit</button>
        <button type="button" onclick="toggleUserStatus(${u.id}, '${u.status}')" class="${u.status === 'ACTIVE' ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'} text-white px-2 py-1 rounded text-[10px] font-semibold cursor-pointer">
          ${u.status === 'ACTIVE' ? 'Disable' : 'Enable'}
        </button>
      `;

    return `
      <tr class="border-b">
        <td class="p-2"><b>${u.full_name}</b><br><span class="text-slate-500">@${u.username}</span></td>
        <td class="p-2">${u.role}</td>
        <td class="p-2">
          <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold ${u.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}">${u.status}</span>
        </td>
        <td class="p-2 space-x-1 whitespace-nowrap">
          ${actionButtonsHtml}
        </td>
      </tr>
    `;
  }).join('');
}

function openUserModal(mode, userId = null) {
  document.getElementById('userModal').classList.remove('hidden');

  const roleSelect = document.getElementById('modal_role');
  if (currentUser.role === 'ADMIN') {
    roleSelect.innerHTML = `
      <option value="TIER_4">Tier 4: Sales</option>
      <option value="TIER_3">Tier 3: Sales Leader</option>
      <option value="TIER_2">Tier 2: Sales Manager</option>
      <option value="TIER_1">Tier 1: Sales Director</option>
      <option value="ADMIN">Admin</option>
    `;
  } else {
    roleSelect.innerHTML = `
      <option value="TIER_4">Tier 4: Sales</option>
      <option value="TIER_3">Tier 3: Sales Leader</option>
      <option value="TIER_2">Tier 2: Sales Manager</option>
      <option value="TIER_1">Tier 1: Sales Director</option>
      <option value="ADMIN">Admin</option>
      <option value="SUPER_ADMIN">Super Admin</option>
    `;
  }

  document.getElementById('modal_zone_id').innerHTML = '<option value="">-- No Zone --</option>' + 
    allMetadataZones.map(z => `<option value="${z.id}">${z.name}</option>`).join('');

  if (mode === 'add') {
    document.getElementById('userModalTitle').innerText = 'Add New User';
    document.getElementById('modal_user_id').value = '';
    document.getElementById('modal_username').value = '';
    document.getElementById('modal_username').disabled = false;
    document.getElementById('modal_fullname').value = '';
    document.getElementById('modal_password').value = '';
    roleSelect.value = 'TIER_4';
    handleRoleChange();
    document.getElementById('modal_zone_id').value = '';
    document.getElementById('modal_team_id').innerHTML = '<option value="">-- Select Zone First --</option>';
  } else {
    const u = cachedUsersList.find(x => Number(x.id) === Number(userId));
    if (!u) return;
    document.getElementById('userModalTitle').innerText = `Edit User: ${u.username}`;
    document.getElementById('modal_user_id').value = u.id;
    document.getElementById('modal_username').value = u.username;
    document.getElementById('modal_username').disabled = true;
    document.getElementById('modal_fullname').value = u.full_name;
    document.getElementById('modal_password').value = '';
    roleSelect.value = u.role;
    handleRoleChange();
    
    document.getElementById('modal_zone_id').value = u.zone_id || '';
    filterTeamsByZone();
    document.getElementById('modal_team_id').value = u.team_id || '';
  }
}

function closeUserModal() {
  document.getElementById('userModal').classList.add('hidden');
}

async function saveUser(e) {
  e.preventDefault();
  const userId = document.getElementById('modal_user_id').value;
  const payload = {
    username: document.getElementById('modal_username').value,
    full_name: document.getElementById('modal_fullname').value,
    password: document.getElementById('modal_password').value,
    role: document.getElementById('modal_role').value,
    zone_id: document.getElementById('modal_zone_id').value || null,
    team_id: document.getElementById('modal_team_id').value || null
  };

  const url = userId ? `/api/users/${userId}` : '/api/users';
  const method = userId ? 'PUT' : 'POST';

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) return alert(data.error);

  alert(data.message);
  closeUserModal();
  loadUsersTable();
  if (currentUser.role === 'SUPER_ADMIN') loadUsersForMigration();
}

async function toggleUserStatus(userId, currentStatus) {
  const newStatus = currentStatus === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
  if (!confirm(`Are you sure you want to set this user to ${newStatus}?`)) return;

  const res = await fetch(`/api/users/${userId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ status: newStatus })
  });
  const data = await res.json();
  if (!res.ok) return alert(data.error);
  loadUsersTable();
}

async function importUsersCsv(e) {
  e.preventDefault();
  const fileInput = document.getElementById('csvFile');
  if (!fileInput.files[0]) return alert('Please select a file.');

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);

  const res = await fetch('/api/users/import-csv', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData
  });
  const data = await res.json();
  if (!res.ok) return alert(data.error);

  alert(data.message);
  fileInput.value = '';
  loadUsersTable();
  loadUsersForMigration();
}

async function addZone(e) {
  e.preventDefault();
  const name = document.getElementById('newZoneName').value;
  const res = await fetch('/api/zones', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name })
  });
  const data = await res.json();
  if (!res.ok) return alert(data.error);

  alert(data.message);
  document.getElementById('newZoneName').value = '';
  loadMetadataAndUsers();
}

async function addTeam(e) {
  e.preventDefault();
  const name = document.getElementById('newTeamName').value;
  const zone_id = document.getElementById('newTeamZoneId').value;
  const res = await fetch('/api/teams', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, zone_id })
  });
  const data = await res.json();
  if (!res.ok) return alert(data.error);

  alert(data.message);
  document.getElementById('newTeamName').value = '';
  loadMetadataAndUsers();
}

function filterTeamsByZone() {
  const selectedZoneId = document.getElementById('modal_zone_id').value;
  const teamSelect = document.getElementById('modal_team_id');

  if (!selectedZoneId) {
    teamSelect.innerHTML = '<option value="">-- Select Zone First --</option>';
    return;
  }

  const zoneTeams = allMetadataTeams.filter(t => Number(t.zone_id) === Number(selectedZoneId));
  teamSelect.innerHTML = '<option value="">-- No Team --</option>' + 
    zoneTeams.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
}

function handleRoleChange() {
  const selectedRole = document.getElementById('modal_role').value;
  const zoneWrapper = document.getElementById('zoneFieldWrapper');
  const teamWrapper = document.getElementById('teamFieldWrapper');
  const zoneSelect = document.getElementById('modal_zone_id');
  const teamSelect = document.getElementById('modal_team_id');

  if (selectedRole === 'TIER_2') {
    zoneWrapper.style.display = 'block';
    teamWrapper.style.display = 'none';
    zoneSelect.required = true;
    teamSelect.required = false;
    teamSelect.value = '';
  } else if (selectedRole === 'TIER_3' || selectedRole === 'TIER_4') {
    zoneWrapper.style.display = 'block';
    teamWrapper.style.display = 'block';
    zoneSelect.required = true;
    teamSelect.required = true;
  } else {
    zoneWrapper.style.display = 'none';
    teamWrapper.style.display = 'none';
    zoneSelect.required = false;
    teamSelect.required = false;
    zoneSelect.value = '';
    teamSelect.value = '';
  }
}

async function loadUsersForMigration() {
  const res = await fetch('/api/users', { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return;
  const users = await res.json();
  const opts = users.map(u => `<option value="${u.id}">${u.full_name} (${u.username})</option>`).join('');
  document.getElementById('fromUser').innerHTML = opts;
  document.getElementById('toUser').innerHTML = opts;
}

async function migrateRecords() {
  const fromUserId = document.getElementById('fromUser').value;
  const toUserId = document.getElementById('toUser').value;
  const res = await fetch('/api/users/migrate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fromUserId, toUserId })
  });
  const data = await res.json();
  if (!res.ok) return alert(data.error);
  alert(data.message);
  loadReports();
}

// INVOICE & LETTER HELPERS
async function openInvoiceModal(reportId) {
  try {
    const res = await fetch(`/api/reports/${reportId}/invoice-data`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      const errData = await res.json();
      alert(errData.error || 'Failed to load invoice data');
      return;
    }
    const report = await res.json();

    // Populate Booking Template Fields
    document.getElementById('invRefNo').innerText = report.ref_no || '-';
    document.getElementById('invDate').innerText = new Date(report.created_at || Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    document.getElementById('invClinicName').innerText = report.clinic_name || '-';
    document.getElementById('invAddress').innerText = report.address || '-';
    document.getElementById('invCompanyName').innerText = report.company_name || report.clinic_name || '-';
    document.getElementById('invRegNo').innerText = report.reg_no || '-';
    document.getElementById('invPicName').innerText = report.pic_name || '-';
    
    const amount = Number(report.amount_paid || 0);
    const formattedAmount = `RM ${amount.toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
    document.getElementById('invRentalFeeText').innerHTML = `The agreed fee payable on a lump sum basis for provision of the space shall be<br><b>Ringgit Malaysia (${formattedAmount})</b>`;

    document.getElementById('invPayee').innerText = report.payee || 'Genesis Adun Sdn Bhd';
    document.getElementById('invBankAcc').innerText = report.bank_acc || '-';
    document.getElementById('invBankName').innerText = report.bank_name || 'Maybank';
    document.getElementById('invSpace').innerText = report.space || 'Consultation Suite';

    // Appendix Table 1 calculations & dates
    document.getElementById('invMatHeader').innerText = report.material || 'Poster Small';
    document.getElementById('invStartDate').innerText = report.start_date || '-';
    document.getElementById('invEndDate').innerText = report.end_date || '-';
    
    // Estimate months if not stored directly
    const months = 2; // Default or calculated from dates
    const monthlyRate = amount / months;
    const formattedRate = `RM ${monthlyRate.toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
    
    document.getElementById('invUnitRateHeader').innerText = formattedRate;
    document.getElementById('invMonthlySubtotal').innerText = formattedRate;
    document.getElementById('invDurationMonths').innerText = months;
    document.getElementById('invGrandTotalCol').innerText = formattedAmount;
    document.getElementById('invTotalAmountFoot').innerText = formattedAmount;

    // Signatures
    document.getElementById('invSignDirector').innerText = report.director_name || 'David (Sales Director - T1)';
    document.getElementById('invAckClinic').innerText = report.clinic_name || '-';
    document.getElementById('invAckBehalf').innerText = report.company_name || report.clinic_name || '-';
    document.getElementById('invAckPic').innerText = report.pic_name || '-';

    document.getElementById('invoiceModal').classList.remove('hidden');
  } catch (err) {
    console.error('Invoice modal error:', err);
    alert('Failed to load invoice preview');
  }
}

function closeInvoiceModal() {
  const modal = document.getElementById('invoiceModal');
  if (modal) modal.classList.add('hidden');
}

function handleInvoiceModalBackdrop(e) {
  if (e.target && e.target.id === 'invoiceModal') {
    closeInvoiceModal();
  }
}

function printInvoiceDocument() {
  const printContent = document.getElementById('invoicePrintArea');
  if (!printContent) return;

  let printFrame = document.getElementById('print_frame');
  if (printFrame) {
    document.body.removeChild(printFrame);
  }
  printFrame = document.createElement('iframe');
  printFrame.id = 'print_frame';
  printFrame.style.position = 'fixed';
  printFrame.style.right = '0';
  printFrame.style.bottom = '0';
  printFrame.style.width = '0';
  printFrame.style.height = '0';
  printFrame.style.border = '0';
  document.body.appendChild(printFrame);

  const frameDoc = printFrame.contentWindow || printFrame.contentDocument.document || printFrame.contentDocument;
  
  frameDoc.document.open();
  frameDoc.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Official Invoice & Authorization Letter</title>
      <style>
        @page {
          size: A4 portrait;
          margin: 10mm 15mm 10mm 15mm;
        }
        * {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          box-sizing: border-box !important;
        }
        body {
          font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          margin: 0;
          padding: 0;
          color: #1e293b;
          background: #fff;
        }
      </style>
    </head>
    <body>
      ${printContent.innerHTML}
    </body>
    </html>
  `);
  frameDoc.document.close();

  setTimeout(() => {
    printFrame.contentWindow.focus();
    printFrame.contentWindow.print();
  }, 250);
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeInvoiceModal();
  }
});

let globalMaterials = [];
let cachedMasterRecords = [];

async function loadMaterialsForModal() {
  try {
    const res = await fetch('/api/materials', { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      globalMaterials = await res.json();
      renderMaterialInputs();
    }
  } catch (err) {
    console.error('Failed to load materials:', err);
  }
}

async function loadAppendixDropdowns() {
  try {
    // 1. Fetch Zones for Region dropdown
    const zoneRes = await fetch('/api/metadata/zones-teams', { headers: { Authorization: `Bearer ${token}` } });
    if (zoneRes.ok) {
      const meta = await zoneRes.json();
      const regionSelect = document.getElementById('appendix_region');
      if (regionSelect) {
        regionSelect.innerHTML = `<option value="">-- Select Region / Zone --</option>` + 
          (meta.zones || []).map(z => `<option value="${z.name}">${z.name}</option>`).join('');
      }
    }

    // 2. Fetch Users and filter Tier 4 (Sales) for NE dropdown
    const userRes = await fetch('/api/users', { headers: { Authorization: `Bearer ${token}` } });
    if (userRes.ok) {
      const users = await userRes.json();
      const tier4Users = users.filter(u => u.role === 'TIER_4' && u.status === 'ACTIVE');
      const neSelect = document.getElementById('appendix_ne_name');
      if (neSelect) {
        neSelect.innerHTML = `<option value="">-- Select Sales Executive (Tier 4) --</option>` + 
          tier4Users.map(u => `<option value="${u.full_name}">${u.full_name} (@${u.username})</option>`).join('');
      }
    }
  } catch (err) {
    console.error('Failed to load appendix dropdown metadata:', err);
  }
}

function populateFromAppendix(appendixId) {
  if (!appendixId) return;
  const item = cachedAppendixList.find(a => String(a.id) === String(appendixId));
  if (!item) return;

  document.getElementById('clinic_name').value = item.health_care_institution || '';
  document.getElementById('payee_name').value = item.payee_details || '';
  document.getElementById('ne_name').value = item.ne_name || currentUser.full_name;
  document.getElementById('region').value = item.region || 'CREC';
  
  // Auto-populate PIC from the specific appendix entry
  const picField = document.getElementById('pic_name');
  if (picField) picField.value = item.pic_name || '';

  // Link the SR Ref No directly to the Appendix reference
  if (item.ref_no) {
    document.getElementById('sr_ref_no').value = `SR-${item.ref_no}`;
  }
}

function renderMaterialInputs(selectedQtys = {}) {
  const container = document.getElementById('materialInputsContainer');
  if (!container) return;
  container.innerHTML = globalMaterials.map(m => {
    const qty = selectedQtys[m.material_name] || 0;
    return `
      <div class="bg-white p-2 rounded border flex flex-col justify-between">
        <span class="font-semibold text-[11px] truncate" title="${m.material_name}">${m.material_name}</span>
        <div class="flex items-center justify-between mt-1">
          <span class="text-[10px] text-slate-400">RM ${m.unit_price}</span>
          <input type="number" min="0" value="${qty}" data-mat="${m.material_name}" data-price="${m.unit_price}" oninput="calculateMasterTotal()" class="mat-qty-input w-14 border p-1 rounded text-center text-xs" />
        </div>
      </div>
    `;
  }).join('');
  calculateMasterTotal();
}

function calculateMasterTotal() {
  let total = 0;
  const inputs = document.querySelectorAll('.mat-qty-input');
  inputs.forEach(input => {
    const qty = Number(input.value || 0);
    const price = Number(input.getAttribute('data-price') || 0);
    total += qty * price;
  });
  const displayEl = document.getElementById('displayTotalAmount');
  const inputEl = document.getElementById('total_amount');
  if (displayEl) displayEl.innerText = total.toFixed(2);
  if (inputEl) inputEl.value = total.toFixed(2);
}

let cachedAppendixList = [];

async function loadAppendixIntoModal() {
  try {
    const res = await fetch('/api/appendix', { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      cachedAppendixList = await res.json();
      const selectEl = document.getElementById('appendixSelector');
      if (selectEl) {
        selectEl.innerHTML = `<option value="">-- Choose from Clinic Appendix List (or type manually below) --</option>` + 
          cachedAppendixList.map(a => `<option value="${a.id}">${a.health_care_institution} (PIC: ${a.pic_name || 'N/A'} - Ref: ${a.ref_no})</option>`).join('');
      }
    }
  } catch (err) {
    console.error('Failed to load appendix list for modal:', err);
  }
}

// Auto-calculate months when start or end date changes
function calculateDurationMonths() {
  const startInput = document.getElementById('start_date');
  const endInput = document.getElementById('end_date');
  const periodInput = document.getElementById('period_months');

  if (startInput && endInput && startInput.value && endInput.value) {
    const start = new Date(startInput.value);
    const end = new Date(endInput.value);
    
    let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
    if (end.getDate() >= start.getDate()) months += 1;
    
    if (months > 0 && periodInput) {
      periodInput.value = months;
    }
  }
}

async function openMasterModal(mode, id = null) {
  await loadMaterialsForModal();
  await loadAppendixIntoModal();
  
  const modal = document.getElementById('masterModal');
  const form = document.getElementById('masterForm');
  
  // 1. ALWAYS reset form fields first
  if (form) form.reset();
  
  const editIdField = document.getElementById('edit_record_id');
  if (editIdField) editIdField.value = '';

  if (mode === 'edit' && id) {
    const record = cachedReports.find(r => r.id === id);
    if (record) {
      const isRejected = (record.approval_status || '').trim() === 'REJECTED';
      document.getElementById('modalTitle').innerText = isRejected 
        ? `Edit & Resubmit Rejected SR: ${record.sr_ref_no || record.ref_no}` 
        : 'Edit Masterlist SR Request';

      editIdField.value = record.id;
      document.getElementById('sr_ref_no').value = record.sr_ref_no || record.ref_no;
      document.getElementById('region').value = record.region || 'CREC';
      document.getElementById('ne_name').value = record.ne_name || currentUser.full_name;
      document.getElementById('clinic_name').value = record.clinic_name || '';
      document.getElementById('payee_name').value = record.payee_name || record.company_name || '';
      document.getElementById('business_reg_no').value = record.business_reg_no || record.reg_no || '';
      document.getElementById('hci_address').value = record.hci_address || record.address || '';
      document.getElementById('payee_bank_name').value = record.payee_bank_name || record.bank_name || 'Maybank';
      document.getElementById('payee_acc_no').value = record.payee_acc_no || record.bank_acc || '';
      document.getElementById('pic_name').value = record.pic_name || '';
      document.getElementById('placement_location').value = record.placement_location || record.space || 'Consultation Suite';
      document.getElementById('period_months').value = record.period_months || 3;
      document.getElementById('start_date').value = record.start_date || new Date().toISOString().slice(0, 10);
      document.getElementById('end_date').value = record.end_date || new Date().toISOString().slice(0, 10);

      let parsedQtys = {};
      try { parsedQtys = JSON.parse(record.materials_json || '{}'); } catch(e){}
      renderMaterialInputs(parsedQtys);

      // Change button text dynamically
      const saveBtn = document.getElementById('saveMasterBtn');
      if (saveBtn) {
        saveBtn.innerText = isRejected ? 'Resubmit for Approval' : 'Save Masterlist Record';
      }
    }
  } else {
    // Brand new SR request mode
    const currentYear = new Date().getFullYear();
    document.getElementById('modalTitle').innerText = 'Create New SR Request in Masterlist';
    
    // Dynamic year in Ref No
    document.getElementById('sr_ref_no').value = `SR-${currentYear}-${Math.floor(1000 + Math.random() * 9000)}`;
    document.getElementById('ne_name').value = currentUser.full_name;

    // Default Start Date & End Date to Today's Current Date
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const todayStr = `${year}-${month}-${day}`;

    document.getElementById('start_date').value = todayStr;
    document.getElementById('end_date').value = todayStr;

    // Duration (Months) starts at 0
    document.getElementById('period_months').value = 0;

    renderMaterialInputs({});
  }
  
  if (modal) modal.classList.remove('hidden');
}

function closeMasterModal() {
  const modal = document.getElementById('masterModal');
  if (modal) modal.classList.add('hidden');
}

async function submitMasterRecord(e) {
  e.preventDefault();
  
  const saveBtn = document.getElementById('saveMasterBtn');
  if (saveBtn) {
    if (saveBtn.disabled) return; // Prevent double execution
    saveBtn.disabled = true;
    saveBtn.innerText = 'Saving...';
  }

  const recordId = document.getElementById('edit_record_id').value;
  const formData = new FormData(e.target);
  const payload = Object.fromEntries(formData.entries());

  const materialsJson = {};
  const summaryArr = [];
  document.querySelectorAll('.mat-qty-input').forEach(input => {
    const qty = Number(input.value || 0);
    if (qty > 0) {
      const matName = input.getAttribute('data-mat');
      materialsJson[matName] = qty;
      summaryArr.push(`${matName} (Qty: ${qty})`);
    }
  });

  payload.materials_json = materialsJson;
  payload.material_details = summaryArr.join(', ') || 'Standard POSM';

  const method = recordId ? 'PUT' : 'POST';
  const endpoint = recordId ? `/api/masterlist/${recordId}` : '/api/masterlist';

  try {
    const res = await fetch(endpoint, {
      method: method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerText = 'Save Masterlist Record';
      }
      return alert(data.error || 'Failed to save record');
    }

    alert(data.message);
    closeMasterModal();
    loadReports();
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerText = 'Save Masterlist Record';
    }
  }
}

app.patch('/api/reports/:id/approval', auth, (req, res) => {
  const { action, remarks } = req.body;
  const reportId = req.params.id;
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId);
  if (!report) return res.status(404).json({ error: 'Report not found' });

  const userRole = (req.user.role || '').trim();
  const currentStatus = (report.approval_status || '').trim();

  if (!['SUPER_ADMIN', 'TIER_1', 'TIER_2', 'TIER_3'].includes(userRole)) {
    return res.status(403).json({ error: 'Sales (Tier 4) cannot approve or reject reports.' });
  }

  let nextStatus = currentStatus;
  let newRemarks = report.remarks || '';

  if (action === 'REJECT') {
    if (!remarks || !remarks.trim()) {
      return res.status(400).json({ error: 'Please enter a rejection remark.' });
    }
    nextStatus = 'REJECTED';
    newRemarks = remarks.trim();
  } else if (action === 'APPROVE') {
    if (userRole === 'TIER_3') {
      nextStatus = 'PENDING_T2';
      newRemarks = 'Approved by FOM (Tier 3 Leader)';
    } else if (userRole === 'TIER_2') {
      nextStatus = 'PENDING_T1';
      newRemarks = 'Approved by Admin Exec (Tier 2 Manager)';
    } else if (userRole === 'TIER_1' || userRole === 'SUPER_ADMIN') {
      nextStatus = 'APPROVED_CLOSED';
      newRemarks = 'Final Approved & Closed by Director (Tier 1)';
    }
  }

  // Update reports status
  db.prepare('UPDATE reports SET approval_status = ?, remarks = ? WHERE id = ?')
    .run(nextStatus, newRemarks, reportId);

  // Also sync status in masterlist_requests if linked by ref_no
  db.prepare('UPDATE masterlist_requests SET approval_status = ? WHERE sr_ref_no = ?')
    .run(nextStatus, report.ref_no);

  res.json({ message: `Success! Status is now ${nextStatus}`, nextStatus });
});

app.get('/api/reports/:id/invoice-data', auth, (req, res) => {
  const reportId = req.params.id;
  const report = db.prepare(`SELECT * FROM reports WHERE id = ?`).get(reportId);

  if (!report) return res.status(404).json({ error: 'Report not found' });

  // Enforce lock until final director approval
  if (report.approval_status !== 'APPROVED_CLOSED') {
    return res.status(400).json({ error: 'Booking PDF / Invoice is locked until final approval by Director (APPROVED_CLOSED).' });
  }

  res.json(report);
});

async function openDocUploadModal() {
  const modal = document.getElementById('docUploadModal');
  const selectEl = document.getElementById('doc_report_id');
  
  try {
    const res = await fetch('/api/masterlist', { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      const records = await res.json();
      selectEl.innerHTML = `<option value="">-- Choose Clinic / REF No --</option>` + 
        records.map(r => `<option value="${r.report_id || r.id}">${r.sr_ref_no} - ${r.clinic_name}</option>`).join('');
    }
  } catch (e) {
    console.error(e);
  }

  if (modal) modal.classList.remove('hidden');
}

function openDocumentsModal(reportId) {
  const record = cachedReports.find(r => Number(r.report_id || r.id) === Number(reportId));
  if (!record) return;

  const container = document.getElementById('docsModalContent');
  const photos = record.photos || [];

  if (photos.length === 0) {
    container.innerHTML = `<p class="text-center py-6 text-slate-400 text-xs italic">No documents attached to this record yet. Click 'Upload Document' in the header to add one.</p>`;
  } else {
    container.innerHTML = photos.map((p, idx) => `
      <div class="border rounded-xl p-4 bg-slate-50 space-y-2">
        <div class="flex justify-between items-center">
          <span class="bg-blue-100 text-blue-800 text-[11px] font-bold px-2.5 py-1 rounded">
            📁 ${p.doc_type || 'Supporting Document'}
          </span>
          <span class="text-[10px] text-slate-500">Compressed: ${p.compressed_size_kb || 0} KB</span>
        </div>
        <div class="bg-white border rounded-lg overflow-hidden p-2 flex justify-center">
          <img src="${p.file_path}" alt="Document Scan" class="max-h-72 object-contain" />
        </div>
        <div class="text-right">
          <a href="${p.file_path}" target="_blank" class="text-xs bg-slate-700 hover:bg-slate-800 text-white px-3 py-1.5 rounded font-semibold inline-block">
            🔍 Open Full Image in New Tab
          </a>
        </div>
      </div>
    `).join('');
  }

  document.getElementById('viewDocsModal').classList.remove('hidden');
}

function closeDocumentsModal() {
  document.getElementById('viewDocsModal').classList.add('hidden');
}

function closeDocUploadModal() {
  const modal = document.getElementById('docUploadModal');
  if (modal) modal.classList.add('hidden');
}

async function submitSupportingDocument(e) {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);
  const reportId = document.getElementById('doc_report_id').value;

  try {
    const res = await fetch(`/api/reports/${reportId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: formData
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error || 'Failed to upload document');

    alert('Supporting document uploaded and linked successfully!');
    closeDocUploadModal();
    form.reset();
    loadReports();
  } catch (err) {
    alert('Error uploading document: ' + err.message);
  }
}

async function openCompletionModal() {
  const modal = document.getElementById('completionModal');
  const selectEl = document.getElementById('comp_report_id');
  
  try {
    const res = await fetch('/api/masterlist', { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      const records = await res.json();
      selectEl.innerHTML = `<option value="">-- Choose Clinic / REF No --</option>` + 
        records.map(r => `<option value="${r.report_id || r.id}">${r.sr_ref_no} - ${r.clinic_name}</option>`).join('');
    }
  } catch (e) {
    console.error(e);
  }

  if (modal) modal.classList.remove('hidden');
}

function closeCompletionModal() {
  const modal = document.getElementById('completionModal');
  if (modal) modal.classList.add('hidden');
}

async function submitCompletionDocs(e) {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);
  const reportId = document.getElementById('comp_report_id').value;

  try {
    const res = await fetch(`/api/reports/${reportId}/completion-docs`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error || 'Failed to submit documents');

    alert('Signed Agreement and POSM photo submitted successfully!');
    closeCompletionModal();
    form.reset();
    loadReports();
  } catch (err) {
    alert('Error submitting documents: ' + err.message);
  }
}

async function openMonthlyProofModal() {
  const modal = document.getElementById('monthlyProofModal');
  const selectEl = document.getElementById('proof_report_id');
  
  try {
    const res = await fetch('/api/masterlist', { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      const records = await res.json();
      selectEl.innerHTML = `<option value="">-- Choose Clinic / REF No --</option>` + 
        records.map(r => `<option value="${r.report_id || r.id}">${r.sr_ref_no} - ${r.clinic_name}</option>`).join('');
    }
  } catch (e) {
    console.error(e);
  }

  if (modal) modal.classList.remove('hidden');
}

function closeMonthlyProofModal() {
  const modal = document.getElementById('monthlyProofModal');
  if (modal) modal.classList.add('hidden');
}

async function submitMonthlyProof(e) {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);
  const reportId = document.getElementById('proof_report_id').value;

  try {
    const res = await fetch(`/api/reports/${reportId}/monthly-proof`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error || 'Failed to upload monthly proof');

    alert('Monthly rental proof photo uploaded successfully!');
    closeMonthlyProofModal();
    form.reset();
    loadReports();
  } catch (err) {
    alert('Error uploading monthly proof: ' + err.message);
  }
}

function promptAndReject(id) {
  const remarks = prompt('Please enter rejection remarks / reason:');
  if (remarks === null) return; // User clicked Cancel
  if (!remarks.trim()) {
    alert('Rejection remarks are mandatory to reject a report.');
    return;
  }
  updateApproval(id, 'REJECT', remarks.trim());
}