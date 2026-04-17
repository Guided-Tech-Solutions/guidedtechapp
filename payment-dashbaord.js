/* ============================================================
   FILE: app/portal-dashboard.js
   Page 3 — Dashboard
   Shows live KPIs if subscribed, else locked + recommendations
   ============================================================ */

import { db } from "../admin/firebase.js";
import { authReady, currentUser, esc, fmtPrice } from "./portal-layout.js";
import {
  collection, getDocs, query, where
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

const loadText = document.getElementById("loadText");

/* ══════════════════════════════
   RECOMMENDATION RENDER HELPERS
══════════════════════════════ */
function renderPlanCard(plan) {
  const price    = Number(plan.price) || 0;
  const billing  = plan.billingPeriod || "month";
  const features = Array.isArray(plan.features) ? plan.features : [];
  const popular  = !!plan.popular;

  const featHTML = features.map(f => `
    <div class="plan-feat">
      <div class="plan-feat-check">✓</div>
      <span>${esc(f)}</span>
    </div>`).join("");

  return `
    <div class="plan-card${popular ? " is-popular" : ""}" data-plan-id="${esc(plan.id)}">
      ${popular ? `<div class="plan-popular-badge">⭐ Most Popular</div>` : ""}
      ${plan.icon ? `<div class="plan-icon">${esc(plan.icon)}</div>` : ""}
      <div class="plan-name">${esc(plan.name || "Plan")}</div>
      <div class="plan-pricing">
        <span class="plan-price">$${esc(fmtPrice(price))}</span>
        <span class="plan-period">/ ${esc(billing)}</span>
      </div>
      ${plan.description ? `<div class="plan-desc">${esc(plan.description)}</div>` : ""}
      ${featHTML ? `<div class="plan-divider"></div><div class="plan-features">${featHTML}</div>` : ""}
      <a href="./portal-services.html" class="btn-get-started">Get Started</a>
    </div>`;
}

function renderServiceCard(svc) {
  const price  = Number(svc.price) || 0;
  const period = svc.pricePeriod || "";
  return `
    <div class="svc-card">
      <div class="svc-icon-ring">${esc(svc.icon || "⚙️")}</div>
      <div class="svc-name">${esc(svc.name || "Service")}</div>
      <div class="svc-desc">${esc(svc.description || "")}</div>
      <div class="svc-price-box">
        <div class="svc-from">From</div>
        <div class="svc-amount">
          $${esc(fmtPrice(price))}
          ${period ? `<span>${esc(period)}</span>` : ""}
        </div>
      </div>
      <a href="./portal-services.html" class="btn-subscribe" style="text-align:center;text-decoration:none;display:block">
        Subscribe to Activate
      </a>
    </div>`;
}

/* ══════════════════════════════
   RENDER SUBSCRIPTION SUMMARY CARD
══════════════════════════════ */
function renderSubCard(sub) {
  const price   = Number(sub.price) || 0;
  const billing = sub.billingPeriod || sub.period || "month";
  const status  = sub.status || "active";
  const since   = sub.createdAt?.toDate
    ? sub.createdAt.toDate().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "—";

  const features = Array.isArray(sub.features) ? sub.features.slice(0, 4) : [];
  const featHTML  = features.map(f => `
    <div class="sub-feat">
      <span class="sub-feat-dot"></span>
      <span>${esc(f)}</span>
    </div>`).join("");

  return `
    <div class="sub-card">
      <div class="sub-card-header">
        <div>
          <div class="sub-card-name">${esc(sub.planName || sub.serviceName || "Subscription")}</div>
          <div class="sub-card-type">${sub.type === "plan" ? "Subscription Plan" : "Individual Service"}</div>
        </div>
        <span class="sub-status-badge ${status}">
          <span class="sub-status-dot"></span>
          ${status.charAt(0).toUpperCase() + status.slice(1)}
        </span>
      </div>
      ${price ? `<div class="sub-card-price">$${esc(fmtPrice(price))} <span>/ ${esc(billing)}</span></div>` : ""}
      <div class="sub-card-meta">Active since ${since}</div>
      ${featHTML ? `<div class="sub-card-features">${featHTML}</div>` : ""}
    </div>`;
}

/* ══════════════════════════════
   FETCH USER SUBSCRIPTIONS
══════════════════════════════ */
async function fetchUserSubscriptions(uid) {
  const results = [];

  const planSnap = await getDocs(
    query(collection(db, "checkoutSessions"), where("userId", "==", uid))
  );
  planSnap.forEach(doc => {
    const d = doc.data();
    if (d.status === "active" || d.status === "pending") {
      results.push({ id: doc.id, type: "plan", ...d });
    }
  });

  const svcSnap = await getDocs(
    query(collection(db, "serviceActivations"), where("userId", "==", uid))
  );
  svcSnap.forEach(doc => {
    const d = doc.data();
    if (d.status === "active" || d.status === "pending") {
      results.push({ id: doc.id, type: "service", ...d });
    }
  });

  return results;
}

/* ══════════════════════════════
   LOAD RECOMMENDATIONS
══════════════════════════════ */
async function loadRecommendations() {
  const plansGrid    = document.getElementById("recPlansGrid");
  const servicesFlow = document.getElementById("recServicesFlow");

  try {
    const snap = await getDocs(query(collection(db, "plans"), where("active", "==", true)));
    const plans = [];
    snap.forEach(doc => plans.push({ id: doc.id, ...doc.data() }));
    if (plansGrid) {
      plansGrid.innerHTML = plans.length
        ? plans.map(p => renderPlanCard(p)).join("")
        : `<p style="color:var(--muted);font-size:13px">No plans available yet.</p>`;
      plansGrid.removeAttribute("aria-busy");
    }
  } catch (err) { console.error("Load rec plans:", err); }

  try {
    const snap = await getDocs(query(collection(db, "services"), where("active", "==", true)));
    const services = [];
    snap.forEach(doc => services.push({ id: doc.id, ...doc.data() }));
    if (servicesFlow) {
      servicesFlow.innerHTML = services.length
        ? services.map(s => renderServiceCard(s)).join("")
        : `<p style="color:var(--muted);font-size:13px">No services available yet.</p>`;
      servicesFlow.removeAttribute("aria-busy");
    }
  } catch (err) { console.error("Load rec services:", err); }
}

/* ══════════════════════════════
   UNLOCK DASHBOARD UI
══════════════════════════════ */
function unlockDashboard(subs) {
  document.getElementById("lockedDashboard").style.display  = "none";
  document.getElementById("activeDashboard").style.display  = "block";

  // KPI — active services count
  const kpiServices = document.getElementById("kpiServices");
  if (kpiServices) kpiServices.textContent = subs.length;

  // KPI — plan name (first plan found, else first service)
  const planSub = subs.find(s => s.type === "plan");
  const kpiPlan = document.getElementById("kpiPlan");
  if (kpiPlan) kpiPlan.textContent = planSub?.planName || subs[0]?.serviceName || "Custom";

  // KPI — member since (earliest createdAt)
  const kpiSince = document.getElementById("kpiSince");
  if (kpiSince) {
    const earliest = subs
      .filter(s => s.createdAt?.toDate)
      .map(s => s.createdAt.toDate())
      .sort((a, b) => a - b)[0];

    kpiSince.textContent = earliest
      ? earliest.toLocaleDateString("en-US", { month: "short", year: "numeric" })
      : "—";
  }

  // Subscription summary cards
  const dashSubCards = document.getElementById("dashSubCards");
  if (dashSubCards) dashSubCards.innerHTML = subs.map(s => renderSubCard(s)).join("");
}

/* ══════════════════════════════
   BOOT
══════════════════════════════ */
document.addEventListener("DOMContentLoaded", async () => {
  loadText.textContent = "Loading…";
  const user = await authReady;

  if (!user) {
    loadText.textContent = "Loading recommendations…";
    await loadRecommendations();
    loadText.textContent = "Sign in to access your dashboard";
    return;
  }

  loadText.textContent = "Checking subscriptions…";

  try {
    const subs = await fetchUserSubscriptions(user.uid);

    if (subs.length > 0) {
      unlockDashboard(subs);
      loadText.textContent = "Dashboard ready";
    } else {
      loadText.textContent = "Loading recommendations…";
      await loadRecommendations();
      loadText.textContent = "No active subscriptions";
    }
  } catch (err) {
    console.error("Dashboard boot:", err);
    loadText.textContent = "Error loading dashboard";
    await loadRecommendations();
  }
});
