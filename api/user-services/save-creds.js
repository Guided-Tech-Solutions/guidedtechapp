/* ================================================================
   POST /api/user-services/save-creds
   Authenticated user — save sensitive credentials.

   Flow:
     1. Verify user owns the userService
     2. Validate against credentialsSchema
     3. Encrypt every credential value with AES-256-GCM
     4. Store encrypted values in:
           users/{uid}/credentials/{userServiceId}
     5. Store only the reference path in the userService doc
     6. Return success — never echo credentials back

   After this endpoint, the credentials are NEVER returned to the
   frontend.  Only the backend /activate endpoint decrypts them.
   ================================================================ */
const { db, admin } = require("../_lib/firebase");
const { verifyToken, sendError, cors } = require("../_lib/auth");
const { encryptCredentials } = require("../_lib/crypto");
const { validateSchema, stripExtraFields } = require("../_lib/schema-validator");

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const decoded = await verifyToken(req);
    const userId  = decoded.uid;

    const { userServiceId, credentials = {} } = req.body;
    if (!userServiceId) throw Object.assign(new Error("userServiceId is required"), { status: 400 });

    // Verify ownership
    const usRef  = db.collection("users").doc(userId).collection("services").doc(userServiceId);
    const usSnap = await usRef.get();
    if (!usSnap.exists()) throw Object.assign(new Error("User service not found"), { status: 404 });
    const us = usSnap.data();

    // Load service schema
    const svcSnap = await db.collection("services").doc(us.serviceId).get();
    if (!svcSnap.exists()) throw Object.assign(new Error("Service config not found"), { status: 404 });
    const svc    = svcSnap.data();
    const schema = svc.credentialsSchema || [];

    // Strip unknown keys
    const clean = stripExtraFields(schema, credentials);

    // Validate (partial OK — full validation on activate)
    const { errors } = validateSchema(schema.filter(f => f.required), clean);

    // Encrypt all credential values
    const encrypted = encryptCredentials(clean);

    // Store in a separate sub-collection so it's isolated from parameters
    const credRef = db.collection("users").doc(userId)
                      .collection("credentials").doc(userServiceId);
    await credRef.set({
      serviceId:    us.serviceId,
      userServiceId,
      credentials:  encrypted,
      updatedAt:    admin.firestore.FieldValue.serverTimestamp(),
      createdAt:    admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    // Update userService with just the reference path
    await usRef.update({
      credentialsRef: `users/${userId}/credentials/${userServiceId}`,
      updatedAt:      admin.firestore.FieldValue.serverTimestamp(),
    });

    // Return ONLY whether it succeeded — credentials are NEVER echoed back
    return res.status(200).json({
      success:  true,
      saved:    Object.keys(clean).length,
      warnings: errors,
    });

  } catch (err) {
    // Never log credential values
    if (err.message?.includes("CREDENTIAL_ENCRYPTION_KEY")) {
      return res.status(500).json({ success: false, error: "Server encryption not configured. Contact support." });
    }
    return sendError(res, err);
  }
};
