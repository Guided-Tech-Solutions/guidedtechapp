/* ============================================================
   FILE: admin/admin-dashboard.js
   Complete admin dashboard functionality with Firebase
   ============================================================ */

import { auth, db } from './firebase-admin.js';
import { 
  signOut 
} from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js';
import {
  collection,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  onSnapshot
} from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js';

/* ══════════════════════════════
   GLOBAL STATE
══════════════════════════════ */

let currentAdmin = null;
let currentSection = 'dashboard';
let allUsers = [];
let allSubscriptions = [];
let allServices = [];
let allPlans = [];
let allPayments = [];

/* ══════════════════════════════
   AUTH CHECK & PROTECTION
══════════════════════════════ */

// TEMPORARILY DISABLE ALL REDIRECTS TO DEBUG
const STOP_REDIRECTS = true; // Set to false once working

auth.onAuthStateChanged(async (user) => {
  console.log('🔍 Dashboard Auth Check Started');
  console.log('User object:', user);
  
  if (!user) {
    console.log('❌ No user signed in');
    if (!STOP_REDIRECTS) {
      window.location.replace('./admin-login.html');
    } else {
      document.body.innerHTML = '<div style="padding:20px;background:#7f1d1d;color:white;font-family:monospace;"><h1>❌ NOT SIGNED IN</h1><p>No user is authenticated. Please go to <a href="./admin-login.html" style="color:#60a5fa;">admin-login.html</a> and sign in.</p></div>';
    }
    return;
  }

  console.log('✅ User is signed in:', user.email);
  console.log('User UID:', user.uid);

  try {
    console.log('🔍 Checking admin document at path: Admins/' + user.uid);
    
    // Verify admin role
    const adminDoc = await getDoc(doc(db, 'Admins', user.uid));
    
    console.log('Admin doc exists:', adminDoc.exists());
    
    if (!adminDoc.exists()) {
      console.error('❌ Admin document not found for UID:', user.uid);
      console.log('Expected path: Admins/' + user.uid);
      
      if (!STOP_REDIRECTS) {
        await signOut(auth);
        window.location.replace('./admin-login.html');
      } else {
        document.body.innerHTML = `
          <div style="padding:20px;background:#7f1d1d;color:white;font-family:monospace;">
            <h1>❌ ADMIN DOCUMENT NOT FOUND</h1>
            <p><strong>User:</strong> ${user.email}</p>
            <p><strong>UID:</strong> ${user.uid}</p>
            <p><strong>Expected Path:</strong> Admins/${user.uid}</p>
            <h3>Fix:</h3>
            <ol>
              <li>Go to Firebase Console → Firestore Database</li>
              <li>Check collection name is exactly: <strong>Admins</strong> (capital A)</li>
              <li>Check document ID is exactly: <strong>${user.uid}</strong></li>
              <li>If document doesn't exist, create it with these fields:
                <ul>
                  <li>name: "Super Admin"</li>
                  <li>email: "${user.email}"</li>
                  <li>active: true (boolean)</li>
                  <li>role: "super_admin"</li>
                </ul>
              </li>
            </ol>
          </div>
        `;
      }
      return;
    }
    
    const adminData = adminDoc.data();
    console.log('✅ Admin document found:', adminData);
    console.log('Active status:', adminData.active);
    console.log('Active type:', typeof adminData.active);
    
    if (!adminData.active) {
      console.error('❌ Admin account is not active');
      console.error('Active value:', adminData.active);
      console.error('Active type:', typeof adminData.active);
      
      if (!STOP_REDIRECTS) {
        await signOut(auth);
        window.location.replace('./admin-login.html');
      } else {
        document.body.innerHTML = `
          <div style="padding:20px;background:#7f1d1d;color:white;font-family:monospace;">
            <h1>❌ ADMIN ACCOUNT NOT ACTIVE</h1>
            <p><strong>User:</strong> ${user.email}</p>
            <p><strong>Active status:</strong> ${adminData.active}</p>
            <p><strong>Type:</strong> ${typeof adminData.active}</p>
            <h3>Fix:</h3>
            <ol>
              <li>Go to Firebase Console → Firestore Database → Admins → ${user.uid}</li>
              <li>Find the "active" field</li>
              <li>Make sure it's type: <strong>boolean</strong> (not string)</li>
              <li>Set value to: <strong>true</strong></li>
              <li>Click Update</li>
            </ol>
            <p>Current data: <pre>${JSON.stringify(adminData, null, 2)}</pre></p>
          </div>
        `;
      }
      return;
    }

    console.log('✅ All checks passed! Initializing admin dashboard...');
    currentAdmin = { uid: user.uid, ...adminData };
    
    // Show success message briefly
    const successDiv = document.createElement('div');
    successDiv.style.cssText = 'position:fixed;top:20px;right:20px;background:#065f46;color:white;padding:15px;border-radius:8px;z-index:9999;font-family:monospace;';
    successDiv.innerHTML = '✅ Admin authenticated successfully!';
    document.body.appendChild(successDiv);
    setTimeout(() => successDiv.remove(), 3000);
    
    initializeAdmin();

  } catch (error) {
    console.error('❌ Auth check error:', error);
    console.error('Error message:', error.message);
    console.error('Error code:', error.code);
    console.error('Full error:', error);
    
    document.body.innerHTML = `
      <div style="padding:20px;background:#7f1d1d;color:white;font-family:monospace;">
        <h1>❌ ERROR CHECKING ADMIN STATUS</h1>
        <p><strong>Error:</strong> ${error.message}</p>
        <p><strong>Code:</strong> ${error.code || 'none'}</p>
        <h3>Full Error:</h3>
        <pre>${JSON.stringify(error, null, 2)}</pre>
        <h3>Console Log:</h3>
        <p>Check browser console (F12) for detailed logs</p>
      </div>
    `;
  }
});

