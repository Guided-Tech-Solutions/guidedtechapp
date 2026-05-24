/* FILE: api/webhooks/stripe.js */
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const admin  = require("firebase-admin");
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:  (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  })});
}
const db = admin.firestore();
module.exports.config = { api: { bodyParser: false } };

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks);
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) { return res.status(400).json({ error: e.message }); }
  const now = admin.firestore.FieldValue.serverTimestamp();
  try {
    if (event.type === "checkout.session.completed" && event.data.object.mode === "subscription") {
      const session = event.data.object;
      const sub = await stripe.subscriptions.retrieve(session.subscription);
      const exp = new Date(sub.current_period_end * 1000);
      const meta = session.metadata || {};
      const usRef = meta.userServiceId ? db.collection("users").doc(meta.userId).collection("services").doc(meta.userServiceId) : db.collection("users").doc(meta.userId).collection("services").doc();
      await usRef.set({ serviceId: meta.serviceId, subscriptionStatus: "active", serviceStatus: "inactive", parameters: {}, credentialsRef: null, subscriptionStartedAt: now, subscriptionExpiresAt: admin.firestore.Timestamp.fromDate(exp), stripeSubscriptionId: sub.id, stripeCustomerId: session.customer, lastRunId: null, createdAt: now, updatedAt: now }, { merge: true });
      await db.collection("subscriptions").add({ userId: meta.userId, serviceId: meta.serviceId, userServiceId: usRef.id, provider: "stripe", stripeCustomerId: session.customer, stripeSubscriptionId: sub.id, status: "active", currentPeriodEnd: admin.firestore.Timestamp.fromDate(exp), createdAt: now, updatedAt: now });
    } else if (event.type === "invoice.payment_succeeded") {
      const subId = event.data.object.subscription;
      if (subId) { const sub = await stripe.subscriptions.retrieve(subId); const exp = new Date(sub.current_period_end * 1000); await updateByStripeSubId(subId, { subscriptionStatus: "active", subscriptionExpiresAt: admin.firestore.Timestamp.fromDate(exp), updatedAt: now }); }
    } else if (event.type === "invoice.payment_failed") {
      const subId = event.data.object.subscription;
      if (subId) await updateByStripeSubId(subId, { subscriptionStatus: "payment_failed", updatedAt: now });
    } else if (event.type === "customer.subscription.deleted") {
      await updateByStripeSubId(event.data.object.id, { subscriptionStatus: "cancelled", serviceStatus: "deactivated", updatedAt: now });
    }
    return res.status(200).json({ received: true });
  } catch (e) { console.error("[stripe-webhook]", e.message); return res.status(500).json({ error: e.message }); }
};

async function updateByStripeSubId(stripeSubId, fields) {
  const snap = await db.collectionGroup("services").where("stripeSubscriptionId","==",stripeSubId).get();
  if (snap.empty) return;
  const batch = db.batch();
  snap.forEach(d => batch.update(d.ref, fields));
  await batch.commit();
}
