/* ============================================================
   FILE: admin/firebase-admin.js
   Firebase configuration for Guided Tech Solutions Admin
   ============================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-analytics.js";

// Firebase configuration for Admin project
const firebaseConfig = {
  apiKey: "AIzaSyD0f7L_vf2HZjzzxTyH2-Xu9rC6KWzKUuU",
  authDomain: "guidedtechapp.firebaseapp.com",
  projectId: "guidedtechapp",
  storageBucket: "guidedtechapp.firebasestorage.app",
  messagingSenderId: "744645189282",
  appId: "1:744645189282:web:00c134f4c91147818381fb",
  measurementId: "G-JKPGHW4L57"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const analytics = getAnalytics(app);

// Export app for any additional Firebase services
export default app;
