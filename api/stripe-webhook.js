/* ============================================================
   FILE: api/stripe-webhook.js
   Vercel Serverless Function — Stripe webhook handler
   
   Place this file in: /api/stripe-webhook.js
   
   REQUIRED ENVIRONMENT VARIABLES (set in Vercel Dashboard):
   - STRIPE_SECRET_KEY
   - STRIPE_WEBHOOK_SECRET
   - FIREBASE_SERVICE_ACCOUNT
   ============================================================ */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin = require('firebase-admin');

// Initialize Firebase Admin
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

// IMPORTANT: Need to get raw body for signature verification
export const config = {
  api: {
    bodyParser: false,
  },
};

// Helper to get raw body
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    const rawBody = await getRawBody(req);

    // Verify webhook signature
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object);
        break;

      case 'checkout.session.expired':
        await handleCheckoutExpired(event.data.object);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook handler error:', error);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
}

/* ══════════════════════════════
   CHECKOUT COMPLETED
══════════════════════════════ */
async function handleCheckoutCompleted(session) {
  const firestoreSessionId = session.metadata?.firestoreSessionId;
  const userId = session.metadata?.userId;
  const itemType = session.metadata?.itemType;
  const itemId = session.metadata?.itemId;

  if (!firestoreSessionId) {
    console.error('No firestoreSessionId in session metadata');
    return;
  }

  try {
    // Update checkout session status
    await db.collection('checkoutSessions').doc(firestoreSessionId).update({
      status: 'completed',
      stripePaymentStatus: session.payment_status,
      stripePaymentIntent: session.payment_intent,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Create appropriate subscription record
    if (itemType === 'service') {
      // Service activation
      await db.collection('serviceActivations').add({
        userId: userId,
        userEmail: session.customer_email,
        serviceId: itemId,
        checkoutSessionId: firestoreSessionId,
        stripeSessionId: session.id,
        status: 'active',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`Service ${itemId} activated for user ${userId}`);

    } else if (itemType === 'plan') {
      // Plan subscription
      await db.collection('userSubscriptions').add({
        userId: userId,
        userEmail: session.customer_email,
        planId: itemId,
        checkoutSessionId: firestoreSessionId,
        stripeSessionId: session.id,
        status: 'active',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`Plan ${itemId} subscribed for user ${userId}`);
    }

  } catch (error) {
    console.error('Error handling checkout completion:', error);
    throw error;
  }
}

/* ══════════════════════════════
   CHECKOUT EXPIRED
══════════════════════════════ */
async function handleCheckoutExpired(session) {
  const firestoreSessionId = session.metadata?.firestoreSessionId;

  if (!firestoreSessionId) return;

  try {
    await db.collection('checkoutSessions').doc(firestoreSessionId).update({
      status: 'expired',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`Checkout session ${firestoreSessionId} expired`);
  } catch (error) {
    console.error('Error handling checkout expiration:', error);
    throw error;
  }
}
