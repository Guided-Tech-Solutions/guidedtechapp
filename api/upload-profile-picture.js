/* FILE: api/upload-profile-picture.js */
const admin = require("firebase-admin");

const BUCKET = process.env.FIREBASE_STORAGE_BUCKET || "guidedtechapp.firebasestorage.app";

// Dedicated named app so storageBucket is always configured,
// regardless of what other functions initialised the default app first.
function getApp() {
  const name = "upload-app";
  const existing = admin.apps.find(a => a && a.name === name);
  if (existing) return existing;
  return admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    }),
    storageBucket: BUCKET,
  }, name);
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const token = (req.headers.authorization || "").replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  const app = getApp();

  let decoded;
  try {
    decoded = await admin.auth(app).verifyIdToken(token);
  } catch (e) {
    return res.status(401).json({ error: "Invalid token", detail: e.message });
  }

  const { base64, mimeType } = req.body || {};
  if (!base64 || !mimeType) return res.status(400).json({ error: "base64 and mimeType are required" });

  const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (!allowed.includes(mimeType)) return res.status(400).json({ error: "Unsupported image type" });

  let step = "decode";
  try {
    const buffer = Buffer.from(base64, "base64");
    if (buffer.length > 5 * 1024 * 1024) return res.status(400).json({ error: "File too large (max 5 MB)" });

    const ext  = mimeType.split("/")[1].replace("jpeg", "jpg");
    const name = `profile-pictures/${decoded.uid}/${Date.now()}.${ext}`;

    step = "get-bucket";
    const bucket = admin.storage(app).bucket();

    step = "save";
    const file = bucket.file(name);
    await file.save(buffer, { metadata: { contentType: mimeType }, resumable: false });

    step = "makePublic";
    await file.makePublic();

    const url = `https://storage.googleapis.com/${BUCKET}/${name}`;
    return res.status(200).json({ url });
  } catch (err) {
    console.error(`upload-profile-picture [${step}] error:`, err);
    return res.status(500).json({
      error: err.message || "Upload failed",
      code:  err.code,
      step,
    });
  }
};
