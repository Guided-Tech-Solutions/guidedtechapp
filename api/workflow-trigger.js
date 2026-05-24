/* FILE: api/workflow-trigger.js */
const admin = require("firebase-admin");
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:  (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  })});
}
const db = admin.firestore();
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || "";
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_UNIVERSAL || "";
const APP_URL         = process.env.APP_URL || "https://www.gtsamplify.com";

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Headers","Content-Type,x-internal-secret");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (req.headers["x-internal-secret"] !== INTERNAL_SECRET) return res.status(401).json({ error: "Unauthorized" });
  const { userId, serviceId, activationId, dashboardType, retrigger = false } = req.body;
  if (!userId || !serviceId) return res.status(400).json({ error: "userId and serviceId are required" });
  if (!N8N_WEBHOOK_URL) return res.status(200).json({ success: false, message: "N8N_WEBHOOK_UNIVERSAL not set in environment variables." });
  const configKey = `${userId}_${serviceId}`;
  try {
    const [configSnap, userSnap, serviceSnap] = await Promise.all([
      db.collection("serviceConfigs").doc(configKey).get(),
      db.collection("users").doc(userId).get(),
      db.collection("services").doc(serviceId).get(),
    ]);
    const config  = configSnap.exists  ? configSnap.data()  : {};
    const user    = userSnap.exists    ? userSnap.data()    : {};
    const service = serviceSnap.exists ? serviceSnap.data() : {};
    const workflowType = dashboardType || service.dashboardType || config.dashboardType || inferType(config);
    const payload = {
      workflowType, serviceName: service.name||"", serviceIcon: service.icon||"",
      userId, serviceId, configKey, activationId: activationId||null, retrigger,
      callbackUrl: `${APP_URL}/api/n8n-callback`, callbackSecret: INTERNAL_SECRET,
      client: { name: user.displayName||"", email: user.email||"", phone: user.phone||"", company: user.company||"", website: user.website||"" },
      service: { name: service.name||"", dashboardType: workflowType, price: service.pricing?.amount||0 },
      config: sanitize(config),
      targetUrl: config.targetUrl||user.website||"", notifyEmail: config.notifyEmail||user.email||"",
      siteUrl: config.siteUrl||user.website||"", seedKeywords: config.seedKeywords||"",
      useCase: config.useCase||"", currentProvider: config.currentProvider||"", targetCloud: config.targetCloud||"",
    };
    await db.collection("serviceConfigs").doc(configKey).set({ workflowStatus:"triggering", workflowType, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    const r = await fetch(N8N_WEBHOOK_URL, { method:"POST", headers:{"Content-Type":"application/json","x-gts-secret":INTERNAL_SECRET,"x-workflow-type":workflowType}, body: JSON.stringify(payload) });
    if (!r.ok) throw new Error(`n8n returned ${r.status}`);
    await db.collection("serviceConfigs").doc(configKey).set({ workflowStatus:"triggered", triggeredAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return res.status(200).json({ success: true, workflowType, configKey });
  } catch (e) {
    console.error("[workflow-trigger]", e.message);
    await db.collection("serviceConfigs").doc(configKey).set({ workflowStatus:"trigger_failed", triggerError: e.message, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }).catch(()=>{});
    return res.status(500).json({ success: false, error: e.message });
  }
};

function sanitize(config) {
  const skip = new Set(["userId","configured","configuredAt","updatedAt","workflowStatus","workflowType","lastActivityAt","triggeredAt","triggerError"]);
  const clean = {};
  for (const [k,v] of Object.entries(config)) { if (!skip.has(k)) clean[k]=v; }
  return clean;
}
function inferType(config) {
  if (config.targetUrl||config.captureMethod) return "lead_generation";
  if (config.targetCloud||config.currentProvider) return "cloud_migration";
  if (config.useCase||config.triggerEvent) return "automation";
  if (config.siteUrl||config.seedKeywords) return "seo";
  return "generic";
}
