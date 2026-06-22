/* FILE: api/upload-profile-picture.js */
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    }),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "guidedtechapp.firebasestorage.app",
  });
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

  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(token);
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }

  const { base64, mimeType, fileName } = req.body || {};
  if (!base64 || !mimeType) return res.status(400).json({ error: "base64 and mimeType are required" });

  const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (!allowed.includes(mimeType)) return res.status(400).json({ error: "Unsupported image type" });

  try {
    const buffer = Buffer.from(base64, "base64");
    if (buffer.length > 5 * 1024 * 1024) return res.status(400).json({ error: "File too large (max 5 MB)" });

    const ext  = mimeType.split("/")[1].replace("jpeg", "jpg");
    const name = `profile-pictures/${decoded.uid}/${Date.now()}.${ext}`;
    const bucket = admin.storage().bucket();
    const file   = bucket.file(name);

    await file.save(buffer, { metadata: { contentType: mimeType }, resumable: false });
    await file.makePublic();

    const url = `https://storage.googleapis.com/${bucket.name}/${name}`;
    return res.status(200).json({ url });
  } catch (err) {
    console.error("upload-profile-picture error:", err);
    return res.status(500).json({ error: err.message || "Upload failed" });
  }
};