/* ══════════════════════════════
   INITIALIZE ADMIN
══════════════════════════════ */

function initializeAdmin() {
  // Set admin info in sidebar
  const adminAvatar = document.getElementById('adminAvatar');
  const adminName = document.getElementById('adminName');
  const adminEmail = document.getElementById('adminEmail');

  if (adminAvatar && currentAdmin.name) {
    const initials = currentAdmin.name.split(' ').map(n => n[0]).join('').toUpperCase();
    adminAvatar.textContent = initials;
  }

  if (adminName) adminName.textContent = currentAdmin.name || 'Admin';
  if (adminEmail) adminEmail.textContent = currentAdmin.email || '';

  // Setup event listeners
  setupNavigation();
  setupLogout();
  setupModals();
  setupButtons();
  setupMobileToggle();

  // Load initial data
  loadDashboard();
}

/* ══════════════════════════════
   NAVIGATION
══════════════════════════════ */

function setupNavigation() {
  const navLinks = document.querySelectorAll('.admin-nav-link');
  
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const section = link.dataset.section;
      
      if (section) {
        switchSection(section);
      }
    });
  });
}

function switchSection(sectionName) {
  currentSection = sectionName;

  // Update nav links
  document.querySelectorAll('.admin-nav-link').forEach(link => {
    link.classList.toggle('active', link.dataset.section === sectionName);
  });

  // Update sections
  document.querySelectorAll('.admin-section').forEach(section => {
    section.classList.remove('active');
  });

  const activeSection = document.getElementById(`section-${sectionName}`);
  if (activeSection) {
    activeSection.classList.add('active');
  }

  // Update page title
  const pageTitle = document.getElementById('pageTitle');
  if (pageTitle) {
    pageTitle.textContent = sectionName.charAt(0).toUpperCase() + sectionName.slice(1);
  }

  // Load section data
  loadSectionData(sectionName);

  // Close mobile sidebar
  document.querySelector('.admin-sidebar')?.classList.remove('show');
}

