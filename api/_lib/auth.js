/* ================================================================
   api/_lib/auth.js
   Verifies Firebase ID tokens on every incoming request.
   Also provides isAdmin() check against the Admins collection.
   ================================================================ */
const { auth, db } = require("./firebase");

/**
 * Verify the Firebase ID token in the Authorization header.
 * Returns the decoded token (which includes uid, email, etc.)
 * Throws a structured error if invalid.
 */
async function verifyToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  if (!header.startsWith("Bearer ")) {
    const err = new Error("Missing or malformed Authorization header");
    err.status = 401;
    throw err;
  }
  const token = header.slice(7);
  try {
    const decoded = await auth.verifyIdToken(token);
    return decoded;
  } catch (e) {
    const err = new Error("Invalid or expired token");
    err.status = 401;
    throw err;
  }
}

/**
 * Checks whether the given uid is in the Admins collection with active=true
 */
async function isAdmin(uid) {
  try {
    const snap = await db.collection("Admins").doc(uid).get();
    return snap.exists() && snap.data()?.active === true;
  } catch {
    return false;
  }
}

/**
 * Requires admin — throws 403 if not admin
 */
async function requireAdmin(req) {
  const decoded = await verifyToken(req);
  const admin   = await isAdmin(decoded.uid);
  if (!admin) {
    const err = new Error("Admin access required");
    err.status = 403;
    throw err;
  }
  return decoded;
}

/**
 * Standard error response helper
 */
function sendError(res, err) {
  const status  = err.status || 500;
  const message = err.message || "Internal server error";
  if (status >= 500) console.error("[API Error]", err);
  return res.status(status).json({ success: false, error: message });
}

/**
 * CORS + OPTIONS preflight helper — call at top of every handler
 */
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

module.exports = { verifyToken, isAdmin, requireAdmin, sendError, cors };
