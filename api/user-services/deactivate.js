/* ================================================================
   POST /api/user-services/deactivate
   ================================================================ */
const { db, admin } = require("../_lib/firebase");
const { verifyToken, sendError, cors } = require("../_lib/auth");

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const decoded = await verifyToken(req);
    const userId  = decoded.uid;
    const { userServiceId } = req.body;
    if (!userServiceId) throw Object.assign(new Error("userServiceId is required"), { status: 400 });

    const usRef  = db.collection("users").doc(userId).collection("services").doc(userServiceId);
    const usSnap = await usRef.get();
    if (!usSnap.exists()) throw Object.assign(new Error("User service not found"), { status: 404 });

    await usRef.update({
      serviceStatus: "deactivated",
      updatedAt:     admin.firestore.FieldValue.serverTimestamp(),
    });
    return res.status(200).json({ success: true });
  } catch (err) { return sendError(res, err); }
};
