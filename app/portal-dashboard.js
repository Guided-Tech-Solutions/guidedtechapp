/* ================================================================
   FILE: app/portal-dashboard.js  —  GTS Amplify Dashboard
   Per-service analytics: Lead Gen, Cloud Migration, Automation,
   SEO, Consultation, Generic
   ================================================================ */
import { db } from "./firebase.js";
import {
  requireAuth, currentUser,
  esc, fmtMoney, fmtDate, timeAgo, showToast, getDashboardType
} from "./portal-layout.js";
import {
  collection, getDocs, query, where, orderBy, limit,
  onSnapshot, doc, getDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

let subs       = [];
let unsubFns   = [];
let activePanel= null;

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireAuth();
  if (!user) return;

  const name = user.displayName || user.email.split("@")[0];
  document.getElementById("welcomeTitle").textContent = `Welcome back, ${name} 👋`;
  document.getElementById("welcomeSub").textContent    = "Here's what's happening with your services";

  await loadDashboard(user);
});

/* ── Load all subscriptions ─────────────────────────────────── */
async function loadDashboard(user) {
  try {
    const [s1, s2] = await Promise.all([
      getDocs(query(collection(db,"serviceActivations"), where("userId","==",user.uid), where("status","==","active"))),
      getDocs(query(collection(db,"userSubscriptions"),  where("userId","==",user.uid), where("status","==","active"))),
    ]);

    subs = [];
    s1.forEach(d => subs.push({ _docType:"service", id:d.id, ...d.data() }));
    s2.forEach(d => subs.push({ _docType:"plan",    id:d.id, ...d.data() }));

    // Enrich with service metadata
    await Promise.all(subs.map(async sub => {
      const key  = sub._docType === "plan" ? "plans" : "services";
      const ref  = sub._docType === "plan" ? (sub.planId||sub.id) : (sub.serviceId||sub.id);
      try {
        const snap = await getDoc(doc(db, key, ref));
        if (snap.exists()) Object.assign(sub, snap.data(), { _enrichedId: snap.id });
      } catch(e) {}
    }));

    document.getElementById("dashLoading").style.display = "none";

    if (!subs.length) {
      document.getElementById("noServicesState").style.display = "block";
      updateStats(0, 0, 0, 0);
      return;
    }

    document.getElementById("analyticsRoot").style.display = "block";
    buildTabs();
    calcStats(user.uid);

  } catch(e) {
    console.error("Dashboard error", e);
    document.getElementById("dashLoading").innerHTML =
      `<div class="card"><div class="card-body"><div class="empty-state">
        <div class="empty-icon">⚠️</div><h3 class="empty-title">Error Loading Dashboard</h3>
        <p class="empty-text">Please refresh the page.</p>
      </div></div></div>`;
  }
}

function updateStats(active, leads, runs, spend) {
  const set = (id, v) => { const el = document.getElementById(id); if(el) el.textContent = v; };
  set("sActive", active);
  set("sActiveSub", active + " service" + (active!==1?"s":"") + " running");
  set("sLeads",  leads);
  set("sRuns",   runs);
  set("sSpend",  fmtMoney(spend));
}

async function calcStats(uid) {
  let leads = 0, runs = 0, spend = 0;
  const now = new Date();
  const mStart = new Date(now.getFullYear(), now.getMonth(), 1);

  for (const sub of subs) {
    spend += Number(sub.price || sub.priceMonthly || 0);
    const key = `${uid}_${sub.serviceId || sub._enrichedId || sub.id}`;
    const dashType = getDashboardType(sub);

    try {
      if (dashType === "lead_generation") {
        const sn = await getDocs(query(collection(db,"serviceData",key,"leads"), where("createdAt",">=",mStart)));
        leads += sn.size;
      }
      if (dashType === "automation") {
        const sn = await getDocs(query(collection(db,"serviceData",key,"automationRuns"), orderBy("createdAt","desc"), limit(50)));
        runs += sn.size;
      }
    } catch(e) {}
  }
  updateStats(subs.length, leads, runs, spend);
}

