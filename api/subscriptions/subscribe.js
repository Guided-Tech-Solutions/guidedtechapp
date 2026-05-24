/* FILE: api/subscriptions/subscribe.js */
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
function cors(res) { res.setHeader("Access-Control-Allow-Origin","*"); res.setHeader("Access-Control-Allow-Headers","Content-Type,Authorization"); }

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const decoded = await verifyToken(req);
    const userId = decoded.uid;
    const { serviceId, provider = "stripe" } = req.body;
    if (!serviceId) return res.status(400).json({ error: "serviceId is required" });
    const svcSnap = await db.collection("services").doc(serviceId).get();
    if (!svcSnap.exists) return res.status(404).json({ error: "Service not found" });
    const svc = svcSnap.data();
    if (svc.status !== "active") return res.status(400).json({ error: "Service not available" });
    const existing = await db.collection("users").doc(userId).collection("services")
      .where("serviceId","==",serviceId).where("subscriptionStatus","in",["active","trialing"]).limit(1).get();
    if (!existing.empty) return res.status(409).json({ error: "Already subscribed to this service" });
    const now = admin.firestore.FieldValue.serverTimestamp();
    const amount = Number(svc.pricing?.amount) || 0;
    if (amount === 0) {
      const ref = db.collection("users").doc(userId).collection("services").doc();
      await ref.set({ serviceId, subscriptionStatus: "active", serviceStatus: "inactive", parameters: {}, credentialsRef: null, subscriptionStartedAt: now, subscriptionExpiresAt: null, lastRunId: null, createdAt: now, updatedAt: now });
      return res.status(201).json({ success: true, userServiceId: ref.id, requiresPayment: false });
    }
    const ref = db.collection("users").doc(userId).collection("services").doc();
    await ref.set({ serviceId, subscriptionStatus: "pending_payment", serviceStatus: "inactive", parameters: {}, credentialsRef: null, lastRunId: null, createdAt: now, updatedAt: now });
    return res.status(200).json({ success: true, requiresPayment: true, userServiceId: ref.id, serviceId, provider, amount: svc.pricing?.amount, currency: svc.pricing?.currency || "USD", serviceName: svc.name });
  } catch (e) { return res.status(e.status||(e.code==="auth/argument-error"?401:500)).json({ error: e.message }); }
};
