/* ================================================================
   FILE: admin/firebase-admin.js  —  GTS Amplify Firebase initialization
   ================================================================ */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import { getAuth }        from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import { getFirestore }   from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey:            "AIzaSyD0f7L_vf2HZjzzxTyH2-Xu9rC6KWzKUuU",
  authDomain:        "guidedtechapp.firebaseapp.com",
  projectId:         "guidedtechapp",
  storageBucket:     "guidedtechapp.firebasestorage.app",
  messagingSenderId: "744645189282",
  appId:             "1:744645189282:web:00c134f4c91147818381fb",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);
