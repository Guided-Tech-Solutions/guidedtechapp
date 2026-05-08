/* ============================================================
   FILE: app/portal-layout.js
   Shared auth, sidebar, toast, utilities for all portal pages
   ============================================================ */
import { auth } from "./firebase.js";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";

/* ── DOM refs ─────────────────────────────────────────────── */
const sidebarAvatar  = document.getElementById("sidebarAvatar");
const sidebarName    = document.getElementById("sidebarName");
const sidebarEmail   = document.getElementById("sidebarEmail");
const btnLogin       = document.getElementById("btnLogin");
const btnLogout      = document.getElementById("btnLogout");
const mobilMenuBtn   = document.getElementById("mobileMenuBtn");
const sidebar        = document.querySelector(".portal-sidebar");
const sidebarOverlay = document.getElementById("sidebarOverlay");
const btnSidebarLogout = document.getElementById("btnSidebarLogout");

/* ── Auth state ───────────────────────────────────────────── */
export let currentUser = null;

export const authReady = new Promise(resolve => {
  onAuthStateChanged(auth, user => {
    currentUser = user;
    if (user) {
      const initials = (user.displayName || user.email || "?")
        .split(/[\s@]/).slice(0, 2)
        .map(s => s[0]?.toUpperCase() || "").join("") || "U";

      if (sidebarAvatar) {
        if (user.photoURL) {
          sidebarAvatar.innerHTML = `<img src="${user.photoURL}" alt="">`;
        } else {
          sidebarAvatar.textContent = initials;
        }
      }
      if (sidebarName) sidebarName.textContent = user.displayName || user.email.split("@")[0];
      if (sidebarEmail) sidebarEmail.textContent = user.email;
      if (btnLogin)  btnLogin.style.display  = "none";
      if (btnLogout) btnLogout.style.display = "inline-flex";
    } else {
      if (sidebarAvatar) sidebarAvatar.textContent = "?";
      if (sidebarName)   sidebarName.textContent   = "Not signed in";
      if (sidebarEmail)  sidebarEmail.textContent  = "—";
      if (btnLogin)  btnLogin.style.display  = "inline-flex";
      if (btnLogout) btnLogout.style.display = "none";
    }
    resolve(user);
  });
});

/* ── Nav buttons ──────────────────────────────────────────── */
btnLogin?.addEventListener("click", () => {
  window.location.href = "./login.html?redirect=" + encodeURIComponent(window.location.pathname);
});

async function doLogout() {
  try {
    await signOut(auth);
    window.location.href = "./login.html";
  } catch (e) { console.error("Logout error", e); }
}
btnLogout?.addEventListener("click", doLogout);
btnSidebarLogout?.addEventListener("click", doLogout);

/* ── Mobile sidebar ───────────────────────────────────────── */
function openSidebar() {
  sidebar?.classList.add("open");
  sidebarOverlay?.classList.add("show");
  document.body.style.overflow = "hidden";
}
function closeSidebar() {
  sidebar?.classList.remove("open");
  sidebarOverlay?.classList.remove("show");
  document.body.style.overflow = "";
}
mobilMenuBtn?.addEventListener("click", openSidebar);
sidebarOverlay?.addEventListener("click", closeSidebar);

/* Mark active sidebar link */
const currentPath = window.location.pathname.split("/").pop();
document.querySelectorAll(".sidebar-link[data-page]").forEach(link => {
  if (link.dataset.page === currentPath) link.classList.add("active");
});

/* ── Toast system ─────────────────────────────────────────── */
let toastContainer = document.getElementById("toastContainer");
if (!toastContainer) {
  toastContainer = document.createElement("div");
  toastContainer.id = "toastContainer";
  document.body.appendChild(toastContainer);
}

export function showToast({ title = "", message = "", type = "info", duration = 4000 } = {}) {
  const icons = { success: "✅", error: "❌", warning: "⚠️", info: "ℹ️" };
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <div class="toast-content">
      ${title ? `<div class="toast-title">${esc(title)}</div>` : ""}
      ${message ? `<div class="toast-msg">${esc(message)}</div>` : ""}
    </div>
    <button class="toast-close" aria-label="Dismiss">✕</button>
  `;
  toast.querySelector(".toast-close").addEventListener("click", () => removeToast(toast));
  toastContainer.appendChild(toast);
  setTimeout(() => removeToast(toast), duration);
  return toast;
}

function removeToast(toast) {
  toast.style.animation = "toastOut .25s ease forwards";
  setTimeout(() => toast.remove(), 250);
}

/* ── Modal helpers ────────────────────────────────────────── */
export function openModal(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.add("show"); document.body.style.overflow = "hidden"; }
}
export function closeModal(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.remove("show"); document.body.style.overflow = ""; }
}

/* Wire up all modals with close buttons */
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".modal-overlay").forEach(overlay => {
    overlay.addEventListener("click", e => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });
  document.querySelectorAll("[data-close-modal]").forEach(btn => {
    btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
  });
});

/* ── Utilities ────────────────────────────────────────────── */
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])
  );
}

export function fmtPrice(price, currency = "$") {
  const p = Number(price) || 0;
  return currency + (p % 1 === 0 ? p.toLocaleString() : p.toFixed(2));
}

export function fmtDate(ts, opts = { month: "short", day: "numeric", year: "numeric" }) {
  if (!ts) return "—";
  const date = ts?.toDate ? ts.toDate() : new Date(ts);
  return date.toLocaleDateString("en-US", opts);
}

export function timeAgo(ts) {
  if (!ts) return "—";
  const date = ts?.toDate ? ts.toDate() : new Date(ts);
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return fmtDate(ts);
}

export function requireAuth(redirectTo = "./login.html") {
  return authReady.then(user => {
    if (!user) {
      window.location.href = redirectTo + "?redirect=" + encodeURIComponent(window.location.pathname);
      return null;
    }
    return user;
  });
}

console.log("✅ Portal layout initialized");
