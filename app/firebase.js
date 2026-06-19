/* ================================================================
   FILE: app/firebase.js  —  GTS Amplify Firebase initialization
   ================================================================ */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import { getAuth, setPersistence, browserLocalPersistence, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
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

// Keep session alive across tabs and browser restarts until explicit sign-out
setPersistence(auth, browserLocalPersistence);

// Cache user info for instant UI render on page load (no flash)
onAuthStateChanged(auth, user => {
  if (user) {
    localStorage.setItem('gts_user', JSON.stringify({
      displayName: user.displayName,
      email:       user.email,
      photoURL:    user.photoURL,
    }));
  } else {
    localStorage.removeItem('gts_user');
  }
});
