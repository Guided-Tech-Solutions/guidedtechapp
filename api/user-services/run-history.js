/* FILE: api/user-services/run-history.js */
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
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    const decoded = await verifyToken(req);
    const { userServiceId, limit = "20" } = req.query;
    if (!userServiceId) return res.status(400).json({ error: "userServiceId is required" });
    const usSnap = await db.collection("users").doc(decoded.uid).collection("services").doc(userServiceId).get();
    if (!usSnap.exists) return res.status(404).json({ error: "Not found" });
    const snap = await db.collection("workflowRuns").where("userId","==",decoded.uid).where("userServiceId","==",userServiceId).limit(Math.min(Number(limit)||20,50)).get();
    const runs = [];
    snap.forEach(d => {
      const r = d.data();
      let duration = null;
      try { if (r.startedAt&&r.completedAt) { const s=r.startedAt.toDate?r.startedAt.toDate():new Date(r.startedAt); const e=r.completedAt.toDate?r.completedAt.toDate():new Date(r.completedAt); duration=Math.round(e-s)+"ms"; } } catch {}
      runs.push({ runId: r.runId||d.id, status: r.status, input: r.input||{}, output: r.output||null, error: r.error||null, startedAt: r.startedAt, completedAt: r.completedAt, createdAt: r.createdAt, duration });
    });
    return res.status(200).json({ success: true, runs });
  } catch (e) { return res.status(e.status||(e.code==="auth/argument-error"?401:500)).json({ error: e.message }); }
};
