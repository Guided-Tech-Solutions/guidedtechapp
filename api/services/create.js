/* FILE: api/services/create.js */
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
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    await requireAdmin(req);
    const { name, description, category, status = "inactive", parametersSchema = [], credentialsSchema = [], n8n = {}, pricing = {}, activationRules = {}, icon = "⚙️", features = [] } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "Service name is required" });
    if (!n8n.webhookUrl?.trim()) return res.status(400).json({ error: "n8n webhookUrl is required" });
    const now = admin.firestore.FieldValue.serverTimestamp();
    const ref = await db.collection("services").add({
      name: name.trim(), description: description?.trim() || "", category: category?.trim() || "General",
      status: ["active","inactive"].includes(status) ? status : "inactive", icon, features,
      parametersSchema, credentialsSchema,
      n8n: { workflowId: n8n.workflowId || "", webhookUrl: n8n.webhookUrl.trim() },
      pricing: { type: "subscription", amount: Number(pricing.amount) || 0, currency: pricing.currency || "USD", interval: pricing.interval || "month" },
      activationRules: { cooldownMinutes: activationRules.cooldownMinutes || null, maxRunsPerDay: activationRules.maxRunsPerDay || null },
      createdAt: now, updatedAt: now,
    });
    return res.status(201).json({ success: true, serviceId: ref.id });
  } catch (e) { return res.status(e.status||500).json({ error: e.message }); }
};
