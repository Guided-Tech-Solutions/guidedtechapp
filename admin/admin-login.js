/* ============================================================
   FILE: admin/admin-login.js
   Admin login functionality with role verification
   ============================================================ */

import { auth, db } from './firebase-admin.js';
import { 
  signInWithEmailAndPassword 
} from 'https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js';
import { 
  doc, 
  getDoc 
} from 'https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js';

const form = document.getElementById('adminLoginForm');
const submitBtn = document.getElementById('submitBtn');
const errorMessage = document.getElementById('errorMessage');

/* ══════════════════════════════
   HELPER FUNCTIONS
══════════════════════════════ */

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.classList.add('show');
}

function hideError() {
  errorMessage.classList.remove('show');
}

/* ══════════════════════════════
   ADMIN LOGIN
══════════════════════════════ */

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError();

  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="loading-spinner"></span> Signing in...';

  try {
    // Sign in with email and password
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // Verify admin role in Firestore
    const adminDoc = await getDoc(doc(db, 'admins', user.uid));

    if (!adminDoc.exists()) {
      // Not an admin - sign out immediately
      await auth.signOut();
      showError('Access denied. Admin privileges required.');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign In to Admin';
      return;
    }

    const adminData = adminDoc.data();

    if (!adminData.active) {
      // Admin account is disabled
      await auth.signOut();
      showError('This admin account has been disabled.');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign In to Admin';
      return;
    }

    // Success - redirect to admin dashboard
    window.location.href = './admin-dashboard.html';

  } catch (error) {
    console.error('Admin login error:', error);
    
    let errorMsg = 'Failed to sign in';
    if (error.code === 'auth/user-not-found') {
      errorMsg = 'Admin account not found';
    } else if (error.code === 'auth/wrong-password') {
      errorMsg = 'Incorrect password';
    } else if (error.code === 'auth/invalid-email') {
      errorMsg = 'Invalid email address';
    } else if (error.code === 'auth/invalid-credential') {
      errorMsg = 'Invalid email or password';
    } else if (error.code === 'auth/too-many-requests') {
      errorMsg = 'Too many failed attempts. Try again later.';
    }
    
    showError(errorMsg);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Sign In to Admin';
  }
});

/* ══════════════════════════════
   CHECK IF ALREADY SIGNED IN
══════════════════════════════ */

auth.onAuthStateChanged(async (user) => {
  if (user) {
    // Check if user is admin
    try {
      const adminDoc = await getDoc(doc(db, 'admins', user.uid));
      
      if (adminDoc.exists() && adminDoc.data().active) {
        // Already signed in as admin, redirect to dashboard
        window.location.href = './admin-dashboard.html';
      }
    } catch (error) {
      console.error('Auth state check error:', error);
    }
  }
});
