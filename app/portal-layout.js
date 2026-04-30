/* ============================================================
   FILE: portal-layout.js
   Shared authentication and layout logic
   ============================================================ */

import { auth } from "./firebase.js";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";

const sidebarAvatar = document.getElementById("sidebarAvatar");
const sidebarName = document.getElementById("sidebarName");
const sidebarEmail = document.getElementById("sidebarEmail");
const btnLogin = document.getElementById("btnLogin");
const btnLogout = document.getElementById("btnLogout");

export let currentUser = null;

export const authReady = new Promise(resolve => {
  onAuthStateChanged(auth, user => {
    currentUser = user;
    
    if (user) {
      // User is signed in
      const initials = (user.displayName || user.email || "?")
        .split(/[\s@]/).slice(0, 2).map(s => s[0]?.toUpperCase() || "").join("") || "U";
      
      if (sidebarAvatar) sidebarAvatar.textContent = initials;
      if (sidebarName) sidebarName.textContent = user.displayName || user.email.split("@")[0];
      if (sidebarEmail) sidebarEmail.textContent = user.email;
      if (btnLogin) btnLogin.style.display = "none";
      if (btnLogout) btnLogout.style.display = "inline-flex";
      
      console.log('✅ User signed in:', user.email);
    } else {
      // User is signed out
      if (sidebarAvatar) sidebarAvatar.textContent = "?";
      if (sidebarName) sidebarName.textContent = "Not signed in";
      if (sidebarEmail) sidebarEmail.textContent = "—";
      if (btnLogin) btnLogin.style.display = "inline-flex";
      if (btnLogout) btnLogout.style.display = "none";
      
      console.log('ℹ️ User not signed in');
    }
    
    resolve(user);
  });
});

// Login button click handler
btnLogin?.addEventListener("click", () => {
  window.location.href = './login.html?redirect=' + encodeURIComponent(window.location.pathname);
});

// Logout button click handler
btnLogout?.addEventListener("click", async () => {
  try {
    await signOut(auth);
    console.log('✅ Logged out');
    window.location.href = './login.html';
  } catch (error) {
    console.error('❌ Logout error:', error);
  }
});

// Utility functions
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])
  );
}

export function fmtPrice(price) {
  const p = Number(price) || 0;
  return p % 1 === 0 ? String(p) : p.toFixed(2);
}

console.log('✅ Portal layout initialized');
