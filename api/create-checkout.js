/* ============================================================
   FILE: api/create-checkout.js
   Vercel Serverless Function — creates Stripe checkout session
   UPDATED: Always creates fresh sessions, no reuse
   ============================================================ */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin = require('firebase-admin');

// Initialize Firebase Admin (only once)
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

export default async function handler(req, res) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { sessionId } = req.body;

  if (!sessionId) {
    return res.status(400).json({ success: false, error: 'Missing sessionId' });
  }

  try {
    // Get the checkout session doc from Firestore
    const docRef = db.collection('checkoutSessions').doc(sessionId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    const data = docSnap.data();

    // ALWAYS create a new Stripe session (don't reuse old ones)
    // Old sessions expire after 24 hours and cause 401 errors

    // Build line items
    const lineItems = [];

    if (data.itemType === 'service') {
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: data.itemName || 'Service Activation',
            description: `One-time activation for ${data.itemName}`,
          },
          unit_amount: Math.round((data.price || 0) * 100), // cents
        },
        quantity: 1,
      });
    } else if (data.itemType === 'plan') {
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: data.itemName || 'Subscription Plan',
            description: `${data.itemName} - ${data.billing || 'monthly'} subscription`,
          },
          unit_amount: Math.round((data.price || 0) * 100),
        },
        quantity: 1,
      });
    }

    // Create Stripe Checkout Session
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.guidedtechms.com';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment', // or 'subscription' for recurring
      success_url: `${baseUrl}/app/payment-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/app/portal-services.html?canceled=true`,
      customer_email: data.userEmail,
      client_reference_id: sessionId,
      metadata: {
        firestoreSessionId: sessionId,
        userId: data.userId,
        itemType: data.itemType,
        itemId: data.itemId,
      },
    });

    // Update Firestore with NEW Stripe session ID
    await docRef.update({
      stripeSessionId: session.id,
      stripeSessionUrl: session.url,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`✅ Created Stripe session: ${session.id}`);

    return res.json({
      success: true,
      sessionId: session.id,
    });

  } catch (error) {
    console.error('❌ Create checkout error:', error);

    // Mark as failed in Firestore
    if (sessionId) {
      try {
        await db.collection('checkoutSessions').doc(sessionId).update({
          status: 'failed',
          error: error.message,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (updateError) {
        console.error('Failed to update error status:', updateError);
      }
    }

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
