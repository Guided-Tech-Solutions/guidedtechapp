/* FILE: api/checkout/verify.js */
const admin = require("firebase-admin");
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:  (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  })});
}
const db = admin.firestore();
function cors(res) { res.setHeader("Access-Control-Allow-Origin","*"); res.setHeader("Access-Control-Allow-Headers","Content-Type,Authorization"); }

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { reference, session_id, token, provider } = req.query;
    const ref = reference || session_id || token;
    if (!ref) return res.status(400).json({ error: "Missing reference" });
    let snap = await db.collection("checkoutSessions").where("reference","==",ref).limit(1).get();
    if (snap.empty) snap = await db.collection("checkoutSessions").where("sessionId","==",ref).limit(1).get();
    if (snap.empty) snap = await db.collection("checkoutSessions").where("orderId","==",ref).limit(1).get();
    if (snap.empty) return res.status(404).json({ success: false, status: "not_found" });
    const data = snap.docs[0].data();
    return res.status(200).json({ success: true, status: data.status || "pending", serviceId: data.serviceId || null, userServiceId: data.userServiceId || null, provider: data.provider || provider || "unknown" });
  } catch (e) { return res.status(500).json({ error: e.message }); }
};