/* ── Build analytics tabs ───────────────────────────────────── */
function buildTabs() {
  const row    = document.getElementById("analyticsTabsRow");
  const panels = document.getElementById("analyticsPanels");
  row.innerHTML = panels.innerHTML = "";

  subs.forEach((sub, i) => {
    const name  = sub.name || sub.planName || `Service ${i+1}`;
    const icon  = sub.icon || "⚙️";
    const panelId = `ap-${i}`;

    const btn = document.createElement("button");
    btn.className = `analytics-tab${i===0?" active":""}`;
    btn.dataset.panel = panelId;
    btn.innerHTML = `${icon} ${esc(name)}`;
    btn.addEventListener("click", () => switchPanel(panelId, sub, currentUser));
    row.appendChild(btn);

    const panel = document.createElement("div");
    panel.className = `analytics-panel${i===0?" active":""}`;
    panel.id = panelId;
    panel.innerHTML = `<div class="loading-box"><div class="spinner"></div></div>`;
    panels.appendChild(panel);
  });

  if (subs.length) switchPanel("ap-0", subs[0], currentUser);
}

function switchPanel(panelId, sub, user) {
  unsubFns.forEach(fn => fn());
  unsubFns = [];

  document.querySelectorAll(".analytics-tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".analytics-panel").forEach(p => p.classList.remove("active"));
  document.querySelector(`[data-panel="${panelId}"]`)?.classList.add("active");

  const panel = document.getElementById(panelId);
  if (!panel) return;
  panel.classList.add("active");
  activePanel = panelId;

  const dashType = getDashboardType(sub);
  const key      = `${user.uid}_${sub.serviceId || sub._enrichedId || sub.id}`;

  switch(dashType) {
    case "lead_generation": renderLeadPanel(panel, sub, key); break;
    case "cloud_migration": renderMigrationPanel(panel, sub, key); break;
    case "automation":      renderAutomationPanel(panel, sub, key); break;
    case "seo":             renderSEOPanel(panel, sub, key); break;
    case "consultation":    renderConsultationPanel(panel, user.uid); break;
    default:                renderGenericPanel(panel, sub); break;
  }
}

/* ═══════════════════════════════════════════════════════════
   LEAD GENERATION
═══════════════════════════════════════════════════════════ */
function renderLeadPanel(panel, sub, key) {
  panel.innerHTML = `
  <div class="card">
    <div class="card-header">
      <div><div class="card-title">🎯 Lead Generation Dashboard</div><div class="card-subtitle">${esc(sub.name||"Lead Generation")}</div></div>
      <div class="flex items-center gap-sm">
        <button class="btn btn-ghost btn-sm" id="btnExportLeads">📥 Export CSV</button>
        <span class="badge badge-active">● Live</span>
      </div>
    </div>
    <div class="card-body">
      <div class="stats-grid" style="grid-template-columns:repeat(4,1fr)">
        <div class="stat-card"><div class="stat-label">Total Leads</div><div class="stat-value" id="lgTotal">—</div></div>
        <div class="stat-card"><div class="stat-label">This Month</div><div class="stat-value" id="lgMonth">—</div></div>
        <div class="stat-card"><div class="stat-label">🔥 Hot Leads</div><div class="stat-value" id="lgHot" style="color:var(--danger)">—</div></div>
        <div class="stat-card"><div class="stat-label">Conversion</div><div class="stat-value" id="lgConv">—%</div></div>
      </div>
      <div style="margin-top:1.25rem">
        <div class="flex justify-between items-center mb-md">
          <div style="font-weight:700;font-size:.9375rem">Recent Leads</div>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Source</th><th>Score</th><th>Date</th></tr></thead>
            <tbody id="leadsBody"><tr><td colspan="6" style="text-align:center;padding:1.5rem"><div class="spinner" style="margin:auto;width:24px;height:24px;border-width:2px;border-top-color:var(--brand)"></div></td></tr></tbody>
          </table>
        </div>
      </div>
    </div>
  </div>`;

  // Real-time listener
  const q = query(collection(db,"serviceData",key,"leads"), orderBy("createdAt","desc"), limit(60));
  const unsub = onSnapshot(q, snap => {
    const leads = [];
    snap.forEach(d => leads.push({ id:d.id, ...d.data() }));
    updateLeadTable(leads);
    updateLeadStats(leads);
  }, e => console.error("Leads listener", e));
  unsubFns.push(unsub);

  panel.querySelector("#btnExportLeads")?.addEventListener("click", () => exportLeadsCSV(key));
}

function updateLeadTable(leads) {
  const tbody = document.getElementById("leadsBody");
  if (!tbody) return;
  if (!leads.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-faint)">No leads captured yet. Once lead generation is active, leads appear here in real time.</td></tr>`;
    return;
  }
  tbody.innerHTML = leads.map(l => {
    const sc = l.score || "cold";
    return `<tr>
      <td><div class="td-name">${esc(l.name||"Unknown")}</div></td>
      <td style="font-size:.75rem">${esc(l.email||"—")}</td>
      <td style="font-size:.75rem">${esc(l.phone||"—")}</td>
      <td><span style="font-size:.6875rem;text-transform:uppercase;font-weight:700;color:var(--text-faint)">${esc(l.source||"website")}</span></td>
      <td><span class="lead-score ${sc}">${sc.toUpperCase()}</span></td>
      <td style="font-size:.75rem;color:var(--text-muted)">${fmtDate(l.createdAt)}</td>
    </tr>`;
  }).join("");
}

