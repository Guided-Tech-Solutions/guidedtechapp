/* ================================================================
   DELETE /api/services/delete
   Admin only — soft-delete (marks deleted=true) to preserve history
   ================================================================ */
const { db, admin } = require("../_lib/firebase");
const { requireAdmin, sendError, cors } = require("../_lib/auth");

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "DELETE" && req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    await requireAdmin(req);
    const { serviceId } = req.body || req.query;
    if (!serviceId) throw Object.assign(new Error("serviceId is required"), { status: 400 });

    await db.collection("services").doc(serviceId).update({
      status:    "deleted",
      deleted:   true,
      deletedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    return sendError(res, err);
  }
};