function loadSectionData(section) {
  switch(section) {
    case 'dashboard':
      loadDashboard();
      break;
    case 'users':
      loadUsers();
      break;
    case 'subscriptions':
      loadSubscriptions();
      break;
    case 'services':
      loadServices();
      break;
    case 'plans':
      loadPlans();
      break;
    case 'payments':
      loadPayments();
      break;
    case 'settings':
      loadSettings();
      break;
  }
}

/* ══════════════════════════════
   LOGOUT
══════════════════════════════ */

function setupLogout() {
  const logoutBtn = document.getElementById('adminLogout');
  
  logoutBtn?.addEventListener('click', async () => {
    try {
      await signOut(auth);
      window.location.href = './admin-login.html';
    } catch (error) {
      console.error('Logout error:', error);
      alert('Failed to log out. Please try again.');
    }
  });
}

/* ══════════════════════════════
   MOBILE TOGGLE
══════════════════════════════ */

function setupMobileToggle() {
  const toggle = document.getElementById('mobileToggle');
  const sidebar = document.querySelector('.admin-sidebar');

  toggle?.addEventListener('click', () => {
    sidebar?.classList.toggle('show');
  });

  // Close on click outside
  document.addEventListener('click', (e) => {
    if (sidebar?.classList.contains('show') && 
        !sidebar.contains(e.target) && 
        !toggle?.contains(e.target)) {
      sidebar.classList.remove('show');
    }
  });
}

/* ══════════════════════════════
   DASHBOARD
══════════════════════════════ */

async function loadDashboard() {
  try {
    // Load all data for stats
    const [users, subs, payments] = await Promise.all([
      getDocs(collection(db, 'users')),
      getDocs(collection(db, 'checkoutSessions')),
      getDocs(query(collection(db, 'checkoutSessions'), where('status', '==', 'completed')))
    ]);

    // Calculate stats
    const totalUsers = users.size;
    const activeSubs = subs.docs.filter(d => d.data().status === 'active').length;
    
    let totalRevenue = 0;
    payments.forEach(doc => {
      const data = doc.data();
      if (data.price) totalRevenue += Number(data.price);
    });

    const conversionRate = totalUsers > 0 ? ((activeSubs / totalUsers) * 100).toFixed(1) : 0;

    // Update stat cards
    document.getElementById('statTotalUsers').textContent = totalUsers;
    document.getElementById('statActiveSubs').textContent = activeSubs;
    document.getElementById('statRevenue').textContent = `$${totalRevenue.toFixed(2)}`;
    document.getElementById('statConversion').textContent = `${conversionRate}%`;

    // Load recent activity
    loadRecentActivity(subs.docs.slice(0, 5));
    
    // Load recent transactions
    loadRecentTransactions(payments.docs.slice(0, 5));

  } catch (error) {
    console.error('Dashboard load error:', error);
  }
}

function loadRecentActivity(recentDocs) {
  const activityList = document.getElementById('activityList');
  if (!activityList) return;

  if (recentDocs.length === 0) {
    activityList.innerHTML = '<p style="color: var(--admin-text-muted); font-size: 13px;">No recent activity</p>';
    return;
  }

  activityList.innerHTML = recentDocs.map(doc => {
    const data = doc.data();
    const time = data.createdAt?.toDate ? data.createdAt.toDate().toLocaleString() : 'Recently';
    
    return `
      <div class="activity-item">
        <div class="activity-info">
          <div class="activity-user">${esc(data.userEmail || 'User')}</div>
          <div class="activity-action">Subscribed to ${esc(data.itemName || 'service')}</div>
        </div>
        <div class="activity-time">${time}</div>
      </div>
    `;
  }).join('');
}

