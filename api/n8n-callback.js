/* ================================================================
   FILE: api/n8n-callback.js
   GTS Amplify — n8n Results Receiver

   n8n calls this endpoint to write results back to Firestore.
   Every workflow type sends data in a standard envelope:

   {
     secret:       "your-internal-secret",
     userId:       "firebase-uid",
     serviceId:    "firestore-service-doc-id",
     workflowType: "lead_generation" | "seo" | "automation" | ...,
     action:       "add_lead" | "update_seo" | "log_run" | "update_migration" | "log_event",
     data:         { ...the actual payload }
   }

   Supported actions per workflow type:
   ─────────────────────────────────────────────────────────────────
   LEAD GENERATION
     action: "add_lead"         → adds a lead to serviceData/.../leads
     action: "update_stats"     → updates aggregate lead stats

   SEO
     action: "update_metrics"   → updates seoMetrics (DA, traffic, etc.)
     action: "update_keywords"  → upserts keyword rankings

   AUTOMATION
     action: "log_run"          → records an automation run result

   CLOUD MIGRATION
     action: "update_migration" → updates phase statuses + progress
     action: "log_event"        → appends an event to the migration log

   GENERAL
     action: "set_status"       → updates workflowStatus on the config
     action: "send_notification"→ creates a notification for the user
   ================================================================ */

