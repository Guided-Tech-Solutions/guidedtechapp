/* ============================================================
   FILE: app/portal-services.js
   Page 1 — Services & Pricing with Stripe + Vercel integration
   WITH BEAUTIFUL AUTH MODAL
   ============================================================ */

import { db, auth } from "../admin/firebase.js";
import { authReady, currentUser, esc, fmtPrice } from "./portal-layout.js";
import {
  collection, getDocs, query, where, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

const loadText = document.getElementById("loadText");

/* ══════════════════════════════
   STRIPE CHECKOUT INTEGRATION
══════════════════════════════ */

/* ── Load Stripe.js and fetch publishable key from backend ── */
let stripe = null;
let stripeKeyLoaded = false;

const stripeScript = document.createElement("script");
stripeScript.src = "https://js.stripe.com/v3/";
stripeScript.onload = async () => {
  try {
    // Fetch publishable key from backend API
    const response = await fetch('/api/get-stripe-key');
    
    if (!response.ok) {
      throw new Error('Failed to load Stripe configuration');
    }
    
    const { publishableKey } = await response.json();
    
    if (!publishableKey) {
      throw new Error('Stripe key not available');
    }
    
    // Initialize Stripe with the key
    stripe = window.Stripe(publishableKey);
    stripeKeyLoaded = true;
    console.log('✅ Stripe initialized successfully');
    
  } catch (error) {
    console.error('❌ Failed to initialize Stripe:', error);
    stripeKeyLoaded = false;
  }
};
document.head.appendChild(stripeScript);

/* ══════════════════════════════
   RENDER HELPERS
══════════════════════════════ */
function renderServiceCard(svc, signedIn) {
  const price  = Number(svc.price) || 0;
  const period = svc.pricePeriod || "";
  return `
    <div class="svc-card" data-svc-id="${esc(svc.id)}">
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
      <button class="btn-subscribe"
        data-activate-svc="${esc(svc.id)}"
        data-svc-name="${esc(svc.name || "")}"
        data-svc-price="${price}"
        data-svc-type="service">
        Subscribe to Activate
      </button>
    </div>`;
}

function renderPlanCard(plan, signedIn) {
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
      <button class="btn-get-started"
        data-subscribe-plan="${esc(plan.id)}"
        data-plan-name="${esc(plan.name || "")}"
        data-plan-price="${price}"
        data-plan-billing="${billing}"
        data-svc-type="plan">
        Get Started
      </button>
    </div>`;
}

/* ══════════════════════════════
   LOAD DATA
══════════════════════════════ */
async function loadServices(signedIn) {
  const flow  = document.getElementById("servicesFlow");
  const empty = document.getElementById("servicesEmpty");
  if (!flow) return;

  try {
    const snap = await getDocs(query(collection(db, "services"), where("active", "==", true)));
    const items = [];
    snap.forEach(doc => items.push({ id: doc.id, ...doc.data() }));

    if (!items.length) {
      flow.innerHTML = "";
      empty.style.display = "block";
    } else {
      empty.style.display = "none";
      flow.innerHTML = items.map(s => renderServiceCard(s, signedIn)).join("");
    }
  } catch (err) {
    console.error("Load services:", err);
    flow.innerHTML = `<p style="color:var(--muted);font-size:13px;padding:20px 0">Failed to load services.</p>`;
  } finally {
    flow.removeAttribute("aria-busy");
  }
}

async function loadPlans(signedIn) {
  const grid  = document.getElementById("plansGrid");
  const empty = document.getElementById("plansEmpty");
  if (!grid) return;

  try {
    const snap = await getDocs(query(collection(db, "plans"), where("active", "==", true)));
    const items = [];
    snap.forEach(doc => items.push({ id: doc.id, ...doc.data() }));

    if (!items.length) {
      grid.innerHTML = "";
      empty.style.display = "block";
    } else {
      empty.style.display = "none";
      grid.innerHTML = items.map(p => renderPlanCard(p, signedIn)).join("");
    }
  } catch (err) {
    console.error("Load plans:", err);
    grid.innerHTML = `<p style="color:var(--muted);font-size:13px;padding:20px 0">Failed to load plans.</p>`;
  } finally {
    grid.removeAttribute("aria-busy");
  }
}

/* ══════════════════════════════
   BEAUTIFUL AUTH MODAL
══════════════════════════════ */
function showAuthModal(itemData) {
  // Save purchase intent to localStorage
  if (itemData) {
    localStorage.setItem('pendingPurchase', JSON.stringify(itemData));
  }

  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.7);
    backdrop-filter: blur(5px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    animation: fadeIn 0.3s ease;
  `;

  const itemName = itemData?.name || 'this service';
  const itemPrice = itemData?.price ? `$${itemData.price}` : '';

  modal.innerHTML = `
    <div style="
      background: white;
      border-radius: 20px;
      padding: 48px 40px;
      max-width: 520px;
      width: 90%;
      box-shadow: 0 25px 70px rgba(0,0,0,0.4);
      animation: slideUp 0.4s ease;
      text-align: center;
    ">
      <div style="
        width: 80px;
        height: 80px;
        background: linear-gradient(135deg, #1B4F72, #2471a3);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0 auto 24px;
        font-size: 40px;
        box-shadow: 0 8px 20px rgba(27, 79, 114, 0.3);
      ">🔐</div>
      
      <h2 style="
        font-family: 'Poppins', sans-serif;
        font-size: 26px;
        font-weight: 700;
        color: #0f172a;
        margin-bottom: 14px;
      ">Create Account to Continue</h2>
      
      <div style="
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 16px;
        margin-bottom: 20px;
        text-align: left;
      ">
        <div style="font-size: 13px; color: #64748b; margin-bottom: 8px;">You're purchasing:</div>
        <div style="font-size: 16px; font-weight: 600; color: #0f172a;">${esc(itemName)}</div>
        ${itemPrice ? `<div style="font-size: 15px; color: #1B4F72; margin-top: 4px;">${itemPrice}</div>` : ''}
      </div>
      
      <p style="
        color: #64748b;
        font-size: 15px;
        line-height: 1.6;
        margin-bottom: 24px;
      ">We need to create an account for you to:</p>
      
      <ul style="
        text-align: left;
        color: #475569;
        font-size: 14px;
        line-height: 1.8;
        margin-bottom: 28px;
        list-style: none;
        padding: 0;
      ">
        <li style="margin-bottom: 8px;">✓ Manage your subscription</li>
        <li style="margin-bottom: 8px;">✓ Access your services dashboard</li>
        <li style="margin-bottom: 8px;">✓ Track your payments and invoices</li>
        <li>✓ Get support when you need it</li>
      </ul>
      
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <button id="authModalSignUp" style="
          padding: 14px 32px;
          border: none;
          background: linear-gradient(135deg, #1B4F72, #2471a3);
          color: white;
          border-radius: 12px;
          font-weight: 600;
          cursor: pointer;
          font-size: 15px;
          font-family: 'Inter', sans-serif;
          transition: all 0.2s;
          box-shadow: 0 4px 12px rgba(27, 79, 114, 0.3);
        ">Create Account & Continue</button>
        
        <button id="authModalSignIn" style="
          padding: 14px 32px;
          border: 2px solid #e2e8f0;
          background: white;
          color: #475569;
          border-radius: 12px;
          font-weight: 600;
          cursor: pointer;
          font-size: 15px;
          font-family: 'Inter', sans-serif;
          transition: all 0.2s;
        ">Already have an account? Sign In</button>
        
        <button id="authModalCancel" style="
          padding: 10px;
          border: none;
          background: transparent;
          color: #94a3b8;
          font-weight: 500;
          cursor: pointer;
          font-size: 14px;
          font-family: 'Inter', sans-serif;
          margin-top: 8px;
        ">Cancel</button>
      </div>
    </div>
  `;

  const style = document.createElement('style');
  style.textContent = `
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes slideUp {
      from { transform: translateY(30px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    #authModalSignUp:hover { 
      background: linear-gradient(135deg, #154360, #1e5f88);
      transform: translateY(-2px);
      box-shadow: 0 6px 16px rgba(27, 79, 114, 0.4);
    }
    #authModalSignIn:hover { 
      background: #f8fafc;
      border-color: #cbd5e1;
    }
    #authModalCancel:hover { 
      color: #64748b;
      text-decoration: underline;
    }
  `;
  document.head.appendChild(style);

  document.body.appendChild(modal);

  // Sign Up button - redirect to user signup page
  modal.querySelector('#authModalSignUp').onclick = () => {
    window.location.href = '/app/signup.html?redirect=' + encodeURIComponent(window.location.pathname);
  };

  // Sign In button - redirect to user login page
  modal.querySelector('#authModalSignIn').onclick = () => {
    window.location.href = '/app/login.html?redirect=' + encodeURIComponent(window.location.pathname);
  };

  // Cancel button
  modal.querySelector('#authModalCancel').onclick = () => {
    localStorage.removeItem('pendingPurchase');
    document.body.removeChild(modal);
    document.head.removeChild(style);
  };

  // Click outside to close
  modal.onclick = (e) => {
    if (e.target === modal) {
      localStorage.removeItem('pendingPurchase');
      document.body.removeChild(modal);
      document.head.removeChild(style);
    }
  };
}

/* ══════════════════════════════
   AUTH CHECK → STRIPE CHECKOUT
══════════════════════════════ */
async function initiateCheckout(itemData) {
  // 1. Check if user is signed in
  if (!currentUser) {
    showAuthModal(itemData); // Show modal with item details and save to localStorage
    return;
  }

  // 2. Create checkout session document in Firestore
  const checkoutData = {
    userId:    currentUser.uid,
    userEmail: currentUser.email,
    itemType:  itemData.type,
    itemId:    itemData.id,
    itemName:  itemData.name,
    price:     itemData.price,
    billing:   itemData.billing || null,
    status:    "pending",
    createdAt: serverTimestamp(),
  };

  try {
    const docRef = await addDoc(collection(db, "checkoutSessions"), checkoutData);

    // 3. Call Vercel API to create Stripe session
    const response = await fetch("/api/create-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: docRef.id }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("API Error:", errorData);
      alert(`Failed to create checkout: ${errorData.error || 'Unknown error'}`);
      return;
    }

    const result = await response.json();

    if (!result.success || !result.sessionId) {
      console.error("Invalid API response:", result);
      alert("Failed to create checkout session. Please try again.");
      return;
    }

    // 4. Redirect to Stripe Checkout
    if (!stripe || !stripeKeyLoaded) {
      alert("Payment system is still loading. Please wait a moment and try again.");
      return;
    }

    console.log("Redirecting to Stripe with session:", result.sessionId);

    const { error } = await stripe.redirectToCheckout({ sessionId: result.sessionId });
    if (error) {
      console.error("Stripe redirect error:", error);
      alert(`Payment redirect failed: ${error.message}`);
    }

  } catch (err) {
    console.error("Checkout error:", err);
    alert("Failed to start checkout. Please try again.");
  }
}

/* ══════════════════════════════
   BUTTON CLICK HANDLERS
══════════════════════════════ */
document.addEventListener("click", e => {
  // Service activation
  const svcBtn = e.target.closest("[data-activate-svc]");
  if (svcBtn) {
    e.preventDefault();
    svcBtn.disabled = true;
    svcBtn.textContent = "Processing…";

    initiateCheckout({
      type: "service",
      id:   svcBtn.dataset.activateSvc,
      name: svcBtn.dataset.svcName,
      price: parseFloat(svcBtn.dataset.svcPrice) || 0,
    }).finally(() => {
      svcBtn.disabled = false;
      svcBtn.textContent = "Subscribe to Activate";
    });
    return;
  }

  // Plan subscription
  const planBtn = e.target.closest("[data-subscribe-plan]");
  if (planBtn) {
    e.preventDefault();
    planBtn.disabled = true;
    planBtn.textContent = "Processing…";

    initiateCheckout({
      type:    "plan",
      id:      planBtn.dataset.subscribePlan,
      name:    planBtn.dataset.planName,
      price:   parseFloat(planBtn.dataset.planPrice) || 0,
      billing: planBtn.dataset.planBilling,
    }).finally(() => {
      planBtn.disabled = false;
      planBtn.textContent = "Get Started";
    });
  }
});

/* ══════════════════════════════
   BOOT
══════════════════════════════ */
document.addEventListener("DOMContentLoaded", async () => {
  loadText.textContent = "Loading…";
  const user = await authReady;

  loadText.textContent = "Loading services…";
  await loadServices(!!user);

  loadText.textContent = "Loading plans…";
  await loadPlans(!!user);

  loadText.textContent = "Ready";

  // Check if user just logged in and has a pending purchase
  if (user) {
    const pendingPurchase = localStorage.getItem('pendingPurchase');
    if (pendingPurchase) {
      try {
        const itemData = JSON.parse(pendingPurchase);
        localStorage.removeItem('pendingPurchase');
        
        // Small delay to let the page finish loading
        setTimeout(() => {
          loadText.textContent = "Continuing to checkout…";
          initiateCheckout(itemData);
        }, 500);
      } catch (err) {
        console.error('Error resuming purchase:', err);
        localStorage.removeItem('pendingPurchase');
      }
    }
  }
});