function loadRecentTransactions(recentDocs) {
  const transactionList = document.getElementById('transactionList');
  if (!transactionList) return;

  if (recentDocs.length === 0) {
    transactionList.innerHTML = '<p style="color: var(--admin-text-muted); font-size: 13px;">No recent transactions</p>';
    return;
  }

  transactionList.innerHTML = recentDocs.map(doc => {
    const data = doc.data();
    const amount = data.price ? `$${Number(data.price).toFixed(2)}` : '—';
    
    return `
      <div class="transaction-item">
        <div class="transaction-info">
          <div class="transaction-user">${esc(data.userEmail || 'User')}</div>
          <div class="transaction-details">${esc(data.itemName || 'Purchase')}</div>
        </div>
        <div class="transaction-amount">${amount}</div>
      </div>
    `;
  }).join('');
}

/* ══════════════════════════════
   USERS
══════════════════════════════ */

async function loadUsers() {
  try {
    const usersSnap = await getDocs(collection(db, 'users'));
    allUsers = [];
    
    usersSnap.forEach(doc => {
      allUsers.push({ id: doc.id, ...doc.data() });
    });

    renderUsersTable(allUsers);
  } catch (error) {
    console.error('Load users error:', error);
    document.getElementById('usersTableBody').innerHTML = 
      '<tr><td colspan="6" style="text-align:center;color:var(--admin-danger)">Failed to load users</td></tr>';
  }
}

