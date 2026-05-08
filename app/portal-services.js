/* ============================================================
   FILE: app/portal-services.js
   Services & Pricing page — Individual services, plans/bundles,
   consultation booking, Paystack checkout
   ============================================================ */
import { db } from "./firebase.js";
import { authReady, currentUser, esc, fmtDate, fmtPrice, showToast, openModal, closeModal } from "./portal-layout.js";
import {
  collection, getDocs, addDoc, doc, getDoc,
  query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

/* ── State ────────────────────────────────────────────────── */
let allServices     = [];
let allPlans        = [];
let consultPricing  = { free: 0, paid: 0 };
let activeSubs      = new Set();  // serviceIds/planIds user already has
let billingMode     = "monthly";  // "monthly" | "yearly"
let planBillingMode = "monthly";
let pendingCheckout = null;       // { type, itemId, itemName, price, billing }

/* ── Init ─────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", async () => {
  setupTabs();
  setupBillingToggles();
  setupConsultationButtons();
  setupCheckoutModal();
  setupConsultModal();

  const user = await authReady;
  if (user) await loadUserActivations(user.uid);

  await Promise.all([loadServices(), loadPlans(), loadConsultationPricing()]);
});

/* ── Tabs ─────────────────────────────────────────────────── */
function setupTabs() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("tab-" + btn.dataset.tab)?.classList.add("active");
    });
  });
}

/* ── Billing toggles ──────────────────────────────────────── */
function setupBillingToggles() {
  document.querySelectorAll("#billingToggle .billing-toggle-option").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#billingToggle .billing-toggle-option")
        .forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      billingMode = btn.dataset.billing;
      renderServices();
    });
  });
  document.querySelectorAll("#plansBillingToggle .billing-toggle-option").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#plansBillingToggle .billing-toggle-option")
        .forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      planBillingMode = btn.dataset.billing;
      renderPlans();
    });
  });
}

/* ── Load user's active subscriptions ────────────────────── */
async function loadUserActivations(uid) {
  try {
    const [svcSnap, planSnap] = await Promise.all([
      getDocs(query(collection(db, "serviceActivations"), where("userId", "==", uid), where("status", "==", "active"))),
      getDocs(query(collection(db, "userSubscriptions"),  where("userId", "==", uid), where("status", "==", "active")))
    ]);
    svcSnap.forEach(d => activeSubs.add(d.data().serviceId));
    planSnap.forEach(d => activeSubs.add(d.data().planId));
  } catch (e) { console.error("Load activations error", e); }
}

/* ── Load services ────────────────────────────────────────── */
async function loadServices() {
  try {
    const snap = await getDocs(query(collection(db, "services"), where("active", "==", true)));
    allServices = [];
    snap.forEach(d => allServices.push({ id: d.id, ...d.data() }));
    renderServices();
  } catch (e) {
    console.error("Load services error", e);
    document.getElementById("servicesGrid").innerHTML =
      `<div class="empty-state"><div class="empty-icon">⚠️</div><p class="empty-text">Failed to load services. Please refresh.</p></div>`;
  }
}

function renderServices() {
  const grid  = document.getElementById("servicesGrid");
  const empty = document.getElementById("servicesEmpty");

  if (allServices.length === 0) {
    grid.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  // Exclude consultation services from this tab
  const services = allServices.filter(s => s.dashboardType !== "consultation");

  grid.innerHTML = services.map(s => {
    const isYearly   = billingMode === "yearly";
    const basePrice  = Number(s.price) || 0;
    const price      = isYearly ? (basePrice * 12 * 0.8) : basePrice;
    const period     = isYearly ? "year" : (s.pricePeriod || "month");
    const subscribed = activeSubs.has(s.id);
    const features   = Array.isArray(s.features) ? s.features : [];

    return `
    <div class="service-card ${subscribed ? "subscribed" : ""}">
      ${s.featured ? `<div class="service-card-badge popular">Popular</div>` : ""}
      ${s.isNew    ? `<div class="service-card-badge new">New</div>` : ""}
      <div class="service-card-icon">${esc(s.icon || "⚙️")}</div>
      <div class="service-card-name">${esc(s.name)}</div>
      <div class="service-card-desc">${esc(s.description || "")}</div>
      ${features.length ? `
        <div class="service-card-features">
          ${features.slice(0, 4).map(f => `<div class="service-card-feature">${esc(f)}</div>`).join("")}
        </div>` : ""}
      <div class="service-card-price">
        <span class="price-amount">${fmtPrice(price)}</span>
        <span class="price-period">/ ${esc(period)}</span>
        ${isYearly && basePrice > 0 ? `<span class="price-crossed">${fmtPrice(basePrice * 12)}</span>` : ""}
      </div>
      ${subscribed
        ? `<button class="btn-subscribe subscribed" disabled>✓ Active</button>`
        : `<button class="btn-subscribe" onclick="window.initiateCheckout('service','${s.id}','${esc(s.name).replace(/'/g,"\\'")}',${price},'${period}')">
            Get Started
           </button>`
      }
    </div>`;
  }).join("");
}

