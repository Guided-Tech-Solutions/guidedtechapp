/* ============================================================
   FILE: app/portal-dashboard.js
   Per-service analytics dashboard:
   - Lead Generation: leads count, table, live listener
   - Cloud Migration: progress bar, phase tracker, event log
   - Automations: run log, success/fail stats
   - SEO: domain authority, keywords, backlinks, organic traffic
   - Consultation: booking history
   - Generic: status widget
   ============================================================ */
import { db } from "./firebase.js";
import {
  authReady, currentUser, requireAuth,
  esc, fmtPrice, fmtDate, timeAgo, showToast
} from "./portal-layout.js";
import {
  collection, getDocs, query, where, orderBy, limit,
  onSnapshot, doc, getDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

/* ── State ────────────────────────────────────────────────── */
let activeSubscriptions = [];
let currentServiceTab   = null;
let unsubscribeListeners = [];

/* ── Init ─────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireAuth();
  if (!user) return;

  const name = user.displayName || user.email.split("@")[0];
  document.getElementById("welcomeTitle").textContent = `Welcome back, ${name} 👋`;
  document.getElementById("welcomeSubtitle").textContent = "Here's what's happening with your services";

  await loadDashboard(user);
});

/* ── Main load ────────────────────────────────────────────── */
async function loadDashboard(user) {
  try {
    // Load all active subscriptions
    const [svcSnap, planSnap] = await Promise.all([
      getDocs(query(collection(db, "serviceActivations"), where("userId", "==", user.uid), where("status", "==", "active"))),
      getDocs(query(collection(db, "userSubscriptions"),  where("userId", "==", user.uid), where("status", "==", "active")))
    ]);

    const svcActivations  = [];
    const planActivations = [];
    svcSnap.forEach(d  => svcActivations.push({ id: d.id, subscriptionType: "service", ...d.data() }));
    planSnap.forEach(d => planActivations.push({ id: d.id, subscriptionType: "plan",   ...d.data() }));

    activeSubscriptions = [...svcActivations, ...planActivations];

    // Enrich with service/plan metadata
    await enrichSubscriptions(activeSubscriptions);

    document.getElementById("dashboardLoading").style.display = "none";

    if (activeSubscriptions.length === 0) {
      document.getElementById("noServicesState").style.display = "block";
      updateStatsRow(0, 0, 0, 0);
      return;
    }

    document.getElementById("analyticsSection").style.display = "block";
    buildServiceTabs();
    await updateStatsRow(user.uid);

  } catch (e) {
    console.error("Dashboard load error", e);
    document.getElementById("dashboardLoading").innerHTML =
      `<div class="card"><div class="card-body"><div class="empty-state"><div class="empty-icon">⚠️</div>
       <h3 class="empty-title">Error Loading Dashboard</h3>
       <p class="empty-text">Please refresh the page.</p></div></div></div>`;
  }
}

async function enrichSubscriptions(subs) {
  await Promise.all(subs.map(async sub => {
    try {
      const collection_name = sub.subscriptionType === "plan" ? "plans" : "services";
      const ref = doc(db, collection_name, sub.serviceId || sub.planId);
      const snap = await getDoc(ref);
      if (snap.exists()) Object.assign(sub, snap.data());
    } catch (e) { /* silently skip */ }
  }));
}

/* ── Stats row ────────────────────────────────────────────── */
async function updateStatsRow(uid) {
  const count = activeSubscriptions.length;
  document.getElementById("statActiveServices").textContent = count;
  document.getElementById("statServiceChange").textContent  = `${count} service${count !== 1 ? "s" : ""} running`;

  // Calculate total spend
  let totalSpend = 0;
  activeSubscriptions.forEach(sub => { totalSpend += Number(sub.price) || 0; });
  document.getElementById("statSpend").textContent = fmtPrice(totalSpend);
  document.getElementById("statSpendChange").textContent = "Monthly total";

  // Try to get leads count
  try {
    let totalLeads = 0;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    for (const sub of activeSubscriptions) {
      const dashType = getDashboardType(sub);
      if (dashType === "lead_generation") {
        const key = `${uid}_${sub.serviceId}`;
        const snap = await getDocs(
          query(collection(db, "serviceData", key, "leads"),
                where("createdAt", ">=", monthStart))
        );
        totalLeads += snap.size;
      }
    }
    document.getElementById("statLeadsMonth").textContent = totalLeads;
    document.getElementById("statLeadsChange").textContent = "This month";
  } catch (e) {
    document.getElementById("statLeadsMonth").textContent = "—";
  }

  // Try to get automation runs
  try {
    let totalRuns = 0;
    for (const sub of activeSubscriptions) {
      const dashType = getDashboardType(sub);
      if (dashType === "automation") {
        const key = `${uid}_${sub.serviceId}`;
        const snap = await getDocs(
          query(collection(db, "serviceData", key, "automationRuns"),
                orderBy("createdAt", "desc"), limit(50))
        );
        totalRuns += snap.size;
      }
    }
    document.getElementById("statAutomations").textContent = totalRuns;
    document.getElementById("statAutomationsChange").textContent = "Total runs logged";
  } catch (e) {
    document.getElementById("statAutomations").textContent = "—";
  }
}

/* ── Service tabs ─────────────────────────────────────────── */
function buildServiceTabs() {
  const container = document.getElementById("serviceTabsContainer");
  const panels    = document.getElementById("dashboardPanels");

  container.innerHTML = "";
  panels.innerHTML    = "";

  activeSubscriptions.forEach((sub, i) => {
    const name      = sub.name || sub.planName || `Service ${i + 1}`;
    const icon      = sub.icon || "⚙️";
    const tabId     = `panel-${i}`;
    const dashType  = getDashboardType(sub);

    // Tab button
    const tabBtn = document.createElement("button");
    tabBtn.className = `analytics-service-tab${i === 0 ? " active" : ""}`;
    tabBtn.dataset.panel = tabId;
    tabBtn.dataset.dashType = dashType;
    tabBtn.innerHTML = `<span class="tab-icon">${icon}</span>${esc(name)}`;
    tabBtn.addEventListener("click", () => switchServiceTab(tabId, sub, currentUser));
    container.appendChild(tabBtn);

    // Panel placeholder
    const panel = document.createElement("div");
    panel.className = `service-dashboard-panel${i === 0 ? " active" : ""}`;
    panel.id = tabId;
    panel.innerHTML = `<div class="loading-state"><div class="spinner"></div></div>`;
    panels.appendChild(panel);
  });

  // Load the first panel
  if (activeSubscriptions.length > 0) {
    switchServiceTab(`panel-0`, activeSubscriptions[0], currentUser);
  }
}

function switchServiceTab(panelId, sub, user) {
  // Clear old listeners
  unsubscribeListeners.forEach(fn => fn());
  unsubscribeListeners = [];

  document.querySelectorAll(".analytics-service-tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".service-dashboard-panel").forEach(p => p.classList.remove("active"));

  document.querySelector(`[data-panel="${panelId}"]`)?.classList.add("active");
  const panel = document.getElementById(panelId);
  if (!panel) return;
  panel.classList.add("active");

  currentServiceTab = panelId;
  renderServicePanel(panel, sub, user);
}

/* ── Dashboard type inference ─────────────────────────────── */
function getDashboardType(sub) {
  if (sub.dashboardType) return sub.dashboardType;
  const name = (sub.name || "").toLowerCase();
  if (name.includes("lead"))        return "lead_generation";
  if (name.includes("cloud") || name.includes("migrat")) return "cloud_migration";
  if (name.includes("automat"))     return "automation";
  if (name.includes("seo"))         return "seo";
  if (name.includes("consult"))     return "consultation";
  return "generic";
}

/* ── Panel renderer (dispatcher) ────────────────────────────── */
function renderServicePanel(panel, sub, user) {
  const type = getDashboardType(sub);
  const key  = `${user.uid}_${sub.serviceId || sub.id}`;

  switch (type) {
    case "lead_generation":  renderLeadGenPanel(panel, sub, key, user.uid); break;
    case "cloud_migration":  renderMigrationPanel(panel, sub, key); break;
    case "automation":       renderAutomationPanel(panel, sub, key); break;
    case "seo":              renderSEOPanel(panel, sub, key); break;
    case "consultation":     renderConsultationPanel(panel, user.uid); break;
    default:                 renderGenericPanel(panel, sub); break;
  }
}

/* ══════════════════════════════════════════════════════════
   LEAD GENERATION DASHBOARD
══════════════════════════════════════════════════════════ */
function renderLeadGenPanel(panel, sub, key, uid) {
  panel.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">🎯 Lead Generation Dashboard</div>
          <div class="card-subtitle">${esc(sub.name || "Lead Generation")}</div>
        </div>
        <div style="display:flex;gap:.625rem;align-items:center">
          <button class="btn btn-ghost btn-sm" id="exportLeadsBtn">📥 Export CSV</button>
          <span class="badge badge-active" id="leadLiveIndicator">● Live</span>
        </div>
      </div>
      <div class="card-body">

        <!-- Lead stats mini-grid -->
        <div class="stats-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:1.25rem">
          <div class="stat-card">
            <div class="stat-label">Total Leads</div>
            <div class="stat-value" id="lgTotalLeads">—</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">This Month</div>
            <div class="stat-value" id="lgMonthLeads">—</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Hot Leads</div>
            <div class="stat-value" id="lgHotLeads" style="color:var(--danger)">—</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Conversion</div>
            <div class="stat-value" id="lgConversion">—%</div>
          </div>
        </div>

        <!-- Leads table -->
        <div class="card-title mb-md">Recent Leads</div>
        <div class="leads-table-wrap">
          <table class="leads-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Source</th>
                <th>Score</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody id="leadsTableBody">
              <tr><td colspan="6" style="text-align:center;padding:1.5rem;color:var(--text-faint)">
                <div class="spinner" style="margin:auto;width:24px;height:24px"></div>
              </td></tr>
            </tbody>
          </table>
        </div>

      </div>
    </div>
  `;

  // Live listener
  const leadsRef = collection(db, "serviceData", key, "leads");
  const q = query(leadsRef, orderBy("createdAt", "desc"), limit(50));

  const unsub = onSnapshot(q, snap => {
    const leads = [];
    snap.forEach(d => leads.push({ id: d.id, ...d.data() }));
    updateLeadsTable(leads);
    updateLeadStats(leads);
  }, e => console.error("Leads listener error", e));

  unsubscribeListeners.push(unsub);

  // Export
  panel.querySelector("#exportLeadsBtn")?.addEventListener("click", () => exportLeadsCSV(key));
}

function updateLeadsTable(leads) {
  const tbody = document.getElementById("leadsTableBody");
  if (!tbody) return;

  if (leads.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-faint)">
      No leads captured yet. Once your lead generation is active, leads will appear here in real time.
    </td></tr>`;
    return;
  }

  tbody.innerHTML = leads.map(lead => {
    const score = lead.score || "cold";
    return `<tr>
      <td><div class="lead-name">${esc(lead.name || "Unknown")}</div></td>
      <td>${esc(lead.email || "—")}</td>
      <td>${esc(lead.phone || "—")}</td>
      <td><div class="lead-source">${esc(lead.source || "website")}</div></td>
      <td><span class="lead-score ${score}">${score.toUpperCase()}</span></td>
      <td style="color:var(--text-muted);font-size:.75rem">${fmtDate(lead.createdAt)}</td>
    </tr>`;
  }).join("");
}

function updateLeadStats(leads) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthLeads = leads.filter(l => {
    const d = l.createdAt?.toDate?.() || new Date(l.createdAt);
    return d >= monthStart;
  });
  const hotLeads = leads.filter(l => l.score === "hot");
  const converted = leads.filter(l => l.status === "converted");

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set("lgTotalLeads",  leads.length);
  set("lgMonthLeads",  monthLeads.length);
  set("lgHotLeads",    hotLeads.length);
  set("lgConversion",  leads.length > 0 ? Math.round((converted.length / leads.length) * 100) + "%" : "0%");
}

