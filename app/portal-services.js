/* ================================================================
   FILE: app/portal-services.js  —  GTS Amplify Services Page
   Services catalog, bundles, consultation booking,
   multi-provider payment (Paystack, Stripe, PayPal)
   ================================================================ */
import { db } from "./firebase.js";
import {
  authReady, currentUser, requireAuth,
  esc, fmtMoney, fmtDate, showToast, openModal, closeModal, getDashboardType
} from "./portal-layout.js";
import {
  collection, getDocs, addDoc, doc, getDoc, setDoc,
  query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

/* ── State ─────────────────────────────────────────────────── */
let allServices    = [];
let allPlans       = [];
let consultPricing = { free: 0, paid: 15 };
let activeSubs     = new Set();
let billingMode    = "monthly";
let planBilling    = "monthly";
let pendingItem    = null;   // { type, id, name, price, billing }
let selectedProvider = "paystack";
let consultProvider  = "paystack";

/* ── Init ──────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", async () => {
  setupTabs();
  setupBillingToggles();
  setupPaymentSelectors();
  setupConsultModal();
  setupSubscribeModal();

  const user = await authReady;
  if (user) await loadActiveSubs(user.uid);

  await Promise.all([loadServices(), loadPlans(), loadConsultPricing()]);

  document.getElementById("btnFreeCall")?.addEventListener("click", () => openConsultModal("free"));
  document.getElementById("btnStrategySession")?.addEventListener("click", () => openConsultModal("paid"));
});

/* ── Tabs ──────────────────────────────────────────────────── */
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

/* ── Billing toggles ────────────────────────────────────────── */
function setupBillingToggles() {
  document.querySelectorAll(".billing-toggle:first-of-type .billing-opt").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".billing-toggle:first-of-type .billing-opt").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      billingMode = btn.dataset.billing;
      renderServices();
    });
  });
  document.querySelectorAll("#plansBillingToggle .billing-opt").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#plansBillingToggle .billing-opt").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      planBilling = btn.dataset.billing;
      renderPlans();
    });
  });
}

/* ── Payment provider selectors ─────────────────────────────── */
function setupPaymentSelectors() {
  document.querySelectorAll("#paymentOptions .payment-option").forEach(opt => {
    opt.addEventListener("click", () => {
      document.querySelectorAll("#paymentOptions .payment-option").forEach(o => o.classList.remove("selected"));
      opt.classList.add("selected");
      selectedProvider = opt.dataset.provider;
    });
  });
  document.querySelectorAll("#consultPaymentOptions .payment-option").forEach(opt => {
    opt.addEventListener("click", () => {
      document.querySelectorAll("#consultPaymentOptions .payment-option").forEach(o => o.classList.remove("selected"));
      opt.classList.add("selected");
      consultProvider = opt.dataset.provider;
    });
  });
}

/* ── Load active subscriptions ──────────────────────────────── */
async function loadActiveSubs(uid) {
  try {
    const [s1, s2] = await Promise.all([
      getDocs(query(collection(db,"serviceActivations"), where("userId","==",uid), where("status","==","active"))),
      getDocs(query(collection(db,"userSubscriptions"),  where("userId","==",uid), where("status","==","active"))),
    ]);
    s1.forEach(d => activeSubs.add(d.data().serviceId));
    s2.forEach(d => activeSubs.add(d.data().planId));
  } catch(e) {}
}

/* ── Load services ──────────────────────────────────────────── */
async function loadServices() {
  try {
    const snap = await getDocs(query(collection(db,"services"), where("active","==",true)));
    allServices = [];
    snap.forEach(d => allServices.push({ id:d.id, ...d.data() }));
    renderServices();
  } catch(e) {
    document.getElementById("servicesGrid").innerHTML =
      `<div class="empty-state"><div class="empty-icon">⚠️</div><p class="empty-text">Could not load services. Please refresh.</p></div>`;
  }
}