/* ── Load plans ───────────────────────────────────────────── */
async function loadPlans() {
  try {
    const snap = await getDocs(query(collection(db, "plans"), where("active", "==", true)));
    allPlans = [];
    snap.forEach(d => allPlans.push({ id: d.id, ...d.data() }));
    renderPlans();
  } catch (e) {
    console.error("Load plans error", e);
  }
}

function renderPlans() {
  const grid  = document.getElementById("plansGrid");
  const empty = document.getElementById("plansEmpty");

  if (allPlans.length === 0) {
    grid.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  grid.innerHTML = allPlans.map(p => {
    const isYearly  = planBillingMode === "yearly";
    const basePrice = isYearly ? (Number(p.priceYearly) || Number(p.priceMonthly) * 12 * 0.8) : (Number(p.priceMonthly) || 0);
    const period    = isYearly ? "year" : "month";
    const subscribed = activeSubs.has(p.id);
    const features   = Array.isArray(p.features) ? p.features : [];

    return `
    <div class="plan-card ${p.popular ? "popular" : ""}">
      <div class="plan-card-header">
        ${p.popular ? `<div class="plan-popular-label">Most Popular</div>` : ""}
        <div class="plan-name">${esc(p.name)}</div>
        <div class="plan-desc">${esc(p.description || "")}</div>
        <div class="plan-price-row">
          <span class="plan-price">${fmtPrice(basePrice)}</span>
          <span class="plan-period">/ ${period}</span>
        </div>
      </div>
      <div class="plan-card-body">
        <div class="plan-features">
          ${features.map(f => `
            <div class="plan-feature">
              <span class="plan-feature-check">✓</span>
              <span>${esc(f)}</span>
            </div>`).join("")}
        </div>
        ${subscribed
          ? `<button class="btn btn-success btn-block" disabled>✓ Active Plan</button>`
          : `<button class="btn btn-primary btn-block"
               onclick="window.initiateCheckout('plan','${p.id}','${esc(p.name).replace(/'/g,"\\'")}',${basePrice},'${period}')">
               Choose Plan
             </button>`
        }
      </div>
    </div>`;
  }).join("");
}

/* ── Consultation ─────────────────────────────────────────── */
async function loadConsultationPricing() {
  try {
    const snap = await getDocs(collection(db, "consultationPricing"));
    snap.forEach(d => {
      const data = d.data();
      if (data.type === "free") consultPricing.free = Number(data.price) || 0;
      if (data.type === "paid") consultPricing.paid = Number(data.price) || 0;
    });
  } catch (e) {
    // Use defaults if not set
    consultPricing = { free: 0, paid: 150 };
  }
  renderConsultationCards();
}

