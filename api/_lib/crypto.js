/* ================================================================
   api/_lib/crypto.js
   AES-256-GCM encryption for sensitive credentials stored in
   Firestore.  The encryption key lives ONLY in environment
   variables — never in Firestore or logs.

   Why not Google Secret Manager?
   Secret Manager adds latency and IAM complexity.  AES-256-GCM
   with a strong env-var key gives equivalent security for
   credentials at rest while keeping the system simple.

   Key: CREDENTIAL_ENCRYPTION_KEY must be a 64-char hex string
        (32 bytes = 256 bits).
   Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ================================================================ */
const crypto = require("crypto");

const ALGO    = "aes-256-gcm";
const KEY_HEX = process.env.CREDENTIAL_ENCRYPTION_KEY || "";

function getKey() {
  if (!KEY_HEX || KEY_HEX.length !== 64) {
    throw new Error(
      "CREDENTIAL_ENCRYPTION_KEY must be a 64-char hex string in env vars. " +
      "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  return Buffer.from(KEY_HEX, "hex");
}

/**
 * Encrypt a plain-text string.
 * Returns a single base64 string: iv:authTag:ciphertext
 */
function encrypt(plaintext) {
  const key    = getKey();
  const iv     = crypto.randomBytes(12);           // 96-bit IV for GCM
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc    = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag    = cipher.getAuthTag();
  // Encode as iv(hex):tag(hex):cipher(hex)
  return [iv.toString("hex"), tag.toString("hex"), enc.toString("hex")].join(":");
}

/**
 * Decrypt a string produced by encrypt().
 */
function decrypt(ciphertext) {
  const key    = getKey();
  const parts  = String(ciphertext).split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted credential format");
  const [ivHex, tagHex, encHex] = parts;
  const iv      = Buffer.from(ivHex,  "hex");
  const tag     = Buffer.from(tagHex, "hex");
  const encBuf  = Buffer.from(encHex, "hex");
  const decipher= crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encBuf) + decipher.final("utf8");
}

/**
 * Encrypt a whole object of credential key/values.
 * Each value is encrypted independently.
 * Returns { key: encryptedValue, ... }
 */
function encryptCredentials(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    out[k] = v ? encrypt(String(v)) : "";
  }
  return out;
}

/**
 * Decrypt a whole object of encrypted credential values.
 * Returns { key: plaintext, ... }
 */
function decryptCredentials(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    try {
      out[k] = v ? decrypt(String(v)) : "";
    } catch {
      out[k] = "";   // Don't crash if a single field is corrupted
    }
  }
  return out;
}

module.exports = { encrypt, decrypt, encryptCredentials, decryptCredentials };
