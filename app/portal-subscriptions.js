/* ============================================================
   FILE: portal-subscriptions.js
   My Subscriptions page logic
   ============================================================ */

import { db } from "./firebase.js";
import { authReady, currentUser, esc, fmtPrice } from "./portal-layout.js";
import {
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

const activeSubscriptions = document.getElementById("activeSubscriptions");
const emptySubscriptions = document.getElementById("emptySubscriptions");
const loadingSubscriptions = document.getElementById("loadingSubscriptions");
const subscriptionsGrid = document.getElementById("subscriptionsGrid");

function renderSubscriptionCard(subscription) {
  const price = Number(subscription.price) || 0;
  const billing = subscription.billingPeriod || subscription.period || "month";
  const status = subscription.status || "active";
  const since = subscription.createdAt?.toDate 
    ? subscription.createdAt.toDate().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "—";

  const statusClass = status === "active" ? "badge-success" : 
                      status === "pending" ? "badge-warning" : "";

  return `
    <div class="subscription-card">
      <div class="subscription-header">
        <h3 class="subscription-title">${esc(subscription.planName || subscription.serviceName || "Subscription")}</h3>
        <span class="badge ${statusClass}">${status.charAt(0).toUpperCase() + status.slice(1)}</span>
      </div>
      
      <div class="subscription-details">
        <div class="detail-row">
          <span class="detail-label">Price:</span>
          <span class="detail-value">$${esc(fmtPrice(price))} / ${esc(billing)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Started:</span>
          <span class="detail-value">${since}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Type:</span>
          <span class="detail-value">${subscription.type === "plan" ? "Subscription Plan" : "Individual Service"}</span>
        </div>
      </div>
    </div>
  `;
}

async function loadSubscriptions(userId) {
  try {
    const subscriptions = [];

    // Load plans
    const plansQuery = query(
      collection(db, "checkoutSessions"), 
      where("userId", "==", userId)
    );
    const plansSnapshot = await getDocs(plansQuery);
    plansSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.status === "active" || data.status === "pending") {
        subscriptions.push({ id: doc.id, type: "plan", ...data });
      }
    });

    // Load individual services
    const servicesQuery = query(
      collection(db, "serviceActivations"), 
      where("userId", "==", userId)
    );
    const servicesSnapshot = await getDocs(servicesQuery);
    servicesSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.status === "active" || data.status === "pending") {
        subscriptions.push({ id: doc.id, type: "service", ...data });
      }
    });

    loadingSubscriptions.style.display = "none";

    if (subscriptions.length === 0) {
      emptySubscriptions.style.display = "block";
      activeSubscriptions.style.display = "none";
    } else {
      emptySubscriptions.style.display = "none";
      activeSubscriptions.style.display = "block";
      subscriptionsGrid.innerHTML = subscriptions.map(s => renderSubscriptionCard(s)).join("");
      console.log(`✅ Loaded ${subscriptions.length} subscriptions`);
    }

  } catch (error) {
    console.error("❌ Error loading subscriptions:", error);
    loadingSubscriptions.style.display = "none";
    emptySubscriptions.style.display = "block";
  }
}

// Initialize page
document.addEventListener("DOMContentLoaded", async () => {
  console.log('🔄 Loading subscriptions page...');
  const user = await authReady;
  
  if (!user) {
    console.log('⚠️ User not authenticated');
    loadingSubscriptions.style.display = "none";
    emptySubscriptions.style.display = "block";
    return;
  }
  
  console.log('✅ User authenticated, loading subscriptions...');
  await loadSubscriptions(user.uid);
});
