/* ================================================================
   FILE: api/create-checkout.js
   GTS Amplify — Multi-Provider Checkout (Paystack, Stripe, PayPal)
   ================================================================ */
const admin  = require("firebase-admin");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
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
const db      = admin.firestore();
const APP_URL = process.env.APP_URL || "https://www.gtsamplify.com";

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")    return res.status(405).json({ success:false, error:"Method not allowed" });

  const { sessionId, email, amount, itemName, itemType, itemId, userId, provider = "paystack" } = req.body;

  if (!sessionId || !email || !amount || !itemName) {
    return res.status(400).json({ success:false, error:"Missing required fields" });
  }

  const amountNum = Number(amount);
  if (isNaN(amountNum) || amountNum < 0) {
    return res.status(400).json({ success:false, error:"Invalid amount" });
  }

  const successUrl = `${APP_URL}/app/payment-success.html`;
  const cancelUrl  = `${APP_URL}/app/portal-services.html?canceled=true`;

  try {
    let result = {};

    /* ── PAYSTACK ─────────────────────────────────────────────── */
    if (provider === "paystack") {
      const reference = `gts_${sessionId}_${Date.now()}`;
      const body = {
        email,
        amount:    Math.round(amountNum * 100),  // Paystack uses kobo
        currency:  "NGN",
        reference,
        callback_url: `${successUrl}?reference=${reference}`,
        metadata: {
          sessionId, userId: userId||"", itemName, itemType: itemType||"",
          itemId: itemId||"", cancel_action: cancelUrl,
        },
      };

      const psRes  = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const psData = await psRes.json();
      if (!psData.status) throw new Error(psData.message || "Paystack init failed");

      result = {
        provider: "paystack",
        authorizationUrl: psData.data.authorization_url,
        reference:        psData.data.reference,
        accessCode:       psData.data.access_code,
      };
      await db.collection("checkoutSessions").doc(sessionId).update({
        paystackReference: reference,
        paystackAccessCode: psData.data.access_code,
        provider: "paystack",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    /* ── STRIPE ───────────────────────────────────────────────── */
    else if (provider === "stripe") {
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        mode:                 "payment",
        customer_email:       email,
        line_items: [{
          price_data: {
            currency:     "usd",
            unit_amount:  Math.round(amountNum * 100),  // cents
            product_data: { name: itemName, description: `${itemType || "Service"} — GTS Amplify` },
          },
          quantity: 1,
        }],
        success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url:  cancelUrl,
        client_reference_id: sessionId,
        metadata: { sessionId, userId: userId||"", itemName, itemType: itemType||"", itemId: itemId||"" },
      });

      result = {
        provider: "stripe",
        checkoutUrl: session.url,
        stripeSessionId: session.id,
      };
      await db.collection("checkoutSessions").doc(sessionId).update({
        stripeSessionId: session.id,
        stripeSessionUrl: session.url,
        provider: "stripe",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    /* ── PAYPAL ───────────────────────────────────────────────── */
    else if (provider === "paypal") {
      // Get PayPal access token
      const ppMode   = process.env.PAYPAL_MODE === "live" ? "api" : "api.sandbox";
      const tokenRes = await fetch(`https://${ppMode}.paypal.com/v1/oauth2/token`, {
        method:  "POST",
        headers: {
          Authorization: "Basic " + Buffer.from(
            `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
          ).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      });
      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) throw new Error("PayPal auth failed");

      // Create order
      const ppAmountUSD = (amountNum / 1500).toFixed(2);  // convert NGN to USD approx
      const orderRes = await fetch(`https://${ppMode}.paypal.com/v2/checkout/orders`, {
        method:  "POST",
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          intent: "CAPTURE",
          purchase_units: [{
            description: itemName,
            amount: { currency_code: "USD", value: ppAmountUSD },
            custom_id: sessionId,
          }],
          application_context: {
            return_url: `${successUrl}`,
            cancel_url: cancelUrl,
            brand_name: "GTS Amplify",
            user_action: "PAY_NOW",
          },
        }),
      });
      const orderData = await orderRes.json();
      if (orderData.error) throw new Error(orderData.error_description || "PayPal order failed");

      const approvalLink = orderData.links?.find(l => l.rel === "approve")?.href;
      if (!approvalLink) throw new Error("No PayPal approval URL");

      result = {
        provider: "paypal",
        approvalUrl:  approvalLink,
        paypalOrderId: orderData.id,
      };
      await db.collection("checkoutSessions").doc(sessionId).update({
        paypalOrderId:  orderData.id,
        paypalAmountUSD: ppAmountUSD,
        provider: "paypal",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    else {
      return res.status(400).json({ success:false, error:`Unknown provider: ${provider}` });
    }

    return res.status(200).json({ success: true, ...result });

  } catch (err) {
    console.error(`[create-checkout] ${provider} error:`, err);
    try {
      await db.collection("checkoutSessions").doc(sessionId).update({
        status: "failed", error: err.message,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch(_) {}
    return res.status(500).json({ success: false, error: err.message });
  }
};
