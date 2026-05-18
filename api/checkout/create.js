/* FILE: api/checkout/create.js */
const admin = require("firebase-admin");
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:  (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  })});
}
const db = admin.firestore();
async function verifyToken(req) {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  if (!token) { const e = new Error("Unauthorized"); e.status = 401; throw e; }
  return admin.auth().verifyIdToken(token);
}
async function requireAdmin(req) {
  const decoded = await verifyToken(req);
  const snap = await db.collection("Admins").doc(decoded.uid).get();
  if (!snap.exists || !snap.data().active) { const e = new Error("Admin access required"); e.status = 403; throw e; }
  return decoded;
}
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}
function sendError(res, err) {
  const s = err.status || (err.code === "auth/argument-error" ? 401 : 500);
  if (s >= 500) console.error(err.message);
  return res.status(s).json({ error: err.message || "Server error" });
}
/* ================================================================
   POST /api/checkout/create
   Creates a payment checkout session for subscribing to a service.
   Supports Stripe, Paystack, PayPal.
   ================================================================ */
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const crypto = require("crypto");

const APP_URL = process.env.APP_URL || "https://www.gtsamplify.com";

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const decoded = await verifyToken(req);
    const userId  = decoded.uid;

    const { serviceId, provider = "stripe" } = req.body;
    if (!serviceId) throw Object.assign(new Error("serviceId is required"), { status: 400 });

    const svcSnap = await db.collection("services").doc(serviceId).get();
    if (!svcSnap.exists()) throw Object.assign(new Error("Service not found"), { status: 404 });
    const svc = svcSnap.data();
    if (svc.status !== "active") throw Object.assign(new Error("Service not available"), { status: 400 });

    const userSnap = await db.collection("users").doc(userId).get();
    const user     = userSnap.exists() ? userSnap.data() : {};
    const email    = user.email || decoded.email || "";

    const amount   = Number(svc.pricing?.amount)   || 0;
    const currency = svc.pricing?.currency || "USD";
    const interval = svc.pricing?.interval || "month";
    const name     = svc.name || "GTS Amplify Service";

    // Create a pending userService record
    const usRef = db.collection("users").doc(userId).collection("services").doc();
    await usRef.set({
      serviceId,
      subscriptionStatus: "pending_payment",
      serviceStatus:      "inactive",
      parameters:         {},
      credentialsRef:     null,
      lastRunId:          null,
      createdAt:          admin.firestore.FieldValue.serverTimestamp(),
      updatedAt:          admin.firestore.FieldValue.serverTimestamp(),
    });

    const successUrl = `${APP_URL}/app/payment-success.html`;
    const cancelUrl  = `${APP_URL}/app/portal-services.html?canceled=true`;

    let result = {};

    if (provider === "stripe") {
      // Create or find Stripe customer
      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({ email, metadata: { userId } });
        customerId = customer.id;
        await db.collection("users").doc(userId).update({ stripeCustomerId: customerId });
      }

      // Create price
      const price = await stripe.prices.create({
        currency,
        unit_amount:   Math.round(amount * 100),
        recurring:     { interval },
        product_data:  { name },
      });

      // Create checkout session
      const session = await stripe.checkout.sessions.create({
        customer:             customerId,
        payment_method_types: ["card"],
        mode:                 "subscription",
        line_items: [{ price: price.id, quantity: 1 }],
        success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}&provider=stripe`,
        cancel_url:  cancelUrl,
        metadata: { userId, serviceId, userServiceId: usRef.id },
      });

      result = { provider: "stripe", checkoutUrl: session.url, sessionId: session.id };

    } else if (provider === "paystack") {
      const ref  = "gts_" + crypto.randomBytes(8).toString("hex");
      const body = {
        email, amount: Math.round(amount * 100), currency: "USD", reference: ref,
        callback_url: `${successUrl}?reference=${ref}&provider=paystack`,
        metadata: { userId, serviceId, userServiceId: usRef.id, cancel_action: cancelUrl },
        plan: "",   // For subscriptions, use a Paystack plan ID if available
      };
      const pRes  = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      const pData = await pRes.json();
      if (!pData.status) throw new Error(pData.message || "Paystack init failed");
      result = { provider: "paystack", authorizationUrl: pData.data.authorization_url, reference: ref };

    } else if (provider === "paypal") {
      const ppMode   = process.env.PAYPAL_MODE === "live" ? "api" : "api.sandbox";
      const tokRes   = await fetch(`https://${ppMode}.paypal.com/v1/oauth2/token`, {
        method: "POST",
        headers: {
          Authorization: "Basic " + Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      });
      const tokData = await tokRes.json();
      if (!tokData.access_token) throw new Error("PayPal auth failed");

      const ppRes  = await fetch(`https://${ppMode}.paypal.com/v2/checkout/orders`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tokData.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "CAPTURE",
          purchase_units: [{ description: name, amount: { currency_code: currency, value: amount.toFixed(2) }, custom_id: usRef.id }],
          application_context: {
            return_url: `${successUrl}?provider=paypal`,
            cancel_url: cancelUrl,
            brand_name: "GTS Amplify",
            user_action: "PAY_NOW",
          },
        }),
      });
      const ppData = await ppRes.json();
      const approvalUrl = ppData.links?.find(l => l.rel === "approve")?.href;
      if (!approvalUrl) throw new Error("PayPal: no approval URL");
      result = { provider: "paypal", approvalUrl, orderId: ppData.id };
    }

    // Record checkout in Firestore
    await db.collection("checkoutSessions").add({
      userId, serviceId, userServiceId: usRef.id,
      provider, amount, currency,
      status: "pending",
      ...result,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.status(200).json({ success: true, userServiceId: usRef.id, ...result });

  } catch (err) {
    return sendError(res, err);
  }
};
