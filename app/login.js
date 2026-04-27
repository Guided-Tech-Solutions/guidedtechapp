/* ============================================================
   FILE: app/login.js
   User login functionality
   ============================================================ */

import { auth } from './firebase.js';
import { 
  signInWithPopup, 
  GoogleAuthProvider,
  signInWithEmailAndPassword 
} from 'https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js';

const googleBtn = document.getElementById('googleSignInBtn');
const emailBtn = document.getElementById('emailSignInBtn');
const emailForm = document.getElementById('emailForm');
const backBtn = document.getElementById('backBtn');
const submitBtn = document.getElementById('submitBtn');
const errorMessage = document.getElementById('errorMessage');
const signupLink = document.getElementById('signupLink');

// Debug logging
console.log('🔍 Login.js loaded');
console.log('Google button:', googleBtn);
console.log('Email button:', emailBtn);
console.log('Email form:', emailForm);
console.log('Auth object:', auth);

// Get redirect URL from query params
const urlParams = new URLSearchParams(window.location.search);
const redirectUrl = urlParams.get('redirect') || './portal-services.html';

// Update signup link to preserve redirect
if (signupLink) {
  signupLink.href += '?redirect=' + encodeURIComponent(redirectUrl);
}

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
   GOOGLE SIGN IN
══════════════════════════════ */

googleBtn?.addEventListener('click', async () => {
  console.log('🔵 Google sign in button clicked!');
  hideError();
  googleBtn.disabled = true;
  googleBtn.innerHTML = '<span class="loading-spinner"></span> Signing in...';

  try {
    console.log('Attempting Google sign in...');
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    console.log('✅ Google sign in successful:', result.user.email);
    
    // Redirect to original page or default
    window.location.href = redirectUrl;
  } catch (error) {
    console.error('❌ Google sign in error:', error);
    showError(error.message || 'Failed to sign in with Google');
    googleBtn.disabled = false;
    googleBtn.innerHTML = '<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google"> Continue with Google';
  }
});

/* ══════════════════════════════
   EMAIL FORM TOGGLE
══════════════════════════════ */

emailBtn?.addEventListener('click', () => {
  console.log('📧 Email sign in button clicked!');
  emailBtn.style.display = 'none';
  emailForm.classList.add('active');
  console.log('Email form should now be visible');
});

backBtn?.addEventListener('click', () => {
  console.log('⬅️ Back button clicked');
  emailForm.classList.remove('active');
  emailBtn.style.display = 'flex';
  hideError();
});

/* ══════════════════════════════
   EMAIL/PASSWORD SIGN IN
══════════════════════════════ */

emailForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError();

  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="loading-spinner"></span> Signing in...';

  try {
    await signInWithEmailAndPassword(auth, email, password);
    
    // Redirect to original page or default
    window.location.href = redirectUrl;
  } catch (error) {
    console.error('Email sign in error:', error);
    
    let errorMsg = 'Failed to sign in';
    if (error.code === 'auth/user-not-found') {
      errorMsg = 'No account found with this email';
    } else if (error.code === 'auth/wrong-password') {
      errorMsg = 'Incorrect password';
    } else if (error.code === 'auth/invalid-email') {
      errorMsg = 'Invalid email address';
    } else if (error.code === 'auth/invalid-credential') {
      errorMsg = 'Invalid email or password';
    }
    
    showError(errorMsg);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Sign In';
  }
});

/* ══════════════════════════════
   CHECK IF ALREADY SIGNED IN
══════════════════════════════ */

auth.onAuthStateChanged((user) => {
  if (user) {
    // Already signed in, redirect immediately
    window.location.href = redirectUrl;
  }
});
