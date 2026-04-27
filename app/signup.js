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

console.log('🔍 Signup.js loaded');

// Get redirect URL from query params
const urlParams = new URLSearchParams(window.location.search);
const redirectUrl = urlParams.get('redirect') || './portal-services.html';

// Update signin link to preserve redirect
if (signinLink) {
  signinLink.href = './login.html?redirect=' + encodeURIComponent(redirectUrl);
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.classList.add('show');
}

function hideError() {
  errorMessage.classList.remove('show');
}

/* Google Sign Up */
googleBtn?.addEventListener('click', async () => {
  console.log('🔵 Google sign up clicked');
  hideError();
  googleBtn.disabled = true;
  googleBtn.innerHTML = '<span class="loading-spinner"></span> Creating account...';

  try {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    console.log('✅ Google sign up successful:', result.user.email);
    window.location.href = redirectUrl;
  } catch (error) {
    console.error('❌ Google error:', error);
    showError(error.message || 'Failed to sign up with Google');
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

/* Email/Password Sign Up */
emailForm?.addEventListener('submit', async (e) => {
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
    await updateProfile(userCredential.user, { displayName: name });
    console.log('✅ Email signup successful:', email);
    window.location.href = redirectUrl;
  } catch (error) {
    console.error('❌ Email error:', error);
    
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

/* Check if already signed in */
auth.onAuthStateChanged((user) => {
  if (user) {
    console.log('Already signed in, redirecting...');
    window.location.href = redirectUrl;
  }
});
