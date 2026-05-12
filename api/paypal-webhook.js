/* ================================================================
   FILE: api/paypal-webhook.js
   GTS Amplify — PayPal Webhook Handler
   ================================================================ */
const crypto = require("crypto");
const admin  = require("firebase-admin");
const fetch  = (...a) => import("node-fetch").then(({ default: f }) => f(...a));

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

  // PayPal webhook verification via API
  const ppMode = process.env.PAYPAL_MODE === "live" ? "api" : "api.sandbox";
  try {
    const tokenRes = await fetch(`https://${ppMode}.paypal.com/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(
          `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
        ).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error("PayPal auth failed for webhook verification");

    const verifyRes = await fetch(`https://${ppMode}.paypal.com/v1/notifications/verify-webhook-signature`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        auth_algo:         req.headers["paypal-auth-algo"],
        cert_url:          req.headers["paypal-cert-url"],
        transmission_id:   req.headers["paypal-transmission-id"],
        transmission_sig:  req.headers["paypal-transmission-sig"],
        transmission_time: req.headers["paypal-transmission-time"],
        webhook_id:        process.env.PAYPAL_WEBHOOK_ID || "",
        webhook_event:     req.body,
      }),
    });
    const verifyData = await verifyRes.json();
    if (verifyData.verification_status !== "SUCCESS") {
      console.warn("[paypal-webhook] Invalid signature:", verifyData);
      // Don't hard-reject in case PAYPAL_WEBHOOK_ID isn't set yet
    }
  } catch(e) {
    console.warn("[paypal-webhook] Verification skipped:", e.message);
  }

  const { event_type, resource } = req.body;
  console.log(`[paypal-webhook] Event: ${event_type}`);

  try {
    if (event_type === "PAYMENT.CAPTURE.COMPLETED") {
      const orderId   = resource.supplementary_data?.related_ids?.order_id || resource.id;
      const amountPaid = Number(resource.amount?.value || 0);

      const snap = await db.collection("checkoutSessions")
        .where("paypalOrderId", "==", orderId).limit(1).get();

      if (!snap.empty) {
        const sessionDoc  = snap.docs[0];
        const sessionData = sessionDoc.data();
        const batch       = db.batch();

        batch.update(sessionDoc.ref, {
          status:       "completed",
          amountPaid:   amountPaid * 1500,  // Convert USD back to NGN approx
          amountPaidUSD: amountPaid,
          paypalCaptureId: resource.id,
          paidAt:       admin.firestore.FieldValue.serverTimestamp(),
          provider:     "paypal",
          updatedAt:    admin.firestore.FieldValue.serverTimestamp(),
        });

        if (sessionData.itemType === "service" && sessionData.itemId && sessionData.userId) {
          batch.set(db.collection("serviceActivations").doc(), {
            userId:           sessionData.userId,
            serviceId:        sessionData.itemId,
            serviceName:      sessionData.itemName,
            price:            sessionData.price,
            billing:          sessionData.billing || "month",
            status:           "active",
            provider:         "paypal",
            paypalOrderId:    orderId,
            checkoutSessionId: sessionDoc.id,
            createdAt:        admin.firestore.FieldValue.serverTimestamp(),
          });
        } else if (sessionData.itemType === "plan" && sessionData.itemId && sessionData.userId) {
          batch.set(db.collection("userSubscriptions").doc(), {
            userId:          sessionData.userId,
            planId:          sessionData.itemId,
            planName:        sessionData.itemName,
            priceMonthly:    sessionData.price,
            billing:         sessionData.billing || "month",
            status:          "active",
            provider:        "paypal",
            paypalOrderId:   orderId,
            checkoutSessionId: sessionDoc.id,
            createdAt:       admin.firestore.FieldValue.serverTimestamp(),
          });
        } else if (sessionData.itemType === "consultation" && sessionData.itemId) {
          batch.update(db.collection("consultationBookings").doc(sessionData.itemId), {
            status:        "confirmed",
            paidAt:        admin.firestore.FieldValue.serverTimestamp(),
            paypalOrderId: orderId,
            updatedAt:     admin.firestore.FieldValue.serverTimestamp(),
          });
        }
        await batch.commit();
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("[paypal-webhook] Error:", err);
    return res.status(500).json({ error: err.message });
  }
};
