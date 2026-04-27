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

console.log('🔍 Login.js loaded');

// Get redirect URL from query params
const urlParams = new URLSearchParams(window.location.search);
const redirectUrl = urlParams.get('redirect') || './portal-services.html';

// Update signup link to preserve redirect
if (signupLink) {
  signupLink.href = './signup.html?redirect=' + encodeURIComponent(redirectUrl);
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.classList.add('show');
}

function hideError() {
  errorMessage.classList.remove('show');
}

/* Google Sign In */
googleBtn?.addEventListener('click', async () => {
  console.log('🔵 Google sign in clicked');
  hideError();
  googleBtn.disabled = true;
  googleBtn.innerHTML = '<span class="loading-spinner"></span> Signing in...';

  try {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    console.log('✅ Google sign in successful:', result.user.email);
    window.location.href = redirectUrl;
  } catch (error) {
    console.error('❌ Google error:', error);
    showError(error.message || 'Failed to sign in with Google');
    googleBtn.disabled = false;
    googleBtn.innerHTML = '<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google"> Continue with Google';
  }
});

/* Email Form Toggle */
emailBtn?.addEventListener('click', () => {
  console.log('📧 Email button clicked');
  emailBtn.style.display = 'none';
  emailForm.classList.add('active');
});

backBtn?.addEventListener('click', () => {
  emailForm.classList.remove('active');
  emailBtn.style.display = 'flex';
  hideError();
});

/* Email/Password Sign In */
emailForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError();

  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="loading-spinner"></span> Signing in...';

  try {
    await signInWithEmailAndPassword(auth, email, password);
    console.log('✅ Email sign in successful:', email);
    window.location.href = redirectUrl;
  } catch (error) {
    console.error('❌ Email error:', error);
    
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

/* Check if already signed in */
auth.onAuthStateChanged((user) => {
  if (user) {
    console.log('Already signed in, redirecting...');
    window.location.href = redirectUrl;
  }
});
