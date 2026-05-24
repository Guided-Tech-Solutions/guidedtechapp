/* FILE: api/user-services/save-params.js */
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
    const { userServiceId, parameters = {} } = req.body;
    if (!userServiceId) return res.status(400).json({ error: "userServiceId is required" });
    const usRef = db.collection("users").doc(decoded.uid).collection("services").doc(userServiceId);
    const usSnap = await usRef.get();
    if (!usSnap.exists) return res.status(404).json({ error: "Not found" });
    const svcSnap = await db.collection("services").doc(usSnap.data().serviceId).get();
    const schema = svcSnap.exists ? (svcSnap.data().parametersSchema || []) : [];
    const clean = {};
    schema.forEach(f => {
      if (parameters[f.key] !== undefined) clean[f.key] = parameters[f.key];
      else if (f.defaultValue !== undefined) clean[f.key] = f.defaultValue;
    });
    await usRef.update({ parameters: clean, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    return res.status(200).json({ success: true });
  } catch (e) { return res.status(e.status||(e.code==="auth/argument-error"?401:500)).json({ error: e.message }); }
};
