/* ============================================================
   FILE: portal-dashboard.js
   Dashboard page logic with KPIs and analytics
   ============================================================ */

import { db } from "./firebase.js";
import { authReady, currentUser, esc, fmtPrice } from "./portal-layout.js";
import {
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

const statServices = document.getElementById("statServices");
const statPlan = document.getElementById("statPlan");
const statSince = document.getElementById("statSince");
const recentActivity = document.getElementById("recentActivity");
const emptyActivity = document.getElementById("emptyActivity");

function renderActivityCard(subscription) {
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
      </div>
    </div>
  `;
}

async function loadDashboard(user) {
  try {
    const subscriptions = [];

    // Load plans
    const plansQuery = query(
      collection(db, "checkoutSessions"), 
      where("userId", "==", user.uid)
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
      where("userId", "==", user.uid)
    );
    const servicesSnapshot = await getDocs(servicesQuery);
    servicesSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.status === "active" || data.status === "pending") {
        subscriptions.push({ id: doc.id, type: "service", ...data });
      }
    });

    // Update stats
    if (statServices) statServices.textContent = subscriptions.length;
    
    if (statPlan) {
      const planSub = subscriptions.find(s => s.type === "plan");
      statPlan.textContent = planSub?.planName || subscriptions[0]?.serviceName || "Free";
    }

    if (statSince && user.metadata?.creationTime) {
      const createdDate = new Date(user.metadata.creationTime);
      statSince.textContent = createdDate.toLocaleDateString("en-US", { month: "short", year: "numeric" });
    }

    // Show recent activity
    if (subscriptions.length === 0) {
      recentActivity.innerHTML = "";
      emptyActivity.style.display = "block";
    } else {
      emptyActivity.style.display = "none";
      const recent = subscriptions.slice(0, 3); // Show last 3
      recentActivity.innerHTML = recent.map(s => renderActivityCard(s)).join("");
    }

    console.log(`✅ Dashboard loaded: ${subscriptions.length} subscriptions`);

  } catch (error) {
    console.error("❌ Error loading dashboard:", error);
    recentActivity.innerHTML = "";
    emptyActivity.style.display = "block";
  }
}

// Initialize page
document.addEventListener("DOMContentLoaded", async () => {
  console.log('🔄 Loading dashboard...');
  const user = await authReady;
  
  if (!user) {
    console.log('⚠️ User not authenticated');
    if (statServices) statServices.textContent = "0";
    if (statPlan) statPlan.textContent = "None";
    if (statSince) statSince.textContent = "—";
    recentActivity.innerHTML = "";
    emptyActivity.style.display = "block";
    return;
  }
  
  console.log('✅ User authenticated, loading dashboard...');
  await loadDashboard(user);
});