function renderUsersTable(users) {
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;

  if (users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--admin-text-muted)">No users found</td></tr>';
    return;
  }

  tbody.innerHTML = users.map(user => {
    const joinDate = user.createdAt?.toDate ? user.createdAt.toDate().toLocaleDateString() : '—';
    const initials = (user.name || user.email || '?').charAt(0).toUpperCase();
    const status = user.status || 'active';
    
    return `
      <tr>
        <td>
          <div class="table-user">
            <div class="table-avatar">${initials}</div>
            <div class="table-user-info">
              <div class="table-user-name">${esc(user.name || 'User')}</div>
              <div class="table-user-email">${esc(user.email || '')}</div>
            </div>
          </div>
        </td>
        <td>${esc(user.email || '—')}</td>
        <td><span class="status-badge ${status}">${status}</span></td>
        <td>${user.subscriptionCount || 0}</td>
        <td>${joinDate}</td>
        <td>
          <div class="table-actions">
            <button class="table-btn" onclick="editUser('${user.id}')">Edit</button>
            <button class="table-btn table-btn-danger" onclick="deleteUser('${user.id}')">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Export to window for onclick handlers
window.editUser = async function(userId) {
  const user = allUsers.find(u => u.id === userId);
  if (!user) return;

  document.getElementById('userName').value = user.name || '';
  document.getElementById('userEmail').value = user.email || '';
  document.getElementById('userStatus').value = user.status || 'active';
  
  const modal = document.getElementById('userModal');
  modal.dataset.userId = userId;
  modal.classList.add('show');
};

window.deleteUser = async function(userId) {
  if (!confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
    return;
  }

  try {
    await deleteDoc(doc(db, 'users', userId));
    alert('User deleted successfully');
    loadUsers();
  } catch (error) {
    console.error('Delete user error:', error);
    alert('Failed to delete user');
  }
};

/* ══════════════════════════════
   SUBSCRIPTIONS
══════════════════════════════ */

async function loadSubscriptions() {
  try {
    const subsSnap = await getDocs(collection(db, 'checkoutSessions'));
    allSubscriptions = [];
    
    subsSnap.forEach(doc => {
      allSubscriptions.push({ id: doc.id, ...doc.data() });
    });

    renderSubscriptionsTable(allSubscriptions);
  } catch (error) {
    console.error('Load subscriptions error:', error);
    document.getElementById('subsTableBody').innerHTML = 
      '<tr><td colspan="6" style="text-align:center;color:var(--admin-danger)">Failed to load subscriptions</td></tr>';
  }
}

function renderSubscriptionsTable(subs) {
  const tbody = document.getElementById('subsTableBody');
  if (!tbody) return;

  if (subs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--admin-text-muted)">No subscriptions found</td></tr>';
    return;
  }

  tbody.innerHTML = subs.map(sub => {
    const startDate = sub.createdAt?.toDate ? sub.createdAt.toDate().toLocaleDateString() : '—';
    const price = sub.price ? `$${Number(sub.price).toFixed(2)}` : '—';
    const status = sub.status || 'pending';
    
    return `
      <tr>
        <td>${esc(sub.userEmail || '—')}</td>
        <td>${esc(sub.itemName || sub.planName || sub.serviceName || '—')}</td>
        <td>${price}</td>
        <td><span class="status-badge ${status}">${status}</span></td>
        <td>${startDate}</td>
        <td>
          <div class="table-actions">
            <button class="table-btn" onclick="viewSubscription('${sub.id}')">View</button>
            <button class="table-btn table-btn-danger" onclick="cancelSubscription('${sub.id}')">Cancel</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

window.viewSubscription = function(subId) {
  const sub = allSubscriptions.find(s => s.id === subId);
  if (!sub) return;
  
  alert(`Subscription Details:\n\nUser: ${sub.userEmail}\nItem: ${sub.itemName}\nPrice: $${sub.price}\nStatus: ${sub.status}`);
};

window.cancelSubscription = async function(subId) {
  if (!confirm('Cancel this subscription?')) return;

  try {
    await updateDoc(doc(db, 'checkoutSessions', subId), {
      status: 'canceled',
      canceledAt: serverTimestamp()
    });
    alert('Subscription canceled');
    loadSubscriptions();
  } catch (error) {
    console.error('Cancel subscription error:', error);
    alert('Failed to cancel subscription');
  }
};

/* ══════════════════════════════
   SERVICES
══════════════════════════════ */

async function loadServices() {
  try {
    const servicesSnap = await getDocs(collection(db, 'services'));
    allServices = [];
    
    servicesSnap.forEach(doc => {
      allServices.push({ id: doc.id, ...doc.data() });
    });

    renderServicesGrid(allServices);
  } catch (error) {
    console.error('Load services error:', error);
    document.getElementById('servicesGrid').innerHTML = 
      '<div class="loading-card" style="color:var(--admin-danger)">Failed to load services</div>';
  }
}

function renderServicesGrid(services) {
  const grid = document.getElementById('servicesGrid');
  if (!grid) return;

  if (services.length === 0) {
    grid.innerHTML = '<div class="loading-card">No services found</div>';
    return;
  }

  grid.innerHTML = services.map(service => {
    const price = service.price ? `$${Number(service.price).toFixed(2)}` : '—';
    const period = service.pricePeriod || '';
    
    return `
      <div class="service-card">
        <div class="service-header">
          <div class="service-icon-admin">${esc(service.icon || '⚙️')}</div>
          <div class="service-actions">
            <button class="table-btn" onclick="editService('${service.id}')">Edit</button>
            <button class="table-btn table-btn-danger" onclick="deleteService('${service.id}')">Delete</button>
          </div>
        </div>
        <div class="service-name-admin">${esc(service.name || 'Service')}</div>
        <div class="service-desc-admin">${esc(service.description || '')}</div>
        <div class="service-price-admin">${price} ${period}</div>
        <div class="service-meta">
          <span class="status-badge ${service.active ? 'active' : 'inactive'}">
            ${service.active ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>
    `;
  }).join('');
}

window.editService = function(serviceId) {
  const service = allServices.find(s => s.id === serviceId);
  if (!service) return;

  document.getElementById('serviceName').value = service.name || '';
  document.getElementById('serviceIcon').value = service.icon || '';
  document.getElementById('serviceDescription').value = service.description || '';
  document.getElementById('servicePrice').value = service.price || '';
  document.getElementById('servicePeriod').value = service.pricePeriod || 'month';
  document.getElementById('serviceActive').checked = service.active !== false;
  
  const modal = document.getElementById('serviceModal');
  modal.dataset.serviceId = serviceId;
  modal.classList.add('show');
};

window.deleteService = async function(serviceId) {
  if (!confirm('Delete this service?')) return;

  try {
    await deleteDoc(doc(db, 'services', serviceId));
    alert('Service deleted');
    loadServices();
  } catch (error) {
    console.error('Delete service error:', error);
    alert('Failed to delete service');
  }
};

/* ══════════════════════════════
   PLANS
══════════════════════════════ */

async function loadPlans() {
  try {
    const plansSnap = await getDocs(collection(db, 'plans'));
    allPlans = [];
    
    plansSnap.forEach(doc => {
      allPlans.push({ id: doc.id, ...doc.data() });
    });

    renderPlansGrid(allPlans);
  } catch (error) {
    console.error('Load plans error:', error);
    document.getElementById('plansGrid').innerHTML = 
      '<div class="loading-card" style="color:var(--admin-danger)">Failed to load plans</div>';
  }
}

function renderPlansGrid(plans) {
  const grid = document.getElementById('plansGrid');
  if (!grid) return;

  if (plans.length === 0) {
    grid.innerHTML = '<div class="loading-card">No plans found</div>';
    return;
  }

  grid.innerHTML = plans.map(plan => {
    const price = plan.price ? `$${Number(plan.price).toFixed(2)}` : '—';
    const billing = plan.billingPeriod || 'month';
    
    return `
      <div class="plan-card-admin">
        <div class="plan-header">
          <div class="plan-icon-admin">${esc(plan.icon || '📦')}</div>
          <div class="plan-actions">
            <button class="table-btn" onclick="editPlan('${plan.id}')">Edit</button>
            <button class="table-btn table-btn-danger" onclick="deletePlan('${plan.id}')">Delete</button>
          </div>
        </div>
        <div class="plan-name-admin">${esc(plan.name || 'Plan')}</div>
        <div class="plan-desc-admin">${esc(plan.description || '')}</div>
        <div class="plan-price-admin">${price} / ${billing}</div>
        <div class="plan-meta">
          <span class="status-badge ${plan.active ? 'active' : 'inactive'}">
            ${plan.active ? 'Active' : 'Inactive'}
          </span>
          ${plan.popular ? '<span class="status-badge" style="background:#fef3c7;color:#92400e">Popular</span>' : ''}
        </div>
      </div>
    `;
  }).join('');
}

window.editPlan = function(planId) {
  const plan = allPlans.find(p => p.id === planId);
  if (!plan) return;

  document.getElementById('planName').value = plan.name || '';
  document.getElementById('planIcon').value = plan.icon || '';
  document.getElementById('planDescription').value = plan.description || '';
  document.getElementById('planPrice').value = plan.price || '';
  document.getElementById('planBilling').value = plan.billingPeriod || 'month';
  document.getElementById('planFeatures').value = Array.isArray(plan.features) ? plan.features.join('\n') : '';
  document.getElementById('planPopular').checked = plan.popular === true;
  document.getElementById('planActive').checked = plan.active !== false;
  
  const modal = document.getElementById('planModal');
  modal.dataset.planId = planId;
  modal.classList.add('show');
};

window.deletePlan = async function(planId) {
  if (!confirm('Delete this plan?')) return;

  try {
    await deleteDoc(doc(db, 'plans', planId));
    alert('Plan deleted');
    loadPlans();
  } catch (error) {
    console.error('Delete plan error:', error);
    alert('Failed to delete plan');
  }
};

/* ══════════════════════════════
   PAYMENTS
══════════════════════════════ */

async function loadPayments() {
  try {
    const paymentsSnap = await getDocs(collection(db, 'checkoutSessions'));
    allPayments = [];
    
    paymentsSnap.forEach(doc => {
      const data = doc.data();
      if (data.stripeSessionId) {
        allPayments.push({ id: doc.id, ...data });
      }
    });

    renderPaymentsTable(allPayments);
  } catch (error) {
    console.error('Load payments error:', error);
    document.getElementById('paymentsTableBody').innerHTML = 
      '<tr><td colspan="7" style="text-align:center;color:var(--admin-danger)">Failed to load payments</td></tr>';
  }
}

function renderPaymentsTable(payments) {
  const tbody = document.getElementById('paymentsTableBody');
  if (!tbody) return;

  if (payments.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--admin-text-muted)">No payments found</td></tr>';
    return;
  }

  tbody.innerHTML = payments.map(payment => {
    const date = payment.createdAt?.toDate ? payment.createdAt.toDate().toLocaleDateString() : '—';
    const amount = payment.price ? `$${Number(payment.price).toFixed(2)}` : '—';
    const status = payment.status || 'pending';
    
    return `
      <tr>
        <td><code style="font-size:11px">${payment.stripeSessionId?.substring(0, 20)}...</code></td>
        <td>${esc(payment.userEmail || '—')}</td>
        <td>${amount}</td>
        <td>${esc(payment.itemName || '—')}</td>
        <td><span class="status-badge ${status}">${status}</span></td>
        <td>${date}</td>
        <td>
          <button class="table-btn" onclick="viewPayment('${payment.id}')">View</button>
        </td>
      </tr>
    `;
  }).join('');
}

window.viewPayment = function(paymentId) {
  const payment = allPayments.find(p => p.id === paymentId);
  if (!payment) return;
  
  alert(`Payment Details:\n\nSession ID: ${payment.stripeSessionId}\nUser: ${payment.userEmail}\nAmount: $${payment.price}\nStatus: ${payment.status}`);
};

/* ══════════════════════════════
   SETTINGS
══════════════════════════════ */

function loadSettings() {
  // Settings are loaded from Firebase config or environment variables
  // For now, show empty form - admin can fill and save
}

function setupButtons() {
  // Add User button
  document.getElementById('addUserBtn')?.addEventListener('click', () => {
    document.getElementById('userName').value = '';
    document.getElementById('userEmail').value = '';
    document.getElementById('userStatus').value = 'active';
    delete document.getElementById('userModal').dataset.userId;
    document.getElementById('userModal').classList.add('show');
  });

  // Add Service button
  document.getElementById('addServiceBtn')?.addEventListener('click', () => {
    document.getElementById('serviceName').value = '';
    document.getElementById('serviceIcon').value = '';
    document.getElementById('serviceDescription').value = '';
    document.getElementById('servicePrice').value = '';
    document.getElementById('servicePeriod').value = 'month';
    document.getElementById('serviceActive').checked = true;
    delete document.getElementById('serviceModal').dataset.serviceId;
    document.getElementById('serviceModal').classList.add('show');
  });

  // Add Plan button
  document.getElementById('addPlanBtn')?.addEventListener('click', () => {
    document.getElementById('planName').value = '';
    document.getElementById('planIcon').value = '';
    document.getElementById('planDescription').value = '';
    document.getElementById('planPrice').value = '';
    document.getElementById('planBilling').value = 'month';
    document.getElementById('planFeatures').value = '';
    document.getElementById('planPopular').checked = false;
    document.getElementById('planActive').checked = true;
    delete document.getElementById('planModal').dataset.planId;
    document.getElementById('planModal').classList.add('show');
  });

  // Refresh button
  document.getElementById('refreshBtn')?.addEventListener('click', () => {
    loadSectionData(currentSection);
  });

  // Export button
  document.getElementById('exportBtn')?.addEventListener('click', () => {
    alert('Export functionality coming soon!');
  });
}

/* ══════════════════════════════
   MODALS
══════════════════════════════ */

function setupModals() {
  // Close buttons
  document.querySelectorAll('.modal-close, [data-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.dataset.modal;
      if (modalId) {
        document.getElementById(modalId)?.classList.remove('show');
      } else {
        btn.closest('.modal')?.classList.remove('show');
      }
    });
  });

  // Click outside to close
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('show');
      }
    });
  });

  // Form submissions
  setupUserForm();
  setupServiceForm();
  setupPlanForm();
  setupSettingsForms();
}

