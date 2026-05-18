/* FILE: api/n8n-callback.js */
/* ================================================================
   GTS Amplify — n8n Results Receiver

   n8n calls this endpoint to write results back to Firestore.
   Payload envelope:
   {
     secret:       "your-internal-secret",
     userId:       "firebase-uid",
     serviceId:    "firestore-service-doc-id",
     workflowType: "lead_generation" | "seo" | "automation" | "cloud_migration",
     action:       "add_lead" | "update_metrics" | "update_keywords" |
                   "log_run" | "update_migration" | "log_event" |
                   "set_status" | "send_notification",
     data:         { ...the actual payload }
   }
   ================================================================ */

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
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-gts-secret");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")    return res.status(405).json({ error: "Method not allowed" });

  // Verify secret — n8n sends it in header or body
  const headerSecret = req.headers["x-gts-secret"] || req.headers["x-internal-secret"] || "";
  const bodySecret   = req.body?.secret || req.body?.callbackSecret || "";
  if (INTERNAL_SECRET && headerSecret !== INTERNAL_SECRET && bodySecret !== INTERNAL_SECRET) {
    console.warn("[n8n-callback] Invalid secret");
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { userId, serviceId, workflowType, action, data = {} } = req.body;

  if (!userId || !serviceId || !action) {
    return res.status(400).json({ error: "userId, serviceId, and action are required" });
  }

  const configKey = `${userId}_${serviceId}`;
  console.log(`[n8n-callback] ${workflowType} / ${action} for ${configKey}`);

  try {
    let result = {};

    switch (action) {

      /* ── LEAD GENERATION ─────────────────────────────────────── */
      case "add_lead": {
        const leadRef = db.collection("serviceData").doc(configKey)
                          .collection("leads").doc();
        await leadRef.set({
          name:      data.name    || "Unknown",
          email:     data.email   || "",
          phone:     data.phone   || "",
          company:   data.company || "",
          source:    data.source  || "website",
          score:     data.score   || scoreLead(data),
          status:    data.status  || "new",
          message:   data.message || "",
          pageUrl:   data.pageUrl || "",
          utm:       data.utm     || {},
          rawData:   data.rawData || {},
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        await createNotification(userId, {
          title:   "New lead captured! 🎯",
          message: `${data.name || "Someone"} submitted a form on ${data.source || "your website"}`,
          type:    "lead",
          link:    "/app/portal-dashboard.html",
        });
        result = { leadId: leadRef.id };
        break;
      }

      /* ── SEO — full metrics snapshot ─────────────────────────── */
      case "update_metrics": {
        const metricRef = db.collection("serviceData").doc(configKey)
                            .collection("seoMetrics").doc();
        await metricRef.set({
          domainAuthority: Number(data.domainAuthority) || 0,
          organicVisitors: Number(data.organicVisitors) || 0,
          keywordsRanked:  Number(data.keywordsRanked)  || 0,
          backlinks:       Number(data.backlinks)        || 0,
          pageSpeed:       Number(data.pageSpeed)        || 0,
          coreWebVitals:   data.coreWebVitals            || "Pass",
          source:          data.source                  || "manual",
          createdAt:       admin.firestore.FieldValue.serverTimestamp(),
        });
        result = { metricId: metricRef.id };
        break;
      }

      /* ── SEO — keyword ranking updates ───────────────────────── */
      case "update_keywords": {
        const keywords = Array.isArray(data.keywords) ? data.keywords : [data];
        const batch    = db.batch();
        keywords.forEach(kw => {
          const kwId  = (kw.keyword || "").toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
          const kwRef = db.collection("serviceData").doc(configKey)
                          .collection("keywords").doc(kwId || db.collection("_").doc().id);
          batch.set(kwRef, {
            keyword:   kw.keyword             || "",
            position:  Number(kw.position)    || 0,
            prevPos:   Number(kw.prevPos)     || 0,
            change:    Number(kw.change)      || (kw.prevPos ? kw.prevPos - kw.position : 0),
            volume:    Number(kw.volume)      || 0,
            url:       kw.url                 || "",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
        });
        await batch.commit();
        result = { updated: keywords.length };
        break;
      }

      /* ── AUTOMATION — log a workflow run ─────────────────────── */
      case "log_run": {
        const runRef = db.collection("serviceData").doc(configKey)
                         .collection("automationRuns").doc();
        await runRef.set({
          name:           data.name           || data.workflowName || "Automation Run",
          workflowName:   data.workflowName   || "",
          workflowId:     data.workflowId     || "",
          trigger:        data.trigger        || "",
          status:         data.status         || "success",
          duration:       data.duration       || "",
          error:          data.error          || null,
          itemsProcessed: Number(data.itemsProcessed) || 0,
          detail:         data.detail         || "",
          createdAt:      admin.firestore.FieldValue.serverTimestamp(),
        });
        if (data.status === "failed") {
          await createNotification(userId, {
            title:   "⚠️ Automation failed",
            message: `${data.name || "An automation"} failed: ${data.error || "unknown error"}`,
            type:    "error",
            link:    "/app/portal-dashboard.html",
          });
        }
        result = { runId: runRef.id };
        break;
      }

      /* ── CLOUD MIGRATION — update phase statuses ─────────────── */
      case "update_migration": {
        const updates = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
        if (Array.isArray(data.phases)) {
          updates.phases = data.phases;
        }
        if (data.phaseName) {
          const configDoc = await db.collection("serviceConfigs").doc(configKey).get();
          const existing  = configDoc.exists ? configDoc.data() : {};
          const phases    = existing.phases || [];
          const idx       = phases.findIndex(p => p.name === data.phaseName);
          if (idx >= 0) {
            phases[idx].status      = data.phaseStatus || "done";
            phases[idx].detail      = data.detail || phases[idx].detail;
            phases[idx].completedAt = new Date().toISOString();
          }
          updates.phases = phases;
        }
        if (data.overallProgress !== undefined) {
          updates.overallProgress = Number(data.overallProgress);
        }
        await db.collection("serviceConfigs").doc(configKey).set(updates, { merge: true });
        await createNotification(userId, {
          title:   "☁️ Migration update",
          message: data.detail || `Phase "${data.phaseName}" is now ${data.phaseStatus}`,
          type:    "info",
          link:    "/app/portal-dashboard.html",
        });
        result = { updated: true };
        break;
      }

      /* ── CLOUD MIGRATION — append event log entry ────────────── */
      case "log_event": {
        const eventRef = db.collection("serviceData").doc(configKey)
                           .collection("migrationEvents").doc();
        await eventRef.set({
          message:    data.message    || data.event || "",
          type:       data.type       || "info",
          event:      data.event      || "",
          dataMoved:  data.dataMoved  || "",
          filesMoved: data.filesMoved || "",
          eta:        data.eta        || "",
          createdAt:  admin.firestore.FieldValue.serverTimestamp(),
        });
        result = { eventId: eventRef.id };
        break;
      }

      /* ── GENERAL — update workflow status ────────────────────── */
      case "set_status": {
        await db.collection("serviceConfigs").doc(configKey).set({
          workflowStatus: data.status || "running",
          workflowNote:   data.note   || "",
          updatedAt:      admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        result = { updated: true };
        break;
      }

      /* ── GENERAL — send in-app notification ──────────────────── */
      case "send_notification": {
        await createNotification(userId, {
          title:   data.title   || "Update from GTS Amplify",
          message: data.message || "",
          type:    data.type    || "info",
          link:    data.link    || "/app/portal-dashboard.html",
        });
        result = { notified: true };
        break;
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    // Update last activity timestamp
    await db.collection("serviceConfigs").doc(configKey).set({
      lastActivityAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    console.log(`[n8n-callback] ${action} completed for ${configKey}`);
    return res.status(200).json({ success: true, action, result });

  } catch (err) {
    console.error(`[n8n-callback] Error for ${configKey}:`, err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

/* ── Score a lead based on message content ───────────────────── */
function scoreLead(data) {
  const msg  = (data.message || data.notes || "").toLowerCase();
  const email= (data.email || "").toLowerCase();
  const hot  = ["demo","pricing","buy","purchase","asap","urgent","quote","contract"];
  const cold = ["student","just browsing","research","newsletter"];
  if (hot.some(s  => msg.includes(s))) return "hot";
  if (cold.some(s => msg.includes(s))) return "cold";
  if (data.company) return "hot";
  if (email.includes("gmail") || email.includes("yahoo")) return "warm";
  return "warm";
}

/* ── Create a notification for the user ──────────────────────── */
async function createNotification(userId, { title, message, type, link }) {
  return db.collection("notifications").add({
    userId, title, message, type,
    link:      link || null,
    read:      false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}
