/* ================================================================
   POST /api/subscriptions/subscribe
   Authenticated user — subscribe to a service.
   Creates a userService record + subscription record.
   ================================================================ */
const { db, admin } = require("../_lib/firebase");
const { verifyToken, sendError, cors } = require("../_lib/auth");
const fetch = (...a) => import("node-fetch").then(({ default: f }) => f(...a));

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const decoded = await verifyToken(req);
    const userId  = decoded.uid;

    const { serviceId, provider = "stripe", paymentData = {} } = req.body;
    if (!serviceId) throw Object.assign(new Error("serviceId is required"), { status: 400 });

    // Load service
    const svcSnap = await db.collection("services").doc(serviceId).get();
    if (!svcSnap.exists()) throw Object.assign(new Error("Service not found"), { status: 404 });
    const svc = svcSnap.data();
    if (svc.status !== "active") throw Object.assign(new Error("This service is not currently available"), { status: 400 });

    // Prevent duplicate active subscriptions
    const existing = await db.collection("users").doc(userId)
      .collection("services")
      .where("serviceId", "==", serviceId)
      .where("subscriptionStatus", "in", ["active","trialing"])
      .limit(1).get();
    if (!existing.empty) throw Object.assign(new Error("You already have an active subscription to this service"), { status: 409 });

    const now = admin.firestore.FieldValue.serverTimestamp();

    // If free service (amount = 0), activate immediately
    if (svc.pricing?.amount === 0) {
      const userServiceRef = db.collection("users").doc(userId).collection("services").doc();
      await userServiceRef.set({
        serviceId,
        subscriptionStatus:   "active",
        serviceStatus:        "inactive",   // not yet activated by user
        parameters:           {},
        credentials:          {},           // will be filled via save-creds
        credentialsRef:       null,
        subscriptionStartedAt: now,
        subscriptionExpiresAt: null,        // free = never expires
        lastRunId:            null,
        createdAt:            now,
        updatedAt:            now,
      });
      return res.status(201).json({ success: true, userServiceId: userServiceRef.id, requiresPayment: false });
    }

    // Paid service — create checkout session
    const checkoutRes = await fetch(`${process.env.APP_URL}/api/checkout/create`, {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": req.headers.authorization,
      },
      body: JSON.stringify({ serviceId, provider, ...paymentData }),
    });
    const checkoutData = await checkoutRes.json();
    return res.status(200).json({ success: true, requiresPayment: true, ...checkoutData });

  } catch (err) {
    return sendError(res, err);
  }
};
