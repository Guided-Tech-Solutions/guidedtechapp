/* ============================================================
   FILE: portal-services.js
   Services page logic
   ============================================================ */

import { db } from "./firebase.js";
import { authReady, currentUser, esc, fmtPrice } from "./portal-layout.js";
import {
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

const servicesGrid = document.getElementById("servicesGrid");
const emptyState = document.getElementById("emptyState");

function renderServiceCard(service) {
  const price = Number(service.price) || 0;
  const period = service.pricePeriod || "month";
  
  return `
    <div class="service-card">
      <div class="service-icon">${esc(service.icon || "⚙️")}</div>
      <h3 class="service-name">${esc(service.name || "Service")}</h3>
      <p class="service-description">${esc(service.description || "")}</p>
      <div class="service-price">
        <span class="price-amount">$${esc(fmtPrice(price))}</span>
        <span class="price-period">/${esc(period)}</span>
      </div>
      <button class="btn-subscribe" onclick="alert('Subscription feature coming soon!')">
        Subscribe Now
      </button>
    </div>
  `;
}

async function loadServices() {
  try {
    const q = query(collection(db, "services"), where("active", "==", true));
    const snapshot = await getDocs(q);
    
    const services = [];
    snapshot.forEach(doc => {
      services.push({ id: doc.id, ...doc.data() });
    });
    
    if (services.length === 0) {
      servicesGrid.innerHTML = "";
      emptyState.style.display = "block";
    } else {
      emptyState.style.display = "none";
      servicesGrid.innerHTML = services.map(s => renderServiceCard(s)).join("");
    }
    
    console.log(`✅ Loaded ${services.length} services`);
  } catch (error) {
    console.error("❌ Error loading services:", error);
    servicesGrid.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <h3 class="empty-title">Error Loading Services</h3>
        <p class="empty-text">Please try again later</p>
      </div>
    `;
  }
}

// Initialize page
document.addEventListener("DOMContentLoaded", async () => {
  console.log('🔄 Loading services page...');
  const user = await authReady;
  
  if (user) {
    console.log('✅ User authenticated');
  } else {
    console.log('ℹ️ User not authenticated');
  }
  
  await loadServices();
});
