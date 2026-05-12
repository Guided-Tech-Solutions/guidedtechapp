/* ================================================================
   FILE: api/stripe-webhook.js
   GTS Amplify — Stripe Webhook Handler
   ================================================================ */
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const admin  = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}
const db = admin.firestore();

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  const sig  = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.warn("[stripe-webhook] Signature error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`[stripe-webhook] Event: ${event.type}`);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session   = event.data.object;
        const sessionId = session.client_reference_id || session.metadata?.sessionId;
        const amountPaid = (session.amount_total || 0) / 100;

        if (!sessionId) { console.warn("[stripe-webhook] No sessionId"); break; }

        const sessionRef  = db.collection("checkoutSessions").doc(sessionId);
        const sessionSnap = await sessionRef.get();
        if (!sessionSnap.exists()) { console.warn("[stripe-webhook] Session not found:", sessionId); break; }

        const sessionData = sessionSnap.data();
        const batch       = db.batch();

        batch.update(sessionRef, {
          status:          "completed",
          amountPaid,
          stripePaymentId: session.payment_intent,
          stripeSessionId: session.id,
          paidAt:          admin.firestore.FieldValue.serverTimestamp(),
          provider:        "stripe",
          updatedAt:       admin.firestore.FieldValue.serverTimestamp(),
        });

        if (sessionData.itemType === "service" && sessionData.itemId && sessionData.userId) {
          batch.set(db.collection("serviceActivations").doc(), {
            userId:           sessionData.userId,
            serviceId:        sessionData.itemId,
            serviceName:      sessionData.itemName,
            price:            sessionData.price || amountPaid,
            billing:          sessionData.billing || "month",
            status:           "active",
            provider:         "stripe",
            stripePaymentId:  session.payment_intent,
            stripeSessionId:  session.id,
            checkoutSessionId: sessionId,
            createdAt:        admin.firestore.FieldValue.serverTimestamp(),
            nextBillingDate:  getNextBillingDate(sessionData.billing),
          });
        } else if (sessionData.itemType === "plan" && sessionData.itemId && sessionData.userId) {
          batch.set(db.collection("userSubscriptions").doc(), {
            userId:          sessionData.userId,
            planId:          sessionData.itemId,
            planName:        sessionData.itemName,
            priceMonthly:    sessionData.price || amountPaid,
            billing:         sessionData.billing || "month",
            status:          "active",
            provider:        "stripe",
            stripePaymentId: session.payment_intent,
            stripeSessionId: session.id,
            checkoutSessionId: sessionId,
            createdAt:       admin.firestore.FieldValue.serverTimestamp(),
            nextBillingDate: getNextBillingDate(sessionData.billing),
          });
        } else if (sessionData.itemType === "consultation" && sessionData.itemId) {
          batch.update(db.collection("consultationBookings").doc(sessionData.itemId), {
            status:          "confirmed",
            paidAt:          admin.firestore.FieldValue.serverTimestamp(),
            stripePaymentId: session.payment_intent,
            updatedAt:       admin.firestore.FieldValue.serverTimestamp(),
          });
        }

        await batch.commit();
        console.log(`[stripe-webhook] Activated: ${sessionData.itemType} ${sessionData.itemId}`);
        break;
      }

      case "payment_intent.payment_failed": {
        const pi        = event.data.object;
        const sessionId = pi.metadata?.sessionId;
        if (sessionId) {
          await db.collection("checkoutSessions").doc(sessionId).update({
            status: "failed", error: pi.last_payment_error?.message || "Payment failed",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
        break;
      }

      default:
        console.log(`[stripe-webhook] Unhandled: ${event.type}`);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("[stripe-webhook] Error:", err);
    return res.status(500).json({ error: err.message });
  }
};

function getNextBillingDate(billing) {
  const d = new Date();
  if (billing === "year")  d.setFullYear(d.getFullYear() + 1);
  else if (billing === "once") return null;
  else d.setMonth(d.getMonth() + 1);
  return admin.firestore.Timestamp.fromDate(d);
}
