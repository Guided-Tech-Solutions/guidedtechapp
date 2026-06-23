/* FILE: api/admin/grant-test-access.js */
const admin = require("firebase-admin");
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:  (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  })});
}
const db = admin.firestore();
async function requireAdmin(req) {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  if (!token) { const e = new Error("Unauthorized"); e.status = 401; throw e; }
  const decoded = await admin.auth().verifyIdToken(token);
  const snap = await db.collection("Admins").doc(decoded.uid).get();
  if (!snap.exists || !snap.data().active) { const e = new Error("Admin required"); e.status = 403; throw e; }
  return decoded;
}
function cors(res) { res.setHeader("Access-Control-Allow-Origin","*"); res.setHeader("Access-Control-Allow-Headers","Content-Type,Authorization"); }

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const adminUser = await requireAdmin(req);
    const { userId, serviceId, durationDays = 30 } = req.body;
    if (!userId || !serviceId) return res.status(400).json({ error: "userId and serviceId are required" });

    const svcSnap = await db.collection("services").doc(serviceId).get();
    if (!svcSnap.exists) return res.status(404).json({ error: "Service not found" });
    const svc = svcSnap.data();

    // Check if user already has a subscription to this service
    const existing = await db.collection("users").doc(userId).collection("services")
      .where("serviceId", "==", serviceId).limit(1).get();

    const now = admin.firestore.FieldValue.serverTimestamp();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + Number(durationDays));

    if (!existing.empty) {
      // Update existing record to active test access
      await existing.docs[0].ref.update({
        subscriptionStatus: "trialing",
        serviceStatus: "inactive",
        subscriptionExpiresAt: expiresAt,
        testAccess: true,
        testAccessGrantedBy: adminUser.uid,
        testAccessGrantedAt: now,
        updatedAt: now,
      });
      return res.status(200).json({ success: true, userServiceId: existing.docs[0].id, action: "updated" });
    }

    // Create new test subscription
    const ref = db.collection("users").doc(userId).collection("services").doc();
    await ref.set({
      serviceId,
      subscriptionStatus: "trialing",
      serviceStatus: "inactive",
      parameters: {},
      credentialsRef: null,
      lastRunId: null,
      subscriptionExpiresAt: expiresAt,
      testAccess: true,
      testAccessGrantedBy: adminUser.uid,
      testAccessGrantedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    // Log the grant action
    await db.collection("adminActions").add({
      action: "grant_test_access",
      adminUid: adminUser.uid,
      targetUserId: userId,
      serviceId,
      serviceName: svc.name || serviceId,
      durationDays: Number(durationDays),
      expiresAt,
      createdAt: now,
    });

    return res.status(201).json({ success: true, userServiceId: ref.id, action: "created" });
  } catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
};