const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}
const db = admin.firestore();
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || "change-me-in-env";

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-gts-secret");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")    return res.status(405).json({ error: "Method not allowed" });

  // Verify secret (from header OR body — n8n supports both)
  const headerSecret = req.headers["x-gts-secret"];
  const bodySecret   = req.body?.secret;
  if (headerSecret !== INTERNAL_SECRET && bodySecret !== INTERNAL_SECRET) {
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

      /* ════════════════════════════════════════════════════════
         LEAD GENERATION
         n8n sends one lead at a time whenever it captures one
         ════════════════════════════════════════════════════════ */
      case "add_lead": {
        const leadRef = db.collection("serviceData").doc(configKey)
                          .collection("leads").doc();
        await leadRef.set({
          name:      data.name      || "Unknown",
          email:     data.email     || "",
          phone:     data.phone     || "",
          company:   data.company   || "",
          source:    data.source    || "website",
          score:     data.score     || scoreLead(data),
          status:    data.status    || "new",
          message:   data.message   || "",
          pageUrl:   data.pageUrl   || "",
          utm:       data.utm       || {},
          rawData:   data.rawData   || {},
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        // Also notify the user
        await createNotification(userId, {
          title:   "New lead captured! 🎯",
          message: `${data.name || "Someone"} just submitted a form on ${data.source || "your website"}`,
          type:    "lead",
          link:    "/app/portal-dashboard.html",
        });
        result = { leadId: leadRef.id };
        break;
      }

      /* ════════════════════════════════════════════════════════
         SEO — full metrics snapshot
         n8n sends this after running an Ahrefs / SEMrush / GSC pull
         ════════════════════════════════════════════════════════ */
      case "update_metrics": {
        const metricRef = db.collection("serviceData").doc(configKey)
                            .collection("seoMetrics").doc();
        await metricRef.set({
          domainAuthority:  Number(data.domainAuthority)  || 0,
          organicVisitors:  Number(data.organicVisitors)  || 0,
          keywordsRanked:   Number(data.keywordsRanked)   || 0,
          backlinks:        Number(data.backlinks)         || 0,
          pageSpeed:        Number(data.pageSpeed)         || 0,
          coreWebVitals:    data.coreWebVitals             || "Pass",
          source:           data.source                   || "manual",
          createdAt:        admin.firestore.FieldValue.serverTimestamp(),
        });
        result = { metricId: metricRef.id };
        break;
      }

      /* ════════════════════════════════════════════════════════
         SEO — keyword ranking updates
         n8n sends an array of keyword objects
         ════════════════════════════════════════════════════════ */
      case "update_keywords": {
        const keywords = Array.isArray(data.keywords) ? data.keywords : [data];
        const batch    = db.batch();
        keywords.forEach(kw => {
          // Use keyword text as doc ID so it upserts (no duplicates)
          const kwId  = (kw.keyword || "").toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
          const kwRef = db.collection("serviceData").doc(configKey)
                          .collection("keywords").doc(kwId || db.collection("_").doc().id);
          batch.set(kwRef, {
            keyword:   kw.keyword  || "",
            position:  Number(kw.position)  || 0,
            prevPos:   Number(kw.prevPos)   || 0,
            change:    Number(kw.change)    || (kw.prevPos ? kw.prevPos - kw.position : 0),
            volume:    Number(kw.volume)    || 0,
            url:       kw.url              || "",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
        });
        await batch.commit();
        result = { updated: keywords.length };
        break;
      }

      /* ════════════════════════════════════════════════════════
         AUTOMATION — log a workflow run result
         n8n sends this after every automation execution
         ════════════════════════════════════════════════════════ */
      case "log_run": {
        const runRef = db.collection("serviceData").doc(configKey)
                         .collection("automationRuns").doc();
        await runRef.set({
          name:         data.name         || data.workflowName || "Automation Run",
          workflowName: data.workflowName || "",
          workflowId:   data.workflowId   || "",
          trigger:      data.trigger      || "",
          status:       data.status       || "success",   // "success" | "failed" | "skipped"
          duration:     data.duration     || "",
          error:        data.error        || null,
          itemsProcessed: Number(data.itemsProcessed) || 0,
          detail:       data.detail       || "",
          createdAt:    admin.firestore.FieldValue.serverTimestamp(),
        });
        // Alert on failure
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

      /* ════════════════════════════════════════════════════════
         CLOUD MIGRATION — update phase statuses
         n8n sends this when a migration phase completes
         ════════════════════════════════════════════════════════ */
      case "update_migration": {
        const updates = {
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (Array.isArray(data.phases)) {
          updates.phases = data.phases;
        }
        if (data.phaseName) {
          // Update a single phase by name
          const configDoc = await db.collection("serviceConfigs").doc(configKey).get();
          const existing  = configDoc.exists() ? configDoc.data() : {};
          const phases    = existing.phases || [];
          const idx       = phases.findIndex(p => p.name === data.phaseName);
          if (idx >= 0) {
            phases[idx].status = data.phaseStatus || "done";
            phases[idx].detail = data.detail || phases[idx].detail;
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
          message: data.detail || `Phase "${data.phaseName}" status: ${data.phaseStatus}`,
          type:    "migration",
          link:    "/app/portal-dashboard.html",
        });
        result = { updated: true };
        break;
      }

      /* ════════════════════════════════════════════════════════
         CLOUD MIGRATION — append an event log entry
         ════════════════════════════════════════════════════════ */
      case "log_event": {
        const eventRef = db.collection("serviceData").doc(configKey)
                           .collection("migrationEvents").doc();
        await eventRef.set({
          message:    data.message    || data.event || "",
          type:       data.type       || "info",   // "info" | "success" | "warning" | "error"
          event:      data.event      || "",
          dataMoved:  data.dataMoved  || "",
          filesMoved: data.filesMoved || "",
          eta:        data.eta        || "",
          createdAt:  admin.firestore.FieldValue.serverTimestamp(),
        });
        result = { eventId: eventRef.id };
        break;
      }

      /* ════════════════════════════════════════════════════════
         GENERAL — update workflow status
         n8n sends this to update the running status shown in admin
         ════════════════════════════════════════════════════════ */
      case "set_status": {
        await db.collection("serviceConfigs").doc(configKey).set({
          workflowStatus: data.status || "running",
          workflowNote:   data.note   || "",
          updatedAt:      admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        result = { updated: true };
        break;
      }

      /* ════════════════════════════════════════════════════════
         GENERAL — send a notification to the user
         ════════════════════════════════════════════════════════ */
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

    // Always update the "last seen" timestamp on the config
    await db.collection("serviceConfigs").doc(configKey).set({
      lastActivityAt: admin.firestore.FieldValue.serverTimestamp(),
      workflowStatus: "running",
    }, { merge: true });

    console.log(`[n8n-callback] ${action} completed for ${configKey}`, result);
    return res.status(200).json({ success: true, action, result });

  } catch (err) {
    console.error(`[n8n-callback] Error for ${configKey}:`, err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

/* ── Auto-score a lead based on available data ───────────────── */
function scoreLead(data) {
  const email = (data.email || "").toLowerCase();
  const msg   = (data.message || data.notes || "").toLowerCase();

  const hotSignals  = ["demo", "pricing", "buy", "purchase", "asap", "urgent", "quote", "contract"];
  const coldSignals = ["student", "just browsing", "research", "newsletter"];

  if (hotSignals.some(s  => msg.includes(s))) return "hot";
  if (coldSignals.some(s => msg.includes(s))) return "cold";
  if (email.includes("gmail") || email.includes("yahoo")) return "warm";
  if (data.company) return "hot";    // Has a company = likely real prospect
  return "warm";
}

/* ── Create a notification doc for the user ──────────────────── */
async function createNotification(userId, { title, message, type, link }) {
  return db.collection("notifications").add({
    userId,
    title,
    message,
    type,
    link:      link || null,
    read:      false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}