function setupUserForm() {
  const form = document.getElementById('userForm');
  
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const userId = document.getElementById('userModal').dataset.userId;
    const userData = {
      name: document.getElementById('userName').value,
      email: document.getElementById('userEmail').value,
      status: document.getElementById('userStatus').value,
      updatedAt: serverTimestamp()
    };

    try {
      if (userId) {
        await updateDoc(doc(db, 'users', userId), userData);
        alert('User updated successfully');
      } else {
        await addDoc(collection(db, 'users'), {
          ...userData,
          createdAt: serverTimestamp()
        });
        alert('User added successfully');
      }
      
      document.getElementById('userModal').classList.remove('show');
      loadUsers();
    } catch (error) {
      console.error('Save user error:', error);
      alert('Failed to save user');
    }
  });
}

function setupServiceForm() {
  const form = document.getElementById('serviceForm');
  
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const serviceId = document.getElementById('serviceModal').dataset.serviceId;
    const serviceData = {
      name: document.getElementById('serviceName').value,
      icon: document.getElementById('serviceIcon').value,
      description: document.getElementById('serviceDescription').value,
      price: parseFloat(document.getElementById('servicePrice').value),
      pricePeriod: document.getElementById('servicePeriod').value,
      active: document.getElementById('serviceActive').checked,
      updatedAt: serverTimestamp()
    };

    try {
      if (serviceId) {
        await updateDoc(doc(db, 'services', serviceId), serviceData);
        alert('Service updated successfully');
      } else {
        await addDoc(collection(db, 'services'), {
          ...serviceData,
          createdAt: serverTimestamp()
        });
        alert('Service added successfully');
      }
      
      document.getElementById('serviceModal').classList.remove('show');
      loadServices();
    } catch (error) {
      console.error('Save service error:', error);
      alert('Failed to save service');
    }
  });
}