function renderConsultationCards() {
  const grid = document.getElementById("consultationGrid");
  grid.innerHTML = `
    <div class="service-card">
      <div class="service-card-icon">📞</div>
      <div class="service-card-name">Free Discovery Call</div>
      <div class="service-card-desc">A complimentary 30-minute call with one of our tech experts. We'll understand your challenges and suggest the best path forward — no commitment required.</div>
      <div class="service-card-features">
        <div class="service-card-feature">30-minute session via Zoom/Google Meet</div>
        <div class="service-card-feature">Business needs assessment</div>
        <div class="service-card-feature">Service recommendations</div>
        <div class="service-card-feature">Q&A with our experts</div>
      </div>
      <div class="service-card-price">
        <span class="price-amount" style="color:var(--success)">Free</span>
      </div>
      <button class="btn-subscribe" style="background:var(--success)" onclick="window.openConsultModal('free')">
        📅 Book Free Call
      </button>
    </div>

    <div class="service-card">
      <div class="service-card-badge popular">Recommended</div>
      <div class="service-card-icon">💼</div>
      <div class="service-card-name">Strategy Session</div>
      <div class="service-card-desc">An in-depth 60-minute session for serious business transformation. Deep-dive analysis, custom roadmap, and priority action plan delivered after the session.</div>
      <div class="service-card-features">
        <div class="service-card-feature">60-minute intensive session</div>
        <div class="service-card-feature">Detailed business analysis</div>
        <div class="service-card-feature">Custom technology roadmap</div>
        <div class="service-card-feature">Written action plan delivered</div>
        <div class="service-card-feature">30-day email follow-up support</div>
      </div>
      <div class="service-card-price">
        <span class="price-amount">${fmtPrice(consultPricing.paid || 150)}</span>
        <span class="price-period">/ session</span>
      </div>
      <button class="btn-subscribe" onclick="window.openConsultModal('paid')">
        💼 Book Strategy Session
      </button>
    </div>
  `;
}

function setupConsultationButtons() {
  document.getElementById("btnBookFree")?.addEventListener("click", () => window.openConsultModal("free"));
  document.getElementById("btnBookPaid")?.addEventListener("click", () => window.openConsultModal("paid"));
}

/* ── Consultation modal ───────────────────────────────────── */
window.openConsultModal = function(type) {
  const isPaid = type === "paid";
  document.getElementById("consultModalTitle").textContent = isPaid ? "Book Strategy Session" : "Book Free Discovery Call";
  document.getElementById("consultType").value = type;
  const priceLine = document.getElementById("consultPriceLine");
  if (isPaid) {
    priceLine.style.display = "block";
    document.getElementById("consultPriceDisplay").textContent = fmtPrice(consultPricing.paid || 150);
  } else {
    priceLine.style.display = "none";
  }
  // Pre-fill if user signed in
  if (currentUser) {
    document.getElementById("consultName").value  = currentUser.displayName || "";
    document.getElementById("consultEmail").value = currentUser.email || "";
  }
  openModal("consultationModal");
};

function setupConsultModal() {
  document.getElementById("consultType")?.addEventListener("change", function() {
    const priceLine = document.getElementById("consultPriceLine");
    if (this.value === "paid") {
      priceLine.style.display = "block";
      document.getElementById("consultPriceDisplay").textContent = fmtPrice(consultPricing.paid || 150);
    } else {
      priceLine.style.display = "none";
    }
  });

  document.getElementById("btnConfirmConsult")?.addEventListener("click", submitConsultation);
}

async function submitConsultation() {
  const btn  = document.getElementById("btnConfirmConsult");
  const name  = document.getElementById("consultName").value.trim();
  const email = document.getElementById("consultEmail").value.trim();
  const phone = document.getElementById("consultPhone").value.trim();
  const type  = document.getElementById("consultType").value;
  const dt    = document.getElementById("consultDateTime").value;
  const notes = document.getElementById("consultNotes").value.trim();

  if (!name || !email) {
    showToast({ title: "Missing info", message: "Please fill in your name and email.", type: "warning" });
    return;
  }

  btn.classList.add("loading");
  btn.disabled = true;

  try {
    const isPaid   = type === "paid";
    const price    = isPaid ? (consultPricing.paid || 150) : 0;

    const bookingData = {
      userId:       currentUser?.uid || null,
      userName:     name,
      userEmail:    email,
      userPhone:    phone || null,
      sessionType:  type,
      price:        price,
      preferredDate: dt || null,
      notes:        notes || null,
      status:       isPaid ? "pending_payment" : "confirmed",
      createdAt:    serverTimestamp(),
    };

    const bookingRef = await addDoc(collection(db, "consultationBookings"), bookingData);

    if (isPaid && price > 0) {
      // Initiate Paystack checkout for paid session
      closeModal("consultationModal");
      await initiatePaystackCheckout({
        type:     "consultation",
        itemId:   bookingRef.id,
        itemName: "Strategy Session",
        price:    price,
        billing:  "once",
        email:    email,
      });
    } else {
      closeModal("consultationModal");
      showToast({
        title: "Booking Confirmed!",
        message: "We'll reach out within 24 hours to confirm your call time.",
        type: "success",
        duration: 6000,
      });
    }
  } catch (e) {
    console.error("Booking error", e);
    showToast({ title: "Booking failed", message: "Please try again.", type: "error" });
  } finally {
    btn.classList.remove("loading");
    btn.disabled = false;
  }
}

