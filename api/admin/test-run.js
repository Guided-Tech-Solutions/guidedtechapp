/* FILE: api/admin/test-run.js
   Admin triggers a workflow directly without needing a user subscription.
   Fires the n8n webhook with test parameters and stores the result in testRuns collection.
*/
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
    const { serviceId, parameters = {}, credentials = {} } = req.body;
    if (!serviceId) return res.status(400).json({ error: "serviceId is required" });

    const svcSnap = await db.collection("services").doc(serviceId).get();
    if (!svcSnap.exists) return res.status(404).json({ error: "Service not found" });
    const svc = svcSnap.data();

    const webhookUrl = svc.n8n?.webhookUrl;
    if (!webhookUrl) return res.status(503).json({ error: "No webhook URL configured on this service." });

    const runId  = "test_" + crypto.randomBytes(10).toString("hex");
    const now    = admin.firestore.FieldValue.serverTimestamp();
    const runRef = db.collection("testRuns").doc(runId);

    await runRef.set({
      runId,
      serviceId,
      serviceName: svc.name || "",
      adminUid: adminUser.uid,
      parameters,
      status: "queued",
      output: null,
      error: null,
      startedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const APP_URL = process.env.APP_URL || "https://www.gtsamplify.com";

    let n8nStatus = "unknown";
    let n8nError  = null;
    try {
      const r = await fetch(webhookUrl, {
        method:  "POST",
        headers: { "Content-Type": "application/json", "x-gts-secret": process.env.INTERNAL_API_SECRET || "" },
        body: JSON.stringify({
          runId,
          serviceId,
          serviceName: svc.name,
          parameters,
          credentials,
          isTestRun: true,
          callbackUrl: `${APP_URL}/api/n8n-callback`,
          callbackSecret: process.env.INTERNAL_API_SECRET || "",
        }),
      });
      n8nStatus = r.ok ? "running" : "failed";
      if (!r.ok) n8nError = `n8n returned HTTP ${r.status}`;
    } catch (e) {
      n8nStatus = "failed";
      n8nError  = e.message;
    }

    await runRef.update({
      status: n8nStatus,
      startedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(n8nError ? { error: { message: n8nError } } : {}),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.status(200).json({ success: true, runId, status: n8nStatus, error: n8nError });
  } catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
};
