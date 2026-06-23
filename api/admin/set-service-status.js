/* FILE: api/admin/set-service-status.js
   Moves a service through the lifecycle: draft → testing → active → draft
   Also sets the boolean `active` field used by the services page query.
*/
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

const VALID = ["draft", "testing", "active"];

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const adminUser = await requireAdmin(req);
    const { serviceId, status } = req.body;
    if (!serviceId) return res.status(400).json({ error: "serviceId is required" });
    if (!VALID.includes(status)) return res.status(400).json({ error: `status must be one of: ${VALID.join(", ")}` });

    const ref  = db.collection("services").doc(serviceId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Service not found" });

    const now = admin.firestore.FieldValue.serverTimestamp();
    await ref.update({
      status,
      active: status === "active",
      updatedAt: now,
    });

    await db.collection("adminActions").add({
      action: "set_service_status",
      adminUid: adminUser.uid,
      serviceId,
      serviceName: snap.data().name || serviceId,
      newStatus: status,
      createdAt: now,
    });

    return res.status(200).json({ success: true, status });
  } catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
};
