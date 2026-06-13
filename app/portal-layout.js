/* ================================================================
   FILE: app/portal-layout.js  —  GTS Amplify Shared Layout
   Auth state, sidebar, toast system, modal helpers, utilities
   ================================================================ */
import { auth } from "./firebase.js";
import {
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";

/* ── Auth state ─────────────────────────────────────────────── */
export let currentUser = null;

export const authReady = new Promise(resolve => {
  onAuthStateChanged(auth, user => {
    currentUser = user;

    const avatar = document.getElementById("sidebarAvatar");
    const name   = document.getElementById("sidebarName");
    const email  = document.getElementById("sidebarEmail");
    const btnL   = document.getElementById("btnLogin");
    const btnO   = document.getElementById("btnLogout");

    if (user) {
      const initials = (user.displayName || user.email || "?")
        .split(/[\s@]+/).slice(0,2).map(s => s[0]?.toUpperCase() || "").join("") || "U";
      const firstName = user.displayName ? user.displayName.split(" ")[0] : (user.email || "").split("@")[0];

      if (avatar) {
        if (user.photoURL) avatar.innerHTML = `<img src="${user.photoURL}" alt="">`;
        else avatar.textContent = initials;
      }
      if (name)  name.textContent  = user.displayName || user.email.split("@")[0];
      if (email) email.textContent = user.email;
      if (btnL) btnL.style.display = "none";
      if (btnO) btnO.style.display = "inline-flex";

      const navAvatarCircle = document.getElementById("navAvatarCircle");
      const navAvatarName   = document.getElementById("navAvatarName");
      if (navAvatarCircle) {
        if (user.photoURL) navAvatarCircle.innerHTML = `<img src="${user.photoURL}" alt="">`;
        else navAvatarCircle.textContent = initials;
      }
      if (navAvatarName) navAvatarName.textContent = firstName;
    } else {
      if (avatar) avatar.textContent = "?";
      if (name)   name.textContent   = "Not signed in";
      if (email)  email.textContent  = "—";
      if (btnL) btnL.style.display = "inline-flex";
      if (btnO) btnO.style.display = "none";
    }
    // Always reveal after auth resolves (covers first-load / no-cache case)
    const sp = document.querySelector(".sidebar-profile"); if (sp) sp.style.visibility = "visible";
    const nw = document.querySelector(".nav-avatar-wrap");  if (nw) nw.style.visibility = "visible";
    resolve(user);
  });
});

/* ── Nav buttons ─────────────────────────────────────────────── */
async function doSignOut() {
  try {
    localStorage.removeItem('gts_user');
    await signOut(auth);
    window.location.href = "./login.html";
  } catch(e) {}
}
document.getElementById("btnLogin")?.addEventListener("click", () => {
  window.location.href = "./login.html?redirect=" + encodeURIComponent(window.location.pathname);
});
document.getElementById("btnLogout")?.addEventListener("click", doSignOut);
document.getElementById("btnSidebarSignout")?.addEventListener("click", doSignOut);
document.getElementById("btnNavSignout")?.addEventListener("click", doSignOut);

/* ── Mobile sidebar ──────────────────────────────────────────── */
const sidebar  = document.querySelector(".portal-sidebar");
const overlay  = document.getElementById("sidebarOverlay");

document.getElementById("hamburgerBtn")?.addEventListener("click", () => {
  sidebar?.classList.add("open");
  overlay?.classList.add("open");
  document.body.style.overflow = "hidden";
});
overlay?.addEventListener("click", closeSidebar);

function closeSidebar() {
  sidebar?.classList.remove("open");
  overlay?.classList.remove("open");
  document.body.style.overflow = "";
}

/* Active sidebar link */
const currentPage = window.location.pathname.split("/").pop();
document.querySelectorAll(".sidebar-link[data-page]").forEach(link => {
  if (link.dataset.page === currentPage) link.classList.add("active");
});

/* ── Toast system ────────────────────────────────────────────── */
let _toastRoot = document.getElementById("toastRoot");
if (!_toastRoot) {
  _toastRoot = document.createElement("div");
  _toastRoot.id = "toastRoot";
  document.body.appendChild(_toastRoot);
}

export function showToast({ title = "", message = "", type = "info", duration = 4500 } = {}) {
  const ICONS = { success:"✅", error:"❌", warning:"⚠️", info:"ℹ️" };
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.innerHTML = `
    <span class="toast-icon">${ICONS[type] || ICONS.info}</span>
    <div class="toast-body">
      ${title ? `<div class="toast-title">${esc(title)}</div>` : ""}
      ${message ? `<div class="toast-msg">${esc(message)}</div>` : ""}
    </div>
    <button class="toast-x" aria-label="Dismiss">✕</button>`;
  t.querySelector(".toast-x").onclick = () => removeToast(t);
  _toastRoot.appendChild(t);
  setTimeout(() => removeToast(t), duration);
}
function removeToast(t) {
  t.style.opacity = "0"; t.style.transform = "translateX(20px)"; t.style.transition = "all .25s";
  setTimeout(() => t.remove(), 250);
}

/* ── Modal helpers ───────────────────────────────────────────── */
export function openModal(id) {
  document.getElementById(id)?.classList.add("open");
  document.body.style.overflow = "hidden";
}
export function closeModal(id) {
  document.getElementById(id)?.classList.remove("open");
  document.body.style.overflow = "";
}

document.addEventListener("DOMContentLoaded", () => {
  // Overlay click closes
  document.querySelectorAll(".modal-overlay").forEach(o => {
    o.addEventListener("click", e => { if (e.target === o) closeModal(o.id); });
  });
  // data-modal-close buttons
  document.querySelectorAll("[data-modal-close]").forEach(btn => {
    btn.addEventListener("click", () => closeModal(btn.dataset.modalClose));
  });
});

/* ── Auth guard ──────────────────────────────────────────────── */
export async function requireAuth() {
  const user = await authReady;
  if (!user) {
    window.location.href = "./login.html?redirect=" + encodeURIComponent(window.location.pathname);
    return null;
  }
  return user;
}

/* ── Utilities ───────────────────────────────────────────────── */
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])
  );
}

export function fmtMoney(amount, symbol = "$") {
  const n = Number(amount) || 0;
  return symbol + n.toLocaleString("en-US", { minimumFractionDigits: n % 1 !== 0 ? 2 : 0 });
}

export function fmtDate(ts, opts = { day:"numeric", month:"short", year:"numeric" }) {
  if (!ts) return "—";
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-US", opts);
}

export function timeAgo(ts) {
  if (!ts) return "—";
  const d    = ts?.toDate ? ts.toDate() : new Date(ts);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7)  return `${days}d ago`;
  return fmtDate(ts);
}

export function getDashboardType(sub) {
  if (sub.dashboardType) return sub.dashboardType;
  const n = (sub.name || "").toLowerCase();
  if (n.includes("lead"))   return "lead_generation";
  if (n.includes("cloud") || n.includes("migr")) return "cloud_migration";
  if (n.includes("automat")) return "automation";
  if (n.includes("seo"))    return "seo";
  if (n.includes("consult"))return "consultation";
  return "generic";
}
