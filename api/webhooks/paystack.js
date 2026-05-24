/* FILE: api/webhooks/paystack.js */
const crypto = require("crypto");
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
  const hash = crypto.createHmac("sha512", process.env.PAYSTACK_SECRET_KEY || "").update(rawBody).digest("hex");
  if (hash !== req.headers["x-paystack-signature"]) return res.status(400).json({ error: "Invalid signature" });
  let body;
  try { body = JSON.parse(rawBody.toString()); } catch { return res.status(400).json({ error: "Invalid JSON" }); }
  if (body.event === "charge.success") {
    try {
      const now = admin.firestore.FieldValue.serverTimestamp();
      const snap = await db.collection("checkoutSessions").where("reference","==",body.data.reference).limit(1).get();
      if (!snap.empty) {
        const sd = snap.docs[0].data();
        const batch = db.batch();
        batch.update(snap.docs[0].ref, { status: "completed", updatedAt: now });
        if (sd.userId && sd.serviceId) {
          const usRef = sd.userServiceId ? db.collection("users").doc(sd.userId).collection("services").doc(sd.userServiceId) : db.collection("users").doc(sd.userId).collection("services").doc();
          batch.set(usRef, { serviceId: sd.serviceId, subscriptionStatus: "active", serviceStatus: "inactive", parameters: {}, credentialsRef: null, subscriptionStartedAt: now, lastRunId: null, createdAt: now, updatedAt: now }, { merge: true });
        }
        await batch.commit();
      }
    } catch (e) { console.error("[paystack-webhook]", e.message); }
  }
  return res.status(200).json({ received: true });
};
