/* FILE: api/n8n-callback.js */
const admin = require("firebase-admin");
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:  (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  })});
}
const db = admin.firestore();
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || "";

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Headers","Content-Type,x-gts-secret");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const headerSecret = req.headers["x-gts-secret"] || req.headers["x-internal-secret"] || "";
  const bodySecret   = req.body?.secret || req.body?.callbackSecret || "";
  if (INTERNAL_SECRET && headerSecret !== INTERNAL_SECRET && bodySecret !== INTERNAL_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { userId, serviceId, workflowType, action, data = {} } = req.body;
  if (!userId || !serviceId || !action) return res.status(400).json({ error: "userId, serviceId, and action are required" });

  const configKey = `${userId}_${serviceId}`;
  try {
    let result = {};
    switch (action) {

      case "add_lead": {
        const leadRef = db.collection("serviceData").doc(configKey).collection("leads").doc();
        await leadRef.set({ name: data.name||"Unknown", email: data.email||"", phone: data.phone||"", company: data.company||"", source: data.source||"website", score: data.score||scoreLead(data), status: data.status||"new", message: data.message||"", pageUrl: data.pageUrl||"", utm: data.utm||{}, rawData: data.rawData||{}, createdAt: admin.firestore.FieldValue.serverTimestamp() });
        await notify(userId, { title:"New lead captured! 🎯", message:`${data.name||"Someone"} submitted on ${data.source||"your website"}`, type:"lead" });
        result = { leadId: leadRef.id };
        break;
      }

      case "update_metrics": {
        const ref = db.collection("serviceData").doc(configKey).collection("seoMetrics").doc();
        await ref.set({ domainAuthority: Number(data.domainAuthority)||0, organicVisitors: Number(data.organicVisitors)||0, keywordsRanked: Number(data.keywordsRanked)||0, backlinks: Number(data.backlinks)||0, pageSpeed: Number(data.pageSpeed)||0, coreWebVitals: data.coreWebVitals||"Pass", source: data.source||"manual", createdAt: admin.firestore.FieldValue.serverTimestamp() });
        result = { metricId: ref.id };
        break;
      }

      case "update_keywords": {
        const keywords = Array.isArray(data.keywords) ? data.keywords : [data];
        const batch = db.batch();
        keywords.forEach(kw => {
          const kwId = (kw.keyword||"").toLowerCase().replace(/\s+/g,"_").replace(/[^a-z0-9_]/g,"");
          const kwRef = db.collection("serviceData").doc(configKey).collection("keywords").doc(kwId||db.collection("_").doc().id);
          batch.set(kwRef, { keyword: kw.keyword||"", position: Number(kw.position)||0, prevPos: Number(kw.prevPos)||0, change: Number(kw.change)||(kw.prevPos?kw.prevPos-kw.position:0), volume: Number(kw.volume)||0, url: kw.url||"", updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        });
        await batch.commit();
        result = { updated: keywords.length };
        break;
      }

      case "log_run": {
        const ref = db.collection("serviceData").doc(configKey).collection("automationRuns").doc();
        await ref.set({ name: data.name||data.workflowName||"Automation Run", workflowName: data.workflowName||"", status: data.status||"success", duration: data.duration||"", error: data.error||null, itemsProcessed: Number(data.itemsProcessed)||0, detail: data.detail||"", createdAt: admin.firestore.FieldValue.serverTimestamp() });
        if (data.status === "failed") await notify(userId, { title:"Automation failed", message:`${data.name||"An automation"} failed: ${data.error||"unknown error"}`, type:"error" });
        result = { runId: ref.id };
        break;
      }

      case "update_migration": {
        const updates = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
        if (Array.isArray(data.phases)) updates.phases = data.phases;
        if (data.phaseName) {
          const configDoc = await db.collection("serviceConfigs").doc(configKey).get();
          const phases = configDoc.exists ? (configDoc.data().phases || []) : [];
          const idx = phases.findIndex(p => p.name === data.phaseName);
          if (idx >= 0) { phases[idx].status = data.phaseStatus||"done"; phases[idx].completedAt = new Date().toISOString(); }
          updates.phases = phases;
        }
        if (data.overallProgress !== undefined) updates.overallProgress = Number(data.overallProgress);
        await db.collection("serviceConfigs").doc(configKey).set(updates, { merge: true });
        await notify(userId, { title:"Migration update", message: data.detail||`Phase "${data.phaseName}" is ${data.phaseStatus}`, type:"info" });
        result = { updated: true };
        break;
      }

      case "log_event": {
        const ref = db.collection("serviceData").doc(configKey).collection("migrationEvents").doc();
        await ref.set({ message: data.message||"", type: data.type||"info", event: data.event||"", dataMoved: data.dataMoved||"", filesMoved: data.filesMoved||"", eta: data.eta||"", createdAt: admin.firestore.FieldValue.serverTimestamp() });
        result = { eventId: ref.id };
        break;
      }

      case "set_status": {
        await db.collection("serviceConfigs").doc(configKey).set({ workflowStatus: data.status||"running", workflowNote: data.note||"", updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        result = { updated: true };
        break;
      }

      case "send_notification": {
        await notify(userId, { title: data.title||"Update from GTS Amplify", message: data.message||"", type: data.type||"info", link: data.link });
        result = { notified: true };
        break;
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    await db.collection("serviceConfigs").doc(configKey).set({ lastActivityAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return res.status(200).json({ success: true, action, result });
  } catch (e) { console.error("[n8n-callback]", e.message); return res.status(500).json({ success: false, error: e.message }); }
};

function scoreLead(data) {
  const msg = (data.message||"").toLowerCase();
  if (["demo","pricing","buy","purchase","asap","urgent","quote"].some(s => msg.includes(s))) return "hot";
  if (["student","browsing","research","newsletter"].some(s => msg.includes(s))) return "cold";
  if (data.company) return "hot";
  return "warm";
}

async function notify(userId, { title, message, type, link }) {
  return db.collection("notifications").add({ userId, title, message, type, link: link||"/app/portal-dashboard.html", read: false, createdAt: admin.firestore.FieldValue.serverTimestamp() });
}