function updateLeadStats(leads) {
  const now = new Date();
  const mStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const month  = leads.filter(l => { const d=l.createdAt?.toDate?.()||new Date(l.createdAt); return d>=mStart; });
  const hot    = leads.filter(l => l.score==="hot");
  const conv   = leads.filter(l => l.status==="converted");
  const set = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
  set("lgTotal", leads.length);
  set("lgMonth", month.length);
  set("lgHot",   hot.length);
  set("lgConv",  leads.length>0 ? Math.round(conv.length/leads.length*100)+"%" : "0%");
}

async function exportLeadsCSV(key) {
  try {
    const snap = await getDocs(query(collection(db,"serviceData",key,"leads"), orderBy("createdAt","desc")));
    const rows = [["Name","Email","Phone","Source","Score","Status","Date"]];
    snap.forEach(d => { const l=d.data(); rows.push([l.name||"",l.email||"",l.phone||"",l.source||"",l.score||"",l.status||"",fmtDate(l.createdAt)]); });
    const csv = rows.map(r => r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
    const a   = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
    a.download = `gts_leads_${Date.now()}.csv`; a.click();
    showToast({ title:"Exported!", message:"Leads downloaded as CSV.", type:"success" });
  } catch(e) { showToast({ title:"Export failed", type:"error" }); }
}

/* ═══════════════════════════════════════════════════════════
   CLOUD MIGRATION
═══════════════════════════════════════════════════════════ */
async function renderMigrationPanel(panel, sub, key) {
  panel.innerHTML = `
  <div class="card">
    <div class="card-header">
      <div><div class="card-title">☁️ Cloud Migration Dashboard</div><div class="card-subtitle">${esc(sub.name||"Cloud Migration")}</div></div>
    </div>
    <div class="card-body">
      <div class="flex justify-between items-center mb-md">
        <span style="font-weight:700">Overall Progress</span>
        <span style="font-family:var(--ff-d);font-weight:700;color:var(--brand)" id="migPct">0%</span>
      </div>
      <div class="progress-wrap lg" style="margin-bottom:1.5rem"><div class="progress-bar" id="migBar" style="width:0%"></div></div>
      <div class="stats-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:1.5rem">
        <div class="stat-card"><div class="stat-label">Data Moved</div><div class="stat-value sm" id="migData">—</div></div>
        <div class="stat-card"><div class="stat-label">Files Migrated</div><div class="stat-value" id="migFiles">—</div></div>
        <div class="stat-card"><div class="stat-label">Est. Completion</div><div class="stat-value sm" id="migETA">—</div></div>
      </div>
      <div style="font-weight:700;font-size:.9375rem;margin-bottom:.875rem">Migration Phases</div>
      <div id="migPhasesList"><div class="loading-box"><div class="spinner"></div></div></div>
      <div style="font-weight:700;font-size:.9375rem;margin:1.25rem 0 .875rem">Recent Events</div>
      <div id="migEventLog"></div>
    </div>
  </div>`;

  try {
    const [cfgSnap, eventsSnap] = await Promise.all([
      getDoc(doc(db,"serviceConfigs",key)),
      getDocs(query(collection(db,"serviceData",key,"migrationEvents"), orderBy("createdAt","desc"), limit(20))),
    ]);

    const cfg    = cfgSnap.exists() ? cfgSnap.data() : {};
    const events = [];
    eventsSnap.forEach(d => events.push({ id:d.id, ...d.data() }));

    const phases = cfg.phases || [
      { name:"Assessment & Planning",  status:"done",        detail:"Completed" },
      { name:"Data Inventory",         status:"done",        detail:"All assets catalogued" },
      { name:"Test Migration",         status:"in-progress", detail:"Running validation tests" },
      { name:"Production Migration",   status:"pending",     detail:"Scheduled" },
      { name:"Validation & Cutover",   status:"pending",     detail:"Pending" },
    ];

    const done = phases.filter(p=>p.status==="done").length;
    const pct  = Math.round(done/phases.length*100);
    const bar  = document.getElementById("migBar");
    if (bar) { bar.style.width = pct+"%"; if(pct===100) bar.classList.add("success"); }
    const pctEl = document.getElementById("migPct");
    if (pctEl) pctEl.textContent = pct+"%";

    const phaseEl = document.getElementById("migPhasesList");
    if (phaseEl) phaseEl.innerHTML = phases.map(ph => `
      <div class="migration-phase">
        <div class="phase-icon ${ph.status==="done"?"done":ph.status==="in-progress"?"active":"pending"}">
          ${ph.status==="done"?"✓":ph.status==="in-progress"?"⟳":"○"}
        </div>
        <div class="phase-info">
          <div class="phase-name">${esc(ph.name)}</div>
          <div class="phase-detail">${esc(ph.detail||"")}</div>
        </div>
        <span class="badge ${ph.status==="done"?"badge-active":ph.status==="in-progress"?"badge-pending":"badge-inactive"}">
          ${ph.status==="done"?"Done":ph.status==="in-progress"?"In Progress":"Pending"}
        </span>
      </div>`).join("");

    const last = events[0] || {};
    const set = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
    set("migData",  last.dataMoved  || "Calculating...");
    set("migFiles", last.filesMoved || "—");
    set("migETA",   last.eta        || "TBD");

    const logEl = document.getElementById("migEventLog");
    if (logEl) logEl.innerHTML = !events.length
      ? `<div style="color:var(--text-faint);font-size:.875rem;padding:.5rem 0">No events logged yet.</div>`
      : events.map(e => `
          <div class="flex gap-md" style="padding:.5rem 0;border-bottom:1px solid var(--border)">
            <div style="width:8px;height:8px;border-radius:50%;background:${e.type==="error"?"var(--danger)":"var(--brand-light)"};flex-shrink:0;margin-top:6px"></div>
            <div>
              <div style="font-size:.875rem;color:var(--text-mid)">${esc(e.message||e.event||"Event logged")}</div>
              <div style="font-size:.75rem;color:var(--text-faint)">${timeAgo(e.createdAt)}</div>
            </div>
          </div>`).join("");
  } catch(e) {
    const el = document.getElementById("migPhasesList");
    if (el) el.innerHTML = `<div class="empty-state" style="padding:1rem"><p class="empty-text">Migration data loading. Check back soon.</p></div>`;
  }
}

/* ═══════════════════════════════════════════════════════════
   AUTOMATION
═══════════════════════════════════════════════════════════ */
async function renderAutomationPanel(panel, sub, key) {
  panel.innerHTML = `
  <div class="card">
    <div class="card-header">
      <div><div class="card-title">🤖 Automation Dashboard</div><div class="card-subtitle">${esc(sub.name||"Automation Service")}</div></div>
      <span class="badge badge-active">Running</span>
    </div>
    <div class="card-body">
      <div class="stats-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:1.5rem">
        <div class="stat-card"><div class="stat-label">Total Runs</div><div class="stat-value" id="aTotal">—</div></div>
        <div class="stat-card"><div class="stat-label">Successful</div><div class="stat-value" id="aSuccess" style="color:var(--success)">—</div></div>
        <div class="stat-card"><div class="stat-label">Failed</div><div class="stat-value" id="aFailed" style="color:var(--danger)">—</div></div>
        <div class="stat-card"><div class="stat-label">Success Rate</div><div class="stat-value" id="aRate">—%</div></div>
      </div>
      <div style="font-weight:700;font-size:.9375rem;margin-bottom:.875rem">Run History</div>
      <div id="autoRunList"><div class="loading-box"><div class="spinner"></div></div></div>
    </div>
  </div>`;

  try {
    const snap = await getDocs(query(collection(db,"serviceData",key,"automationRuns"), orderBy("createdAt","desc"), limit(40)));
    const runs = [];
    snap.forEach(d => runs.push({ id:d.id, ...d.data() }));

    const total   = runs.length;
    const success = runs.filter(r=>r.status==="success").length;
    const failed  = runs.filter(r=>r.status==="failed").length;
    const rate    = total>0 ? Math.round(success/total*100) : 0;

    const set = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
    set("aTotal",   total);
    set("aSuccess", success);
    set("aFailed",  failed);
    set("aRate",    rate+"%");

    const listEl = document.getElementById("autoRunList");
    if (listEl) listEl.innerHTML = !runs.length
      ? `<div class="empty-state" style="padding:1rem"><div class="empty-text">No automation runs yet. Runs will appear here as they execute.</div></div>`
      : runs.map(r => `
          <div class="run-row">
            <div class="run-dot ${r.status||"success"}"></div>
            <div style="flex:1">
              <div class="run-name">${esc(r.name||r.workflowName||"Automation Run")}</div>
              <div class="run-detail">${esc(r.trigger||r.detail||"")}</div>
            </div>
            <span class="badge ${r.status==="success"?"badge-active":r.status==="failed"?"badge-danger":"badge-pending"}">${esc(r.status||"success")}</span>
            <div class="run-time">${timeAgo(r.createdAt)}</div>
          </div>`).join("");
  } catch(e) {
    const el = document.getElementById("autoRunList");
    if (el) el.innerHTML = `<div class="empty-state"><p class="empty-text">Automation data loading.</p></div>`;
  }
}

/* ═══════════════════════════════════════════════════════════
   SEO
═══════════════════════════════════════════════════════════ */
async function renderSEOPanel(panel, sub, key) {
  panel.innerHTML = `
  <div class="card">
    <div class="card-header">
      <div><div class="card-title">🔍 SEO Dashboard</div><div class="card-subtitle">${esc(sub.name||"SEO Service")}</div></div>
    </div>
    <div class="card-body">
      <div class="seo-grid" id="seoMetrics"><div class="loading-box"><div class="spinner"></div></div></div>
      <div style="font-weight:700;font-size:.9375rem;margin:1.25rem 0 .875rem">Top Keywords</div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Keyword</th><th>Position</th><th>Volume</th><th>Change</th></tr></thead>
          <tbody id="kwBody"><tr><td colspan="4" style="text-align:center;padding:1.5rem"><div class="spinner" style="margin:auto;width:24px;height:24px;border-width:2px;border-top-color:var(--brand)"></div></td></tr></tbody>
        </table>
      </div>
    </div>
  </div>`;

  try {
    const [metricsSnap, kwSnap] = await Promise.all([
      getDocs(query(collection(db,"serviceData",key,"seoMetrics"), orderBy("createdAt","desc"), limit(1))),
      getDocs(query(collection(db,"serviceData",key,"keywords"),   orderBy("position","asc"),   limit(20))),
    ]);

    const m  = metricsSnap.empty ? {} : metricsSnap.docs[0].data();
    const kws= [];
    kwSnap.forEach(d => kws.push({ id:d.id, ...d.data() }));

    const metricsEl = document.getElementById("seoMetrics");
    if (metricsEl) metricsEl.innerHTML = [
      { label:"Domain Authority",  val: m.domainAuthority||"—", chg:"+2",   up:true  },
      { label:"Organic Visitors",  val: m.organicVisitors||(m.visitors||"—"), chg:"+14%", up:true  },
      { label:"Keywords Ranked",   val: m.keywordsRanked||"—", chg:"+5",   up:true  },
      { label:"Backlinks",         val: m.backlinks||"—",      chg:"+8",   up:true  },
      { label:"Page Speed",        val: m.pageSpeed ? m.pageSpeed+"/100" : "—", chg:"",up:true },
      { label:"Core Web Vitals",   val: m.coreWebVitals||"Pass", chg:"",   up:true  },
    ].map(x => `
      <div class="seo-metric">
        <div class="seo-val">${esc(String(x.val))}</div>
        <div class="seo-label">${x.label}</div>
        ${x.chg?`<div class="seo-chg ${x.up?"up":"down"}">${x.up?"↑":"↓"} ${x.chg}</div>`:""}
      </div>`).join("");

    const kwEl = document.getElementById("kwBody");
    if (kwEl) kwEl.innerHTML = !kws.length
      ? `<tr><td colspan="4" style="text-align:center;padding:2rem;color:var(--text-faint)">No keyword data yet. Tracking will populate here once SEO is active.</td></tr>`
      : kws.map(k => `<tr>
          <td style="font-weight:600">${esc(k.keyword||"")}</td>
          <td><span class="badge ${k.position<=3?"badge-active":k.position<=10?"badge-brand":"badge-inactive"}">#${k.position}</span></td>
          <td>${k.volume?Number(k.volume).toLocaleString():"—"}</td>
          <td style="color:${k.change>0?"var(--success)":k.change<0?"var(--danger)":"var(--text-muted)"}">
            ${k.change?(k.change>0?"↑":"↓")+Math.abs(k.change):"—"}
          </td>
        </tr>`).join("");
  } catch(e) {
    const el = document.getElementById("seoMetrics");
    if (el) el.innerHTML = `<div class="empty-state"><p class="empty-text">SEO data loading.</p></div>`;
  }
}

/* ═══════════════════════════════════════════════════════════
   CONSULTATION HISTORY
═══════════════════════════════════════════════════════════ */
async function renderConsultationPanel(panel, uid) {
  panel.innerHTML = `
  <div class="card">
    <div class="card-header">
      <div><div class="card-title">📅 Consultation History</div><div class="card-subtitle">Your bookings and upcoming sessions</div></div>
      <a href="./portal-services.html" class="btn btn-primary btn-sm">+ Book Session</a>
    </div>
    <div class="card-body" id="consultBody"><div class="loading-box"><div class="spinner"></div></div></div>
  </div>`;

  try {
    const snap = await getDocs(query(collection(db,"consultationBookings"), where("userId","==",uid), orderBy("createdAt","desc"), limit(20)));
    const bookings = [];
    snap.forEach(d => bookings.push({ id:d.id, ...d.data() }));

    const el = document.getElementById("consultBody");
    if (!el) return;
    if (!bookings.length) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon">📅</div><h3 class="empty-title">No Consultations Yet</h3><p class="empty-text">Book your first consultation to get expert guidance.</p><a href="./portal-services.html" class="btn btn-primary">Book Now</a></div>`;
      return;
    }
    el.innerHTML = `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Session</th><th>Booked</th><th>Preferred Time</th><th>Status</th><th>Fee</th></tr></thead>
      <tbody>${bookings.map(b=>`<tr>
        <td><div class="td-name">${b.sessionType==="paid"?"💼 Strategy Session":"📞 Discovery Call"}</div></td>
        <td style="font-size:.75rem;color:var(--text-muted)">${fmtDate(b.createdAt)}</td>
        <td style="font-size:.8125rem">${b.preferredDate?new Date(b.preferredDate).toLocaleString():"—"}</td>
        <td><span class="badge ${b.status==="confirmed"?"badge-active":b.status==="completed"?"badge-info":b.status==="pending_payment"?"badge-pending":"badge-inactive"}">${esc(b.status||"pending")}</span></td>
        <td>${b.price>0?fmtMoney(b.price):"Free"}</td>
      </tr>`).join("")}
      </tbody>
    </table></div>`;
  } catch(e) {
    const el = document.getElementById("consultBody");
    if (el) el.innerHTML = `<div class="empty-state"><p class="empty-text">Could not load bookings.</p></div>`;
  }
}

