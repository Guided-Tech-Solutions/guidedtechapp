/* ============================================================
   FILE: app/signup.js
   User signup functionality
   ============================================================ */

import { auth } from './firebase.js';
import { 
  signInWithPopup, 
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  updateProfile
} from 'https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js';

const googleBtn = document.getElementById('googleSignUpBtn');
const emailBtn = document.getElementById('emailSignUpBtn');
const emailForm = document.getElementById('emailForm');
const backBtn = document.getElementById('backBtn');
const submitBtn = document.getElementById('submitBtn');
const errorMessage = document.getElementById('errorMessage');
const signinLink = document.getElementById('signinLink');

// Debug logging
console.log('🔍 Signup.js loaded');
console.log('Google button:', googleBtn);
console.log('Email button:', emailBtn);
console.log('Email form:', emailForm);
console.log('Auth object:', auth);

// Get redirect URL from query params
const urlParams = new URLSearchParams(window.location.search);
const redirectUrl = urlParams.get('redirect') || './portal-services.html';

// Update signin link to preserve redirect
if (signinLink) {
  signinLink.href += '?redirect=' + encodeURIComponent(redirectUrl);
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
   GOOGLE SIGN UP
══════════════════════════════ */

googleBtn?.addEventListener('click', async () => {
  console.log('🔵 Google sign up button clicked!');
  hideError();
  googleBtn.disabled = true;
  googleBtn.innerHTML = '<span class="loading-spinner"></span> Creating account...';

  try {
    console.log('Attempting Google sign up...');
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    console.log('✅ Google sign up successful:', result.user.email);
    
    // Redirect to original page or default
    window.location.href = redirectUrl;
  } catch (error) {
    console.error('❌ Google sign up error:', error);
    showError(error.message || 'Failed to sign up with Google');
    googleBtn.disabled = false;
    googleBtn.innerHTML = '<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google"> Continue with Google';
  }
});

/* ══════════════════════════════
   EMAIL FORM TOGGLE
══════════════════════════════ */

emailBtn?.addEventListener('click', () => {
  console.log('📧 Email sign up button clicked!');
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
   EMAIL/PASSWORD SIGN UP
══════════════════════════════ */

emailForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError();

  const name = document.getElementById('name').value;
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  if (password.length < 6) {
    showError('Password must be at least 6 characters');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="loading-spinner"></span> Creating account...';

  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    
    // Update display name
    await updateProfile(userCredential.user, {
      displayName: name
    });
    
    // Redirect to original page or default
    window.location.href = redirectUrl;
  } catch (error) {
    console.error('Email sign up error:', error);
    
    let errorMsg = 'Failed to create account';
    if (error.code === 'auth/email-already-in-use') {
      errorMsg = 'This email is already registered. Try signing in instead.';
    } else if (error.code === 'auth/invalid-email') {
      errorMsg = 'Invalid email address';
    } else if (error.code === 'auth/weak-password') {
      errorMsg = 'Password is too weak. Use at least 6 characters.';
    }
    
    showError(errorMsg);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create Account';
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
