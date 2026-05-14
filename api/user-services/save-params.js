/* ================================================================
   POST /api/user-services/save-params
   Authenticated user — save (non-sensitive) service parameters.
   Parameters are stored as plain text in Firestore.
   ================================================================ */
const { db, admin } = require("../_lib/firebase");
const { verifyToken, sendError, cors } = require("../_lib/auth");
const { validateSchema, stripExtraFields, applyDefaults } = require("../_lib/schema-validator");

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const decoded = await verifyToken(req);
    const userId  = decoded.uid;

    const { userServiceId, parameters = {} } = req.body;
    if (!userServiceId) throw Object.assign(new Error("userServiceId is required"), { status: 400 });

    // Load userService — verify ownership
    const usRef  = db.collection("users").doc(userId).collection("services").doc(userServiceId);
    const usSnap = await usRef.get();
    if (!usSnap.exists()) throw Object.assign(new Error("User service not found"), { status: 404 });
    const us = usSnap.data();

    // Load service schema
    const svcSnap = await db.collection("services").doc(us.serviceId).get();
    if (!svcSnap.exists()) throw Object.assign(new Error("Service config not found"), { status: 404 });
    const svc = svcSnap.data();

    // Strip unknown keys, apply defaults, then validate
    const schema = svc.parametersSchema || [];
    const clean  = applyDefaults(schema, stripExtraFields(schema, parameters));

    // Only validate required fields on final save (allow partial saves during wizard)
    const { valid, errors } = validateSchema(
      schema.filter(f => f.required),
      clean
    );
    // We don't block partial saves — validation happens fully on activate

    await usRef.update({
      parameters: clean,
      updatedAt:  admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.status(200).json({ success: true, validated: valid, warnings: valid ? [] : errors });

  } catch (err) {
    return sendError(res, err);
  }
};