function renderServices() {
  const grid  = document.getElementById("servicesGrid");
  const empty = document.getElementById("servicesEmpty");
  const svcs  = allServices.filter(s => s.dashboardType !== "consultation");
  if (!svcs.length) { grid.innerHTML=""; empty.style.display="block"; return; }
  empty.style.display = "none";
  const isYearly = billingMode === "yearly";
  grid.innerHTML = svcs.map(s => {
    const basePrice = Number(s.price) || 0;
    const price     = isYearly ? Math.round(basePrice * 12 * 0.8) : basePrice;
    const period    = isYearly ? "year" : (s.pricePeriod || "month");
    const subbed    = activeSubs.has(s.id);
    const features  = Array.isArray(s.features) ? s.features : [];
    return `<div class="service-card ${subbed?"subscribed":""}">
      ${s.featured?`<div class="service-card-badge"><span class="badge badge-brand">Popular</span></div>`:""}
      ${s.isNew?`<div class="service-card-badge"><span class="badge badge-accent">New</span></div>`:""}
      <div class="service-card-icon">${esc(s.icon||"⚙️")}</div>
      <div class="service-card-name">${esc(s.name)}</div>
      <div class="service-card-desc">${esc(s.description||"")}</div>
      ${features.length?`<div class="service-card-features">${features.slice(0,4).map(f=>`<div class="service-feature">${esc(f)}</div>`).join("")}</div>`:""}
      <div class="service-card-price">
        <span class="price-val">${fmtMoney(price)}</span>
        <span class="price-per">/ ${period}</span>
        ${isYearly&&basePrice>0?`<span class="price-was">${fmtMoney(basePrice*12)}</span>`:""}
      </div>
      ${subbed
        ? `<button class="btn-subscribe active" disabled>✓ Active</button>`
        : `<button class="btn-subscribe" onclick="window._initCheckout('service','${s.id}','${esc(s.name).replace(/'/g,"\\'")}',${price},'${period}')">Get Started</button>`}
    </div>`;
  }).join("");
}

/* ── Load plans ─────────────────────────────────────────────── */
async function loadPlans() {
  try {
    const snap = await getDocs(query(collection(db,"plans"), where("active","==",true)));
    allPlans = [];
    snap.forEach(d => allPlans.push({ id:d.id, ...d.data() }));
    renderPlans();
  } catch(e) {}
}

function renderPlans() {
  const grid  = document.getElementById("plansGrid");
  const empty = document.getElementById("plansEmpty");
  if (!allPlans.length) { grid.innerHTML=""; empty.style.display="block"; return; }
  empty.style.display = "none";
  const isYearly = planBilling === "yearly";
  grid.innerHTML = allPlans.map(p => {
    const monthly  = Number(p.priceMonthly) || 0;
    const yearly   = Number(p.priceYearly)  || Math.round(monthly*12*0.8);
    const price    = isYearly ? yearly : monthly;
    const period   = isYearly ? "year" : "month";
    const subbed   = activeSubs.has(p.id);
    const features = Array.isArray(p.features) ? p.features : [];
    return `<div class="plan-card ${p.popular?"featured":""}">
      <div class="plan-card-top">
        ${p.popular?`<div class="plan-popular-tag">Most Popular</div>`:""}
        <div class="plan-name">${esc(p.name)}</div>
        <div class="plan-tagline">${esc(p.tagline||p.description||"")}</div>
        <div>
          <span class="plan-price">${fmtMoney(price)}</span>
          <span class="plan-price-per">/ ${period}</span>
        </div>
      </div>
      <div class="plan-card-body">
        <div class="plan-features">
          ${features.map(f=>`<div class="plan-feature"><span class="plan-feature-check">✓</span><span>${esc(f)}</span></div>`).join("")}
        </div>
        ${subbed
          ? `<button class="btn btn-success btn-block" disabled>✓ Active Plan</button>`
          : `<button class="btn btn-primary btn-block" onclick="window._initCheckout('plan','${p.id}','${esc(p.name).replace(/'/g,"\\'")}',${price},'${period}')">Choose Plan</button>`}
      </div>
    </div>`;
  }).join("");
}

/* ── Load consultation pricing ──────────────────────────────── */
async function loadConsultPricing() {
  try {
    const snap = await getDocs(collection(db,"consultationPricing"));
    snap.forEach(d => {
      const data = d.data();
      if (data.type === "paid")  consultPricing.paid  = Number(data.price) || 15;
      if (data.type === "free")  consultPricing.free  = 0;
    });
  } catch(e) {}
  renderConsultationTab();
}

function renderConsultationTab() {
  document.getElementById("consultGrid").innerHTML = `
    <div class="service-card">
      <div class="service-card-icon">📞</div>
      <div class="service-card-name">Free Discovery Call</div>
      <div class="service-card-desc">A complimentary 30-minute call with a GTS Amplify expert. We'll understand your needs and suggest the right services — no commitment required.</div>
      <div class="service-card-features">
        <div class="service-feature">30-minute video call</div>
        <div class="service-feature">Business needs assessment</div>
        <div class="service-feature">Tailored service recommendations</div>
        <div class="service-feature">Q&amp;A with our experts</div>
      </div>
      <div class="service-card-price">
        <span class="price-val" style="color:var(--success)">Free</span>
      </div>
      <button class="btn-subscribe" style="background:var(--success)" onclick="window.openConsultModal('free')">📅 Book Free Call</button>
    </div>
    <div class="service-card" style="border-color:var(--brand)">
      <div class="service-card-badge"><span class="badge badge-brand">Recommended</span></div>
      <div class="service-card-icon">💼</div>
      <div class="service-card-name">Strategy Session</div>
      <div class="service-card-desc">An in-depth 60-minute session for businesses ready to transform. Includes a custom technology roadmap and written action plan delivered after the session.</div>
      <div class="service-card-features">
        <div class="service-feature">60-minute intensive session</div>
        <div class="service-feature">Deep-dive business analysis</div>
        <div class="service-feature">Custom technology roadmap</div>
        <div class="service-feature">Written action plan delivered</div>
        <div class="service-feature">30-day email follow-up support</div>
      </div>
      <div class="service-card-price">
        <span class="price-val">${fmtMoney(consultPricing.paid)}</span>
        <span class="price-per">/ session</span>
      </div>
      <button class="btn-subscribe" onclick="window.openConsultModal('paid')">💼 Book Strategy Session</button>
    </div>`;
}

/* ── Checkout flow ──────────────────────────────────────────── */
window._initCheckout = function(type, id, name, price, billing) {
  if (!currentUser) {
    showToast({ title:"Sign in required", message:"Please log in to subscribe.", type:"warning" });
    setTimeout(() => window.location.href = "./login.html?redirect=./portal-services.html", 1500);
    return;
  }
  pendingItem = { type, id, name, price, billing };
  document.getElementById("subscribeTitle").textContent = `Subscribe — ${name}`;
  document.getElementById("subscribeContent").innerHTML = `
    <div style="text-align:center;padding:.875rem 0">
      <div style="font-size:2.5rem;margin-bottom:.75rem">${type==="plan"?"📦":"⚙️"}</div>
      <div style="font-family:var(--ff-d);font-size:1.125rem;font-weight:700;margin-bottom:.25rem">${esc(name)}</div>
      <div style="color:var(--text-muted);font-size:.875rem;margin-bottom:1rem">${billing === "once" ? "One-time payment" : `Billed ${billing}ly`}</div>
      <div style="font-family:var(--ff-d);font-size:2.25rem;font-weight:900;color:var(--brand)">${fmtMoney(price)}</div>
    </div>
    <div style="background:var(--brand-pale);border-radius:var(--r-sm);padding:.75rem;font-size:.8125rem;color:var(--brand);margin-top:1rem">
      🔒 Secure checkout. You'll be redirected to complete payment.
    </div>`;
  openModal("subscribeModal");
};

function setupSubscribeModal() {
  document.getElementById("btnConfirmSubscribe")?.addEventListener("click", async () => {
    if (!pendingItem) return;
    const btn = document.getElementById("btnConfirmSubscribe");
    btn.classList.add("is-loading"); btn.disabled = true;
    closeModal("subscribeModal");
    await processPayment({ ...pendingItem, email: currentUser?.email, provider: selectedProvider });
    pendingItem = null;
    btn.classList.remove("is-loading"); btn.disabled = false;
  });
}

/* ── Consultation modal ─────────────────────────────────────── */
window.openConsultModal = function(type) {
  const isPaid = type === "paid";
  document.getElementById("consultModalTitle").textContent = isPaid ? "Book Strategy Session" : "Book Free Discovery Call";
  document.getElementById("consultType").value = type;
  document.getElementById("consultPaidSection").style.display = isPaid ? "block" : "none";
  if (isPaid) document.getElementById("consultFeeDisplay").textContent = fmtMoney(consultPricing.paid);
  if (currentUser) {
    document.getElementById("consultName").value  = currentUser.displayName || "";
    document.getElementById("consultEmail").value = currentUser.email || "";
  }
  openModal("consultModal");
};

function setupConsultModal() {
  document.getElementById("consultType")?.addEventListener("change", function() {
    const isPaid = this.value === "paid";
    document.getElementById("consultPaidSection").style.display = isPaid ? "block" : "none";
    if (isPaid) document.getElementById("consultFeeDisplay").textContent = fmtMoney(consultPricing.paid);
  });

  document.getElementById("btnConfirmConsult")?.addEventListener("click", async () => {
    const btn   = document.getElementById("btnConfirmConsult");
    const name  = document.getElementById("consultName").value.trim();
    const email = document.getElementById("consultEmail").value.trim();
    const type  = document.getElementById("consultType").value;
    const dt    = document.getElementById("consultDate").value;
    const notes = document.getElementById("consultNotes").value.trim();
    const phone = document.getElementById("consultPhone").value.trim();

    if (!name || !email) { showToast({ title:"Missing info", message:"Name and email are required.", type:"warning" }); return; }

    btn.classList.add("is-loading"); btn.disabled = true;
    try {
      const isPaid = type === "paid";
      const price  = isPaid ? consultPricing.paid : 0;

      const ref = await addDoc(collection(db,"consultationBookings"), {
        userId:        currentUser?.uid || null,
        userName:      name, userEmail: email, userPhone: phone || null,
        sessionType:   type, price, preferredDate: dt || null,
        notes: notes || null, provider: consultProvider || "paystack",
        status:        isPaid ? "pending_payment" : "confirmed",
        createdAt:     serverTimestamp(),
      });

      if (isPaid && price > 0) {
        closeModal("consultModal");
        await processPayment({
          type: "consultation", id: ref.id, name: "Strategy Session",
          price, billing: "once", email, provider: consultProvider,
        });
      } else {
        closeModal("consultModal");
        showToast({ title:"Booking Confirmed! 🎉", message:"We'll reach out within 24 hours to confirm your call time.", type:"success", duration:6000 });
      }
    } catch(e) {
      console.error("Booking error", e);
      showToast({ title:"Booking failed", message:"Please try again.", type:"error" });
    } finally {
      btn.classList.remove("is-loading"); btn.disabled = false;
    }
  });
}

/* ── Multi-provider payment ─────────────────────────────────── */
async function processPayment({ type, id, name, price, billing, email, provider }) {
  if (!email) email = currentUser?.email;
  try {
    // Save checkout session
    const sessionRef = await addDoc(collection(db,"checkoutSessions"), {
      userId: currentUser?.uid || null, userEmail: email,
      itemType: type, itemId: id, itemName: name,
      price, billing, provider: provider || "paystack",
      status: "pending", createdAt: serverTimestamp(),
    });

    const res = await fetch("/api/create-checkout", {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({
        sessionId: sessionRef.id, email, amount: price,
        itemName: name, itemType: type, itemId: id,
        userId: currentUser?.uid, provider: provider || "paystack",
      }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Checkout failed");

    // Different providers return different URL keys
    const url = data.authorizationUrl || data.checkoutUrl || data.approvalUrl;
    if (url) {
      window.location.href = url;
    } else {
      throw new Error("No redirect URL returned from payment provider");
    }
  } catch(e) {
    console.error("Payment error", e);
    showToast({ title:"Payment Error", message: e.message || "Could not start payment. Please try again.", type:"error" });
  }
}