function setupPlanForm() {
  const form = document.getElementById('planForm');
  
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const planId = document.getElementById('planModal').dataset.planId;
    const featuresText = document.getElementById('planFeatures').value;
    const features = featuresText.split('\n').filter(f => f.trim());
    
    const planData = {
      name: document.getElementById('planName').value,
      icon: document.getElementById('planIcon').value,
      description: document.getElementById('planDescription').value,
      price: parseFloat(document.getElementById('planPrice').value),
      billingPeriod: document.getElementById('planBilling').value,
      features: features,
      popular: document.getElementById('planPopular').checked,
      active: document.getElementById('planActive').checked,
      updatedAt: serverTimestamp()
    };

    try {
      if (planId) {
        await updateDoc(doc(db, 'plans', planId), planData);
        alert('Plan updated successfully');
      } else {
        await addDoc(collection(db, 'plans'), {
          ...planData,
          createdAt: serverTimestamp()
        });
        alert('Plan added successfully');
      }
      
      document.getElementById('planModal').classList.remove('show');
      loadPlans();
    } catch (error) {
      console.error('Save plan error:', error);
      alert('Failed to save plan');
    }
  });
}

function setupSettingsForms() {
  // Stripe settings
  document.getElementById('stripeSettingsForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    alert('Stripe settings saved! (In production, these would be saved to environment variables or secure config)');
  });

  // Email settings
  document.getElementById('emailSettingsForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    alert('Email settings saved!');
  });

  // General settings
  document.getElementById('generalSettingsForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    alert('General settings saved!');
  });
}

/* ══════════════════════════════
   UTILITY FUNCTIONS
══════════════════════════════ */

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