async function exportLeadsCSV(key) {
  try {
    const snap = await getDocs(query(collection(db, "serviceData", key, "leads"), orderBy("createdAt", "desc")));
    const rows = [["Name", "Email", "Phone", "Source", "Score", "Status", "Date"]];
    snap.forEach(d => {
      const l = d.data();
      rows.push([l.name || "", l.email || "", l.phone || "", l.source || "", l.score || "", l.status || "", fmtDate(l.createdAt)]);
    });
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `leads_${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
    showToast({ title: "Export ready", message: "Leads exported to CSV.", type: "success" });
  } catch (e) {
    showToast({ title: "Export failed", type: "error" });
  }
}

/* ══════════════════════════════════════════════════════════
   CLOUD MIGRATION DASHBOARD
══════════════════════════════════════════════════════════ */
async function renderMigrationPanel(panel, sub, key) {
  panel.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">☁️ Cloud Migration Dashboard</div>
          <div class="card-subtitle">${esc(sub.name || "Cloud Migration")}</div>
        </div>
      </div>
      <div class="card-body">

        <!-- Overall progress -->
        <div style="margin-bottom:1.5rem">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem">
            <span style="font-weight:600;font-size:.9375rem">Overall Progress</span>
            <span style="font-family:var(--ff-display);font-weight:700;color:var(--brand)" id="migProgressPct">0%</span>
          </div>
          <div class="progress-bar-wrap" style="height:12px">
            <div class="progress-bar" id="migProgressBar" style="width:0%"></div>
          </div>
        </div>

        <!-- Storage stats -->
        <div class="stats-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:1.5rem">
          <div class="stat-card">
            <div class="stat-label">Data Migrated</div>
            <div class="stat-value sm" id="migDataMoved">—</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Files Moved</div>
            <div class="stat-value" id="migFilesMoved">—</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Est. Completion</div>
            <div class="stat-value sm" id="migETA">—</div>
          </div>
        </div>

        <!-- Phase tracker -->
        <div class="card-title mb-md">Migration Phases</div>
        <div id="migPhases">
          <div class="loading-state"><div class="spinner"></div></div>
        </div>

        <!-- Event log -->
        <div style="margin-top:1.5rem">
          <div class="card-title mb-md">Recent Events</div>
          <div id="migEventLog"></div>
        </div>

      </div>
    </div>
  `;

  try {
    // Load config for phase list
    const configRef = doc(db, "serviceConfigs", key);
    const configSnap = await getDoc(configRef);
    const config = configSnap.exists() ? configSnap.data() : {};

    // Load migration events
    const eventsSnap = await getDocs(
      query(collection(db, "serviceData", key, "migrationEvents"),
            orderBy("createdAt", "desc"), limit(20))
    );
    const events = [];
    eventsSnap.forEach(d => events.push({ id: d.id, ...d.data() }));

    // Render phases
    const phases = config.phases || [
      { name: "Assessment & Planning",        status: "done",        detail: "Completed" },
      { name: "Data Inventory",               status: "done",        detail: "All assets catalogued" },
      { name: "Test Migration",               status: "in-progress", detail: "Running validation" },
      { name: "Production Migration",         status: "pending",     detail: "Scheduled" },
      { name: "Validation & Cutover",         status: "pending",     detail: "Pending" },
    ];

    const doneCount = phases.filter(p => p.status === "done").length;
    const pct = Math.round((doneCount / phases.length) * 100);

    document.getElementById("migProgressPct").textContent = pct + "%";
    document.getElementById("migProgressBar").style.width = pct + "%";
    if (pct === 100) document.getElementById("migProgressBar").classList.add("success");

    document.getElementById("migPhases").innerHTML = phases.map(ph => `
      <div class="migration-phase">
        <div class="migration-phase-icon ${ph.status}">
          ${ph.status === "done" ? "✓" : ph.status === "in-progress" ? "⟳" : "○"}
        </div>
        <div class="migration-phase-info">
          <div class="migration-phase-name">${esc(ph.name)}</div>
          <div class="migration-phase-detail">${esc(ph.detail || "")}</div>
        </div>
        <span class="badge ${ph.status === "done" ? "badge-active" : ph.status === "in-progress" ? "badge-pending" : "badge-inactive"}">
          ${ph.status === "done" ? "Done" : ph.status === "in-progress" ? "In Progress" : "Pending"}
        </span>
      </div>`).join("");

    // Stats
    const lastEvent = events[0] || {};
    document.getElementById("migDataMoved").textContent  = lastEvent.dataMoved  || "Calculating";
    document.getElementById("migFilesMoved").textContent = lastEvent.filesMoved || "—";
    document.getElementById("migETA").textContent        = lastEvent.eta        || "TBD";

    // Event log
    document.getElementById("migEventLog").innerHTML = events.length === 0
      ? `<div class="empty-state" style="padding:1rem"><div class="empty-text">No events logged yet. Events will appear here as migration progresses.</div></div>`
      : events.map(e => `
          <div class="activity-item">
            <div class="activity-dot" style="background:${e.type === "error" ? "var(--danger)" : "var(--brand-light)"}"></div>
            <div class="activity-content">
              <div class="activity-text">${esc(e.message || e.event || "Event logged")}</div>
              <div class="activity-time">${timeAgo(e.createdAt)}</div>
            </div>
          </div>`).join("");
  } catch (e) {
    document.getElementById("migPhases").innerHTML =
      `<div class="empty-state"><p class="empty-text">Migration data loading. Check back soon.</p></div>`;
  }
}

/* ══════════════════════════════════════════════════════════
   AUTOMATION DASHBOARD
══════════════════════════════════════════════════════════ */
async function renderAutomationPanel(panel, sub, key) {
  panel.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">🤖 Automation Dashboard</div>
          <div class="card-subtitle">${esc(sub.name || "Automation Service")}</div>
        </div>
        <span class="badge badge-active" id="autoStatusBadge">Running</span>
      </div>
      <div class="card-body">

        <!-- Stats -->
        <div class="stats-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:1.5rem">
          <div class="stat-card">
            <div class="stat-label">Total Runs</div>
            <div class="stat-value" id="autoTotal">—</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Successful</div>
            <div class="stat-value" id="autoSuccess" style="color:var(--success)">—</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Failed</div>
            <div class="stat-value" id="autoFailed" style="color:var(--danger)">—</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Success Rate</div>
            <div class="stat-value" id="autoRate">—%</div>
          </div>
        </div>

        <!-- Run log -->
        <div class="card-title mb-md">Run History</div>
        <div id="autoRunLog">
          <div class="loading-state"><div class="spinner"></div></div>
        </div>

      </div>
    </div>
  `;

  try {
    const runsSnap = await getDocs(
      query(collection(db, "serviceData", key, "automationRuns"),
            orderBy("createdAt", "desc"), limit(30))
    );
    const runs = [];
    runsSnap.forEach(d => runs.push({ id: d.id, ...d.data() }));

    const total   = runs.length;
    const success = runs.filter(r => r.status === "success").length;
    const failed  = runs.filter(r => r.status === "failed").length;
    const rate    = total > 0 ? Math.round((success / total) * 100) : 0;

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set("autoTotal",   total);
    set("autoSuccess", success);
    set("autoFailed",  failed);
    set("autoRate",    rate + "%");

    document.getElementById("autoRunLog").innerHTML = runs.length === 0
      ? `<div class="empty-state" style="padding:1rem"><div class="empty-text">No runs logged yet. Automation runs will appear here as they execute.</div></div>`
      : runs.map(r => `
          <div class="run-row">
            <div class="run-dot ${r.status || "success"}"></div>
            <div style="flex:1">
              <div class="run-name">${esc(r.name || r.workflowName || "Automation Run")}</div>
              <div class="run-detail">${esc(r.trigger || r.detail || "")}</div>
            </div>
            <span class="badge ${r.status === "success" ? "badge-active" : r.status === "failed" ? "badge-danger" : "badge-pending"}">
              ${esc(r.status || "success")}
            </span>
            <div class="run-time">${timeAgo(r.createdAt)}</div>
          </div>`).join("");
  } catch (e) {
    document.getElementById("autoRunLog").innerHTML =
      `<div class="empty-state"><p class="empty-text">Automation data loading. Check back soon.</p></div>`;
  }
}

/* ══════════════════════════════════════════════════════════
   SEO DASHBOARD
══════════════════════════════════════════════════════════ */
async function renderSEOPanel(panel, sub, key) {
  panel.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">🔍 SEO Dashboard</div>
          <div class="card-subtitle">${esc(sub.name || "SEO Service")}</div>
        </div>
      </div>
      <div class="card-body">
        <!-- SEO metrics -->
        <div class="seo-metrics-grid" id="seoMetricsGrid">
          <div class="loading-state"><div class="spinner"></div></div>
        </div>
        <!-- Keyword table -->
        <div class="card-title mb-md">Top Keywords</div>
        <div class="leads-table-wrap">
          <table class="leads-table">
            <thead>
              <tr><th>Keyword</th><th>Position</th><th>Volume</th><th>Change</th></tr>
            </thead>
            <tbody id="seoKeywordsBody">
              <tr><td colspan="4" style="text-align:center;padding:1.5rem;color:var(--text-faint)">
                <div class="spinner" style="margin:auto;width:24px;height:24px"></div>
              </td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  try {
    const metricsSnap = await getDocs(
      query(collection(db, "serviceData", key, "seoMetrics"),
            orderBy("createdAt", "desc"), limit(1))
    );
    const latest = metricsSnap.empty ? {} : metricsSnap.docs[0].data();

    document.getElementById("seoMetricsGrid").innerHTML = [
      { label: "Domain Authority", value: latest.domainAuthority || "—",    change: "+2",  up: true },
      { label: "Organic Visitors", value: latest.organicVisitors || "—",    change: "+14%", up: true },
      { label: "Keywords Ranked",  value: latest.keywordsRanked  || "—",    change: "+5",  up: true },
      { label: "Backlinks",        value: latest.backlinks        || "—",    change: "+8",  up: true },
      { label: "Page Speed",       value: latest.pageSpeed ? latest.pageSpeed + "/100" : "—", change: "", up: true },
      { label: "Core Web Vitals",  value: latest.coreWebVitals    || "Pass", change: "",    up: true },
    ].map(m => `
      <div class="seo-metric-card">
        <div class="seo-metric-value">${esc(String(m.value))}</div>
        <div class="seo-metric-label">${m.label}</div>
        ${m.change ? `<div class="seo-metric-change ${m.up ? "up" : "down"}">${m.up ? "↑" : "↓"} ${m.change}</div>` : ""}
      </div>`).join("");

    // Keywords
    const kwSnap = await getDocs(
      query(collection(db, "serviceData", key, "keywords"),
            orderBy("position", "asc"), limit(15))
    );
    const kws = [];
    kwSnap.forEach(d => kws.push({ id: d.id, ...d.data() }));

    document.getElementById("seoKeywordsBody").innerHTML = kws.length === 0
      ? `<tr><td colspan="4" style="text-align:center;padding:2rem;color:var(--text-faint)">No keyword data yet. SEO tracking will populate here.</td></tr>`
      : kws.map(k => `<tr>
          <td style="font-weight:600">${esc(k.keyword || "")}</td>
          <td><span class="badge ${k.position <= 3 ? "badge-active" : k.position <= 10 ? "badge-brand" : "badge-inactive"}">#${k.position}</span></td>
          <td>${k.volume ? k.volume.toLocaleString() : "—"}</td>
          <td class="${k.change > 0 ? "text-success" : k.change < 0 ? "text-danger" : "text-muted"}">
            ${k.change ? (k.change > 0 ? "↑" : "↓") + Math.abs(k.change) : "—"}
          </td>
        </tr>`).join("");
  } catch (e) {
    document.getElementById("seoMetricsGrid").innerHTML =
      `<div class="empty-state"><p class="empty-text">SEO data loading. Check back soon.</p></div>`;
  }
}

/* ══════════════════════════════════════════════════════════
   CONSULTATION DASHBOARD
══════════════════════════════════════════════════════════ */
async function renderConsultationPanel(panel, uid) {
  panel.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">📅 Consultation History</div>
          <div class="card-subtitle">Your booking history and upcoming sessions</div>
        </div>
        <a href="./portal-services.html" class="btn btn-primary btn-sm">+ Book Session</a>
      </div>
      <div class="card-body">
        <div id="consultHistoryBody">
          <div class="loading-state"><div class="spinner"></div></div>
        </div>
      </div>
    </div>
  `;

  try {
    const snap = await getDocs(
      query(collection(db, "consultationBookings"),
            where("userId", "==", uid),
            orderBy("createdAt", "desc"), limit(20))
    );
    const bookings = [];
    snap.forEach(d => bookings.push({ id: d.id, ...d.data() }));

    document.getElementById("consultHistoryBody").innerHTML = bookings.length === 0
      ? `<div class="empty-state"><div class="empty-icon">📅</div>
          <h3 class="empty-title">No Consultations Yet</h3>
          <p class="empty-text">Book your first consultation to get expert guidance.</p>
          <a href="./portal-services.html" class="btn btn-primary">Book Now</a>
        </div>`
      : `<div class="leads-table-wrap">
          <table class="leads-table">
            <thead><tr><th>Session</th><th>Date Booked</th><th>Preferred Time</th><th>Status</th><th>Notes</th></tr></thead>
            <tbody>
              ${bookings.map(b => `<tr>
                <td style="font-weight:600">${b.sessionType === "paid" ? "💼 Strategy Session" : "📞 Discovery Call"}</td>
                <td style="color:var(--text-muted);font-size:.75rem">${fmtDate(b.createdAt)}</td>
                <td style="font-size:.8125rem">${b.preferredDate ? new Date(b.preferredDate).toLocaleString() : "—"}</td>
                <td><span class="badge ${
                  b.status === "confirmed" ? "badge-active" :
                  b.status === "pending_payment" ? "badge-pending" :
                  b.status === "completed" ? "badge-info" : "badge-inactive"
                }">${esc(b.status || "pending")}</span></td>
                <td style="font-size:.75rem;color:var(--text-muted);max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(b.notes || "—")}</td>
              </tr>`).join("")}
            </tbody>
          </table>
        </div>`;
  } catch (e) {
    document.getElementById("consultHistoryBody").innerHTML =
      `<div class="empty-state"><p class="empty-text">Could not load booking history.</p></div>`;
  }
}

