/* FILE: api/user-services/activate.js */
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
function decrypt(ciphertext) {
  const key = Buffer.from(process.env.CREDENTIAL_ENCRYPTION_KEY || "", "hex");
  if (key.length !== 32) throw new Error("CREDENTIAL_ENCRYPTION_KEY not configured");
  const [ivHex, tagHex, encHex] = String(ciphertext).split(":");
  const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  d.setAuthTag(Buffer.from(tagHex, "hex"));
  return d.update(Buffer.from(encHex, "hex")) + d.final("utf8");
}
function validateRequired(schema, values) {
  const errors = [];
  (schema || []).forEach(f => {
    const v = values[f.key];
    if (f.required && (v === undefined || v === null || String(v).trim() === "")) errors.push(`"${f.label || f.key}" is required`);
  });
  return { valid: errors.length === 0, errors };
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const decoded = await verifyToken(req);
    const userId = decoded.uid;
    const { userServiceId } = req.body;
    if (!userServiceId) return res.status(400).json({ error: "userServiceId is required" });

    const usRef  = db.collection("users").doc(userId).collection("services").doc(userServiceId);
    const usSnap = await usRef.get();
    if (!usSnap.exists) return res.status(404).json({ error: "User service not found" });
    const us = usSnap.data();

    const svcSnap = await db.collection("services").doc(us.serviceId).get();
    if (!svcSnap.exists) return res.status(404).json({ error: "Service not found" });
    const svc = svcSnap.data();

    if (svc.status !== "active") return res.status(400).json({ error: "This service is not available" });
    if (!["active","trialing"].includes(us.subscriptionStatus)) return res.status(403).json({ error: `Subscription is ${us.subscriptionStatus}` });
    if (us.subscriptionExpiresAt) {
      const exp = us.subscriptionExpiresAt.toDate ? us.subscriptionExpiresAt.toDate() : new Date(us.subscriptionExpiresAt);
      if (new Date() > exp) return res.status(403).json({ error: "Subscription has expired. Please renew." });
    }

    const paramCheck = validateRequired(svc.parametersSchema, us.parameters || {});
    if (!paramCheck.valid) return res.status(400).json({ error: "Missing parameters: " + paramCheck.errors.join("; ") });

    let decryptedCreds = {};
    if ((svc.credentialsSchema || []).length > 0) {
      if (!us.credentialsRef) return res.status(400).json({ error: "Credentials not saved yet. Please save your credentials first." });
      const credSnap = await db.doc(us.credentialsRef).get();
      if (!credSnap.exists) return res.status(400).json({ error: "Credentials not found. Please re-enter." });
      const raw = credSnap.data().credentials || {};
      Object.keys(raw).forEach(k => {
        try { decryptedCreds[k] = decrypt(raw[k]); } catch { decryptedCreds[k] = ""; }
      });
      const credCheck = validateRequired(svc.credentialsSchema, decryptedCreds);
      if (!credCheck.valid) return res.status(400).json({ error: "Missing credentials: " + credCheck.errors.join("; ") });
    }

    const webhookUrl = svc.n8n?.webhookUrl;
    if (!webhookUrl) return res.status(503).json({ error: "Automation not configured. Contact support." });

    const runId  = "run_" + crypto.randomBytes(10).toString("hex");
    const nowTs  = admin.firestore.FieldValue.serverTimestamp();
    const runRef = db.collection("workflowRuns").doc(runId);

    await runRef.set({ runId, userId, serviceId: us.serviceId, userServiceId, serviceName: svc.name || "", status: "queued", input: us.parameters || {}, output: null, error: null, startedAt: null, completedAt: null, createdAt: nowTs, updatedAt: nowTs });
    await usRef.update({ serviceStatus: "running", lastRunId: runId, lastRunAt: nowTs, updatedAt: nowTs });

    const APP_URL = process.env.APP_URL || "https://www.gtsamplify.com";
    fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-gts-secret": process.env.INTERNAL_API_SECRET || "" },
      body: JSON.stringify({ runId, userId, serviceId: us.serviceId, userServiceId, serviceName: svc.name, parameters: us.parameters || {}, credentials: decryptedCreds, callbackUrl: `${APP_URL}/api/n8n-callback`, callbackSecret: process.env.INTERNAL_API_SECRET || "" }),
    }).then(async r => {
      if (r.ok) {
        await runRef.update({ status: "running", startedAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      } else {
        throw new Error(`n8n returned ${r.status}`);
      }
    }).catch(async e => {
      console.error("[activate] n8n failed:", e.message);
      await runRef.update({ status: "failed", error: { message: e.message }, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      await usRef.update({ serviceStatus: "failed", updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    });

    return res.status(200).json({ success: true, runId });
  } catch (e) { return res.status(e.status||(e.code==="auth/argument-error"?401:500)).json({ error: e.message }); }
};
