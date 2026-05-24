/* FILE: api/user-services/dashboard.js */
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
    const userId = decoded.uid;
    const usSnap = await db.collection("users").doc(userId).collection("services").get();
    if (usSnap.empty) return res.status(200).json({ success: true, services: [] });
    const serviceIds = [...new Set(usSnap.docs.map(d => d.data().serviceId))];
    const svcSnaps = await Promise.all(serviceIds.map(id => db.collection("services").doc(id).get()));
    const svcMap = {};
    svcSnaps.forEach(s => { if (s.exists) svcMap[s.id] = s.data(); });
    const lastRunIds = usSnap.docs.map(d => d.data().lastRunId).filter(Boolean);
    const runSnaps = lastRunIds.length ? await Promise.all(lastRunIds.map(id => db.collection("workflowRuns").doc(id).get())) : [];
    const runMap = {};
    runSnaps.forEach(s => { if (s.exists) runMap[s.id] = s.data(); });
    const services = usSnap.docs.map(d => {
      const us = d.data(); const svc = svcMap[us.serviceId] || {}; const run = us.lastRunId ? runMap[us.lastRunId] : null;
      return { userServiceId: d.id, serviceId: us.serviceId, name: svc.name || "", description: svc.description || "", category: svc.category || "", icon: svc.icon || "⚙️", subscriptionStatus: us.subscriptionStatus, serviceStatus: us.serviceStatus, subscriptionStartedAt: us.subscriptionStartedAt, subscriptionExpiresAt: us.subscriptionExpiresAt, parameters: us.parameters || {}, hasCredentials: !!us.credentialsRef, parametersSchema: svc.parametersSchema || [], credentialsSchema: svc.credentialsSchema || [], lastRunId: us.lastRunId || null, lastRun: run ? { status: run.status, startedAt: run.startedAt, completedAt: run.completedAt, output: run.output || null, error: run.error || null } : null, createdAt: us.createdAt, updatedAt: us.updatedAt };
    });
    return res.status(200).json({ success: true, services });
  } catch (e) { return res.status(e.status||(e.code==="auth/argument-error"?401:500)).json({ error: e.message }); }
};