/* ══════════════════════════════════════════════════════════
   GENERIC DASHBOARD
══════════════════════════════════════════════════════════ */
function renderGenericPanel(panel, sub) {
  panel.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">${esc(sub.icon || "⚙️")} ${esc(sub.name || "Service")}</div>
          <div class="card-subtitle">Service Dashboard</div>
        </div>
        <span class="badge badge-active">Active</span>
      </div>
      <div class="card-body">
        <div class="stats-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:1.5rem">
          <div class="stat-card">
            <div class="stat-label">Status</div>
            <div class="stat-value sm" style="color:var(--success)">Active</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Since</div>
            <div class="stat-value sm">${fmtDate(sub.createdAt, {month:"short",year:"numeric"})}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Billing</div>
            <div class="stat-value sm">${fmtPrice(sub.price)}/${sub.billing || sub.pricePeriod || "mo"}</div>
          </div>
        </div>
        <div class="empty-state" style="padding:1.5rem">
          <div class="empty-icon">📊</div>
          <h3 class="empty-title">Analytics Coming Soon</h3>
          <p class="empty-text">Detailed analytics for ${esc(sub.name || "this service")} are being configured. Check back soon!</p>
          <a href="./portal-onboarding.html?serviceId=${sub.serviceId || sub.id}" class="btn btn-secondary">Configure Service</a>
        </div>
      </div>
    </div>
  `;
}
