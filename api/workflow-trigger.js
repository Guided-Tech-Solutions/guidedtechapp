/* FILE: api/workflow-trigger.js */
/* ================================================================
   GTS Amplify — Universal Workflow Orchestrator

   ONE webhook URL handles every service type.
   Called by payment webhooks after subscription activates,
   and by the onboarding wizard when setup is complete.

   Flow:
     Client pays + completes setup wizard
       → This endpoint is called with { userId, serviceId }
       → Loads user profile + service config from Firestore
       → Builds payload with ALL client data and credentials
       → POSTs to N8N_WEBHOOK_UNIVERSAL (one URL for everything)
       → n8n reads workflowType and routes to correct logic
       → n8n writes results back via /api/n8n-callback
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
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_UNIVERSAL || "";
const APP_URL         = process.env.APP_URL || "https://www.gtsamplify.com";

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-internal-secret");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")    return res.status(405).json({ error: "Method not allowed" });

  // Verify the call is from our own system
  if (req.headers["x-internal-secret"] !== INTERNAL_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { userId, serviceId, activationId, dashboardType, retrigger = false } = req.body;
  if (!userId || !serviceId) {
    return res.status(400).json({ error: "userId and serviceId are required" });
  }

  if (!N8N_WEBHOOK_URL) {
    return res.status(200).json({
      success: false,
      message: "N8N_WEBHOOK_UNIVERSAL is not set in your environment variables.",
    });
  }

  const configKey = `${userId}_${serviceId}`;
  console.log(`[workflow-trigger] Firing for ${configKey}`);

  try {
    /* ── Load all data from Firestore ────────────────────────── */
    const [configSnap, userSnap, serviceSnap] = await Promise.all([
      db.collection("serviceConfigs").doc(configKey).get(),
      db.collection("users").doc(userId).get(),
      db.collection("services").doc(serviceId).get(),
    ]);

    const config  = configSnap.exists  ? configSnap.data()  : {};
    const user    = userSnap.exists    ? userSnap.data()    : {};
    const service = serviceSnap.exists ? serviceSnap.data() : {};

    /* ── Determine workflow type ──────────────────────────────── */
    const workflowType =
      dashboardType         ||
      service.dashboardType ||
      config.dashboardType  ||
      inferType(config)     ||
      "generic";

    /* ── Build payload — everything n8n needs ────────────────── */
    const payload = {
      // Routing — n8n uses this to switch between service types
      workflowType,
      serviceName: service.name || "",
      serviceIcon: service.icon || "",

      // Identity
      userId,
      serviceId,
      configKey,
      activationId: activationId || null,
      retrigger,

      // Callbacks — n8n uses these to send results back
      callbackUrl:    `${APP_URL}/api/n8n-callback`,
      callbackSecret: INTERNAL_SECRET,

      // Client info
      client: {
        name:    user.displayName || "",
        email:   user.email       || "",
        phone:   user.phone       || "",
        company: user.company     || "",
        website: user.website     || "",
      },

      // Service metadata
      service: {
        name:          service.name          || "",
        dashboardType: workflowType,
        price:         service.pricing?.amount || 0,
        features:      service.features       || [],
      },

      // Full wizard config — all fields the client filled in
      config: sanitizeConfig(config),

      // Convenience top-level fields (most common ones)
      targetUrl:       config.targetUrl       || user.website || "",
      notifyEmail:     config.notifyEmail     || config.crmEmail || user.email || "",
      siteUrl:         config.siteUrl         || user.website || "",
      seedKeywords:    config.seedKeywords    || "",
      useCase:         config.useCase         || "",
      triggerEvent:    config.triggerEvent    || "",
      currentTools:    config.currentTools    || "",
      targetCloud:     config.targetCloud     || "",
      currentProvider: config.currentProvider || "",
    };

    /* ── Mark as triggering ──────────────────────────────────── */
    await db.collection("serviceConfigs").doc(configKey).set({
      workflowStatus: "triggering",
      workflowType,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    /* ── Fire the single universal n8n webhook ───────────────── */
    const n8nRes = await fetch(N8N_WEBHOOK_URL, {
      method:  "POST",
      headers: {
        "Content-Type":    "application/json",
        "x-gts-secret":    INTERNAL_SECRET,
        "x-workflow-type": workflowType,
        "x-user-id":       userId,
        "x-service-id":    serviceId,
      },
      body: JSON.stringify(payload),
    });

    if (!n8nRes.ok) {
      const errText = await n8nRes.text();
      throw new Error(`n8n returned ${n8nRes.status}: ${errText}`);
    }

    /* ── Mark as triggered ───────────────────────────────────── */
    await db.collection("serviceConfigs").doc(configKey).set({
      workflowStatus: "triggered",
      triggeredAt:    admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    console.log(`[workflow-trigger] ✓ ${workflowType} triggered for ${configKey}`);
    return res.status(200).json({
      success: true,
      workflowType,
      configKey,
      message: `Workflow triggered for: ${workflowType}`,
    });

  } catch (err) {
    console.error(`[workflow-trigger] Error for ${configKey}:`, err.message);
    await db.collection("serviceConfigs").doc(configKey).set({
      workflowStatus: "trigger_failed",
      triggerError:   err.message,
      updatedAt:      admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true }).catch(() => {});
    return res.status(500).json({ success: false, error: err.message });
  }
};

/* ── Strip internal Firestore fields before sending to n8n ──── */
function sanitizeConfig(config) {
  const skip = new Set([
    "userId","configured","configuredAt","updatedAt","workflowStatus",
    "workflowType","workflowNote","lastActivityAt","triggeredAt","triggerError",
  ]);
  const clean = {};
  for (const [k, v] of Object.entries(config)) {
    if (!skip.has(k)) clean[k] = v;
  }
  return clean;
}

/* ── Infer workflow type from config keys if not set ─────────── */
function inferType(config) {
  if (config.targetUrl    || config.captureMethod)   return "lead_generation";
  if (config.targetCloud  || config.currentProvider) return "cloud_migration";
  if (config.useCase      || config.triggerEvent)    return "automation";
  if (config.siteUrl      || config.seedKeywords)    return "seo";
  return "generic";
}