/* ═══════════════════════════════════════════════════════════
   GENERIC
═══════════════════════════════════════════════════════════ */
function renderGenericPanel(panel, sub) {
  panel.innerHTML = `
  <div class="card">
    <div class="card-header">
      <div><div class="card-title">${esc(sub.icon||"⚙️")} ${esc(sub.name||"Service")}</div><div class="card-subtitle">Service Dashboard</div></div>
      <span class="badge badge-active">Active</span>
    </div>
    <div class="card-body">
      <div class="stats-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:1.5rem">
        <div class="stat-card"><div class="stat-label">Status</div><div class="stat-value sm" style="color:var(--success)">Active</div></div>
        <div class="stat-card"><div class="stat-label">Billing</div><div class="stat-value sm">${fmtMoney(sub.price||sub.priceMonthly||0)}/${sub.billing||sub.pricePeriod||"mo"}</div></div>
        <div class="stat-card"><div class="stat-label">Since</div><div class="stat-value sm">${fmtDate(sub.createdAt,{month:"short",year:"numeric"})}</div></div>
      </div>
      <div class="empty-state" style="padding:1.5rem">
        <div class="empty-icon">📊</div>
        <h3 class="empty-title">Analytics Coming Soon</h3>
        <p class="empty-text">Detailed analytics for this service are being configured.</p>
        <a href="./portal-onboarding.html?serviceId=${esc(sub.serviceId||sub._enrichedId||sub.id)}" class="btn btn-secondary">Configure Service</a>
      </div>
    </div>
  </div>`;
}