/* ── Checkout flow ────────────────────────────────────────── */
window.initiateCheckout = function(type, itemId, itemName, price, billing) {
  const user = currentUser;
  if (!user) {
    showToast({ title: "Sign in required", message: "Please log in to subscribe.", type: "warning" });
    setTimeout(() => window.location.href = "./login.html?redirect=./portal-services.html", 1500);
    return;
  }

  pendingCheckout = { type, itemId, itemName, price, billing };

  document.getElementById("subscribeModalTitle").textContent = `Subscribe to ${itemName}`;
  document.getElementById("subscribeModalContent").innerHTML = `
    <div style="text-align:center;padding:1rem 0">
      <div style="font-size:2.5rem;margin-bottom:.75rem">🛒</div>
      <div style="font-family:var(--ff-display);font-size:1.125rem;font-weight:700;margin-bottom:.25rem">${esc(itemName)}</div>
      <div style="color:var(--text-muted);font-size:.875rem;margin-bottom:1.25rem">${billing === "once" ? "One-time payment" : `Billed ${billing}`}</div>
      <div style="font-family:var(--ff-display);font-size:2rem;font-weight:800;color:var(--brand)">${fmtPrice(price)}</div>
      <div style="color:var(--text-muted);font-size:.8125rem;margin-top:.25rem">
        ${type === "plan" ? "Bundle plan" : "Individual service"}
      </div>
    </div>
    <div style="background:var(--brand-pale);border-radius:var(--r-sm);padding:.875rem;margin-top:1rem;font-size:.8125rem;color:var(--brand)">
      🔒 Secure payment powered by Paystack. You'll be redirected to complete payment.
    </div>
  `;
  openModal("subscribeModal");
};

function setupCheckoutModal() {
  document.getElementById("btnConfirmSubscribe")?.addEventListener("click", async () => {
    if (!pendingCheckout) return;
    closeModal("subscribeModal");

    const { type, itemId, itemName, price, billing } = pendingCheckout;
    await initiatePaystackCheckout({ type, itemId, itemName, price, billing, email: currentUser?.email });
    pendingCheckout = null;
  });
}

async function initiatePaystackCheckout({ type, itemId, itemName, price, billing, email }) {
  const btn = document.getElementById("btnConfirmSubscribe");
  if (btn) { btn.classList.add("loading"); btn.disabled = true; }

  try {
    // Create checkout session in Firestore first
    const sessionRef = await addDoc(collection(db, "checkoutSessions"), {
      userId:    currentUser?.uid || null,
      userEmail: email,
      itemType:  type,
      itemId:    itemId,
      itemName:  itemName,
      price:     price,
      billing:   billing,
      status:    "pending",
      createdAt: serverTimestamp(),
    });

    // Call Vercel serverless function to get Paystack checkout URL
    const response = await fetch("/api/create-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: sessionRef.id,
        email:     email,
        amount:    price,
        itemName:  itemName,
        itemType:  type,
        itemId:    itemId,
        userId:    currentUser?.uid,
      }),
    });

    const data = await response.json();

    if (!data.success || !data.authorizationUrl) {
      throw new Error(data.error || "Failed to create payment session");
    }

    // Redirect to Paystack
    window.location.href = data.authorizationUrl;

  } catch (e) {
    console.error("Checkout error", e);
    showToast({ title: "Payment Error", message: e.message || "Could not start payment. Please try again.", type: "error" });
  } finally {
    if (btn) { btn.classList.remove("loading"); btn.disabled = false; }
  }
}
