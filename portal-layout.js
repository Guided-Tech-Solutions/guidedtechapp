/* ============================================================
   FILE: app/portal-layout.js
   Shared auth + sidebar logic imported by all three portal pages.
   UPDATED: Login button redirects to user login page
   ============================================================ */

import { auth } from "../admin/firebase.js";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";

/* ── Footer year ── */
const footerYear = document.getElementById("footerYear");
if (footerYear) footerYear.textContent = new Date().getFullYear();

/* ── Auth DOM refs ── */
const authDot       = document.getElementById("authDot");
const authText      = document.getElementById("authText");
const btnLogin      = document.getElementById("btnLogin");
const btnLogout     = document.getElementById("btnLogout");
const sidebarAvatar = document.getElementById("sidebarAvatar");
const sidebarName   = document.getElementById("sidebarName");
const sidebarEmail  = document.getElementById("sidebarEmail");

/* ── Exported user state (pages read this) ── */
export let currentUser = null;

export const authReady = new Promise(resolve => {
  onAuthStateChanged(auth, user => {
    currentUser = user;
    if (user) {
      if (authDot)  authDot.style.background  = "#10b981";
      if (authText) authText.textContent       = `Signed in as ${user.email}`;
      if (btnLogin)  btnLogin.style.display    = "none";
      if (btnLogout) btnLogout.style.display   = "inline-block";
      
      const initials = (user.displayName || user.email || "?")
        .split(/[\s@]/).slice(0, 2).map(s => s[0]?.toUpperCase() || "").join("") || "U";
      
      if (sidebarAvatar) sidebarAvatar.textContent = initials;
      if (sidebarName)   sidebarName.textContent   = user.displayName || user.email.split("@")[0];
      if (sidebarEmail)  sidebarEmail.textContent  = user.email;
    } else {
      if (authDot)  authDot.style.background  = "#ef4444";
      if (authText) authText.textContent       = "Not signed in";
      if (btnLogin)  btnLogin.style.display    = "inline-block";
      if (btnLogout) btnLogout.style.display   = "none";
      if (sidebarAvatar) sidebarAvatar.textContent = "?";
      if (sidebarName)   sidebarName.textContent   = "Not signed in";
      if (sidebarEmail)  sidebarEmail.textContent  = "—";
    }
    resolve(user);
  });
});

/* ══════════════════════════════
   LOGIN / LOGOUT HANDLERS
══════════════════════════════ */

// Login button - redirect to user login page (not Google popup)
btnLogin?.addEventListener("click", () => {
  window.location.href = '/app/login.html?redirect=' + encodeURIComponent(window.location.pathname);
});

// Logout button
btnLogout?.addEventListener("click", () => {
  signOut(auth).catch(console.error);
});

/* ══════════════════════════════
   UTILITY FUNCTIONS (exported)
══════════════════════════════ */

// Escape HTML
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])
  );
}

// Format price
export function fmtPrice(price) {
  const p = Number(price) || 0;
  return p % 1 === 0 ? String(p) : p.toFixed(2);
}
