/* FILE: api/user-services/save-creds.js */
const admin  = require("firebase-admin");
const crypto = require("crypto");
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
function encrypt(text) {
  const key = Buffer.from(process.env.CREDENTIAL_ENCRYPTION_KEY || "", "hex");
  if (key.length !== 32) throw new Error("CREDENTIAL_ENCRYPTION_KEY must be 64 hex chars");
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(String(text), "utf8"), c.final()]);
  return [iv.toString("hex"), c.getAuthTag().toString("hex"), enc.toString("hex")].join(":");
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const decoded = await verifyToken(req);
    const userId = decoded.uid;
    const { userServiceId, credentials = {} } = req.body;
    if (!userServiceId) return res.status(400).json({ error: "userServiceId is required" });
    const usRef = db.collection("users").doc(userId).collection("services").doc(userServiceId);
    const usSnap = await usRef.get();
    if (!usSnap.exists) return res.status(404).json({ error: "Not found" });
    const svcSnap = await db.collection("services").doc(usSnap.data().serviceId).get();
    const schema = svcSnap.exists ? (svcSnap.data().credentialsSchema || []) : [];
    const encrypted = {};
    schema.forEach(f => { if (credentials[f.key]) encrypted[f.key] = encrypt(String(credentials[f.key])); });
    const credRef = db.collection("users").doc(userId).collection("credentials").doc(userServiceId);
    await credRef.set({ serviceId: usSnap.data().serviceId, userServiceId, credentials: encrypted, updatedAt: admin.firestore.FieldValue.serverTimestamp(), createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    await usRef.update({ credentialsRef: `users/${userId}/credentials/${userServiceId}`, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    return res.status(200).json({ success: true, saved: Object.keys(encrypted).length });
  } catch (e) {
    if (e.message?.includes("CREDENTIAL_ENCRYPTION_KEY")) return res.status(500).json({ error: "Encryption not configured. Set CREDENTIAL_ENCRYPTION_KEY in Vercel env vars." });
    return res.status(e.status||(e.code==="auth/argument-error"?401:500)).json({ error: e.message });
  }
};
