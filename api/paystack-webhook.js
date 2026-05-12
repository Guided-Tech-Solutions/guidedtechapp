/* ================================================================
   FILE: api/paystack-webhook.js
   GTS Amplify — Paystack Webhook Handler
   Verifies HMAC, activates subscriptions
   ================================================================ */
const crypto = require("crypto");
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

  // Verify signature
  const hash = crypto
    .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY)
    .update(JSON.stringify(req.body))
    .digest("hex");

  if (hash !== req.headers["x-paystack-signature"]) {
    console.warn("[paystack-webhook] Invalid signature");
    return res.status(400).send("Invalid signature");
  }

  const { event, data } = req.body;
  console.log(`[paystack-webhook] Event: ${event}`);

  try {
    switch (event) {
      case "charge.success": {
        const ref       = data.reference;
        const email     = data.customer?.email;
        const amountPaid = (data.amount || 0) / 100; // convert kobo to NGN

        // Find checkout session
        const snap = await db.collection("checkoutSessions")
          .where("paystackReference", "==", ref)
          .limit(1)
          .get();

        if (snap.empty) {
          console.warn(`[paystack-webhook] No session found for ref: ${ref}`);
          break;
        }

        const sessionDoc  = snap.docs[0];
        const sessionData = sessionDoc.data();
        const batch       = db.batch();

        // Mark session completed
        batch.update(sessionDoc.ref, {
          status: "completed", amountPaid,
          paidAt: admin.firestore.FieldValue.serverTimestamp(),
          paystackData: {
            reference: ref,
            channel:   data.channel,
            currency:  data.currency,
            fees:      data.fees,
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Activate service or plan
        if (sessionData.itemType === "service" && sessionData.itemId && sessionData.userId) {
          const activationRef = db.collection("serviceActivations").doc();
          batch.set(activationRef, {
            userId:           sessionData.userId,
            serviceId:        sessionData.itemId,
            serviceName:      sessionData.itemName,
            price:            sessionData.price || amountPaid,
            billing:          sessionData.billing || "month",
            status:           "active",
            provider:         "paystack",
            paystackReference: ref,
            checkoutSessionId: sessionDoc.id,
            createdAt:        admin.firestore.FieldValue.serverTimestamp(),
            nextBillingDate:  getNextBillingDate(sessionData.billing),
          });
        } else if (sessionData.itemType === "plan" && sessionData.itemId && sessionData.userId) {
          const subRef = db.collection("userSubscriptions").doc();
          batch.set(subRef, {
            userId:           sessionData.userId,
            planId:           sessionData.itemId,
            planName:         sessionData.itemName,
            priceMonthly:     sessionData.price || amountPaid,
            billing:          sessionData.billing || "month",
            status:           "active",
            provider:         "paystack",
            paystackReference: ref,
            checkoutSessionId: sessionDoc.id,
            createdAt:        admin.firestore.FieldValue.serverTimestamp(),
            nextBillingDate:  getNextBillingDate(sessionData.billing),
          });
        } else if (sessionData.itemType === "consultation" && sessionData.itemId) {
          batch.update(db.collection("consultationBookings").doc(sessionData.itemId), {
            status:           "confirmed",
            paidAt:           admin.firestore.FieldValue.serverTimestamp(),
            paystackReference: ref,
            updatedAt:        admin.firestore.FieldValue.serverTimestamp(),
          });
        }

        await batch.commit();
        console.log(`[paystack-webhook] Activated: ${sessionData.itemType} ${sessionData.itemId}`);
        break;
      }

      case "subscription.create":
        console.log("[paystack-webhook] Subscription created:", data.subscription_code);
        break;

      case "subscription.disable":
        // Handle subscription cancellation
        const code = data.subscription_code;
        const subsSnap = await db.collection("serviceActivations")
          .where("paystackSubCode", "==", code).limit(1).get();
        if (!subsSnap.empty) {
          await subsSnap.docs[0].ref.update({
            status: "canceled", canceledAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
        break;

      default:
        console.log(`[paystack-webhook] Unhandled event: ${event}`);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("[paystack-webhook] Error:", err);
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
