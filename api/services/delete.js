/* FILE: api/services/delete.js */
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
  if (req.method !== "POST" && req.method !== "DELETE") return res.status(405).json({ error: "Method not allowed" });
  try {
    await requireAdmin(req);
    const { serviceId } = req.body || req.query;
    if (!serviceId) return res.status(400).json({ error: "serviceId is required" });
    await db.collection("services").doc(serviceId).update({
      status: "deleted", deleted: true,
      deletedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt:  admin.firestore.FieldValue.serverTimestamp(),
    });
    return res.status(200).json({ success: true });
  } catch (e) { return res.status(e.status||500).json({ error: e.message }); }
};
