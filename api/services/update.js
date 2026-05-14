/* ================================================================
   PUT /api/services/update
   Admin only — update any service field
   ================================================================ */
const { db, admin } = require("../_lib/firebase");
const { requireAdmin, sendError, cors } = require("../_lib/auth");

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "PUT" && req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    await requireAdmin(req);

    const { serviceId, ...updates } = req.body;
    if (!serviceId) throw Object.assign(new Error("serviceId is required"), { status: 400 });

    const snap = await db.collection("services").doc(serviceId).get();
    if (!snap.exists()) throw Object.assign(new Error("Service not found"), { status: 404 });

    // Build clean update object — only allow known fields
    const allowed = [
      "name","description","category","status",
      "parametersSchema","credentialsSchema","n8n","pricing","activationRules"
    ];
    const patch = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
    for (const key of allowed) {
      if (updates[key] !== undefined) patch[key] = updates[key];
    }
    if (updates.n8n) {
      patch.n8n = { ...snap.data().n8n, ...updates.n8n };
    }

    await db.collection("services").doc(serviceId).update(patch);
    return res.status(200).json({ success: true });

  } catch (err) {
    return sendError(res, err);
  }
};
