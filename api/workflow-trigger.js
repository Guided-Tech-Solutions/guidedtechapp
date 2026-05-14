/* ================================================================
   FILE: api/workflow-trigger.js
   GTS Amplify — Workflow Orchestrator
   
   Called in two ways:
   1. From payment webhooks (Paystack/Stripe/PayPal) after a
      subscription is activated — triggers the n8n workflow
      for that service automatically.
   2. From the admin panel "Re-trigger" button if something
      went wrong and needs a re-run.

   Flow:
     Service activated in Firestore
       → This endpoint is called with { userId, serviceId }
       → Loads serviceConfig for that user+service
       → Determines which n8n workflow to call
       → Sends all client credentials + config to n8n webhook
       → n8n takes over and runs the workflow automatically
       → n8n writes results back via /api/n8n-callback
   ================================================================ */

const admin  = require("firebase-admin");
const fetch  = (...a) => import("node-fetch").then(({ default: f }) => f(...a));

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

/* ── N8N workflow webhook URLs — set these in your .env ──────── */
const N8N_WORKFLOWS = {
  lead_generation:  process.env.N8N_WEBHOOK_LEAD_GEN,
  cloud_migration:  process.env.N8N_WEBHOOK_CLOUD_MIGRATION,
  automation:       process.env.N8N_WEBHOOK_AUTOMATION,
  seo:              process.env.N8N_WEBHOOK_SEO,
  consultation:     process.env.N8N_WEBHOOK_CONSULTATION,
  generic:          process.env.N8N_WEBHOOK_GENERIC,
};

/* ── Internal secret — n8n must send this header to prove
      the call is from your n8n instance, not a random person ── */
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || "change-me-in-env";

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-internal-secret");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")    return res.status(405).json({ error: "Method not allowed" });

  // Verify internal secret (admin panel or payment webhook calling us)
  const secret = req.headers["x-internal-secret"];
  if (secret !== INTERNAL_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { userId, serviceId, activationId, dashboardType, retrigger = false } = req.body;

  if (!userId || !serviceId) {
    return res.status(400).json({ error: "userId and serviceId are required" });
  }

  const configKey = `${userId}_${serviceId}`;
  console.log(`[workflow-trigger] Triggering for ${configKey}, type: ${dashboardType}`);

  try {
    /* ── 1. Load everything we need from Firestore ─────────────── */
    const [configSnap, userSnap, activationSnap] = await Promise.all([
      db.collection("serviceConfigs").doc(configKey).get(),
      db.collection("users").doc(userId).get(),
      activationId
        ? db.collection("serviceActivations").doc(activationId).get()
        : Promise.resolve(null),
    ]);

    const config     = configSnap.exists()     ? configSnap.data()     : {};
    const user       = userSnap.exists()        ? userSnap.data()       : {};
    const activation = activationSnap?.exists() ? activationSnap.data() : {};

    /* ── 2. Determine which n8n workflow to call ────────────────── */
    const workflowType = dashboardType || config.dashboardType || inferType(config);
    const webhookUrl   = N8N_WORKFLOWS[workflowType];

    if (!webhookUrl) {
      console.warn(`[workflow-trigger] No n8n webhook URL configured for type: ${workflowType}`);
      // Still mark as triggered so we don't loop
      await updateWorkflowStatus(configKey, activationId, "no_webhook_configured", workflowType);
      return res.status(200).json({
        success: false,
        message: `No n8n webhook URL set for workflow type: ${workflowType}. Set N8N_WEBHOOK_${workflowType.toUpperCase()} in your .env`,
      });
    }

    /* ── 3. Build the payload — everything n8n needs to run ─────── */
    const payload = buildPayload({
      userId, serviceId, configKey, activationId,
      workflowType, config, user, activation,
      callbackUrl: `${process.env.APP_URL}/api/n8n-callback`,
      retrigger,
    });

    /* ── 4. Mark as "triggering" in Firestore ───────────────────── */
    await updateWorkflowStatus(configKey, activationId, "triggering", workflowType);

    /* ── 5. Fire the n8n webhook ────────────────────────────────── */
    const n8nRes = await fetch(webhookUrl, {
      method:  "POST",
      headers: {
        "Content-Type":     "application/json",
        "X-GTS-Secret":     INTERNAL_SECRET,   // n8n verifies this
        "X-Workflow-Type":  workflowType,
        "X-User-Id":        userId,
        "X-Service-Id":     serviceId,
      },
      body: JSON.stringify(payload),
    });

    if (!n8nRes.ok) {
      const err = await n8nRes.text();
      throw new Error(`n8n responded ${n8nRes.status}: ${err}`);
    }

    const n8nData = await n8nRes.json().catch(() => ({}));

    /* ── 6. Mark as "triggered" ─────────────────────────────────── */
    await updateWorkflowStatus(configKey, activationId, "triggered", workflowType, {
      n8nResponse:   n8nData,
      triggeredAt:   admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`[workflow-trigger] Successfully triggered ${workflowType} for ${configKey}`);
    return res.status(200).json({
      success: true,
      workflowType,
      configKey,
      message: `${workflowType} workflow triggered successfully`,
    });

  } catch (err) {
    console.error(`[workflow-trigger] Error for ${configKey}:`, err);
    await updateWorkflowStatus(configKey, activationId, "trigger_failed", dashboardType, {
      error:     err.message,
      failedAt:  admin.firestore.FieldValue.serverTimestamp(),
    });
    return res.status(500).json({ success: false, error: err.message });
  }
};

/* ── Build the full payload for n8n ──────────────────────────── */
function buildPayload({ userId, serviceId, configKey, activationId, workflowType, config, user, activation, callbackUrl, retrigger }) {
  // Base fields every workflow gets
  const base = {
    // Identity
    userId,
    serviceId,
    configKey,
    activationId:    activationId || null,
    workflowType,
    retrigger,

    // Callback — n8n uses this to send results back
    callbackUrl,
    callbackSecret:  process.env.INTERNAL_API_SECRET,

    // Client contact info
    client: {
      name:    user.displayName || user.firstName + " " + user.lastName || "",
      email:   user.email || "",
      phone:   user.phone || "",
      company: user.company || "",
      website: user.website || "",
    },

    // Full config from the wizard
    config,
  };

  // Add workflow-specific fields extracted cleanly from config
  switch (workflowType) {
    case "lead_generation":
      return {
        ...base,
        targetUrl:     config.targetUrl     || "",
        targetPages:   config.targetPages   || "",
        industry:      config.industry      || "",
        targetRegion:  config.targetRegion  || "",
        captureMethod: config.captureMethod || "Contact Form",
        crmEmail:      config.crmEmail      || user.email,
        webhookUrl:    config.webhookUrl    || "",
        hotCriteria:   config.hotCriteria   || "",
        warmCriteria:  config.warmCriteria  || "",
        monthlyTarget: config.monthlyTarget || 50,
        notifyEmail:   config.crmEmail      || user.email,
      };

    case "cloud_migration":
      return {
        ...base,
        currentProvider: config.currentProvider || "",
        dataVolume:      config.dataVolume       || "",
        numServers:      config.numServers        || 1,
        targetCloud:     config.targetCloud       || "",
        timeline:        config.timeline          || "",
        downtime:        config.downtime          || "",
        appList:         config.appList           || "",
        criticalApps:    config.criticalApps      || "",
        compliance:      config.compliance        || "None",
        techContact:     config.techContact       || user.email,
        notifyEmail:     user.email,
      };

    case "automation":
      return {
        ...base,
        useCase:       config.useCase       || "",
        useCaseDesc:   config.useCaseDesc   || "",
        currentTools:  config.currentTools  || "",
        triggerEvent:  config.triggerEvent  || "",
        runFrequency:  config.runFrequency  || "Real-time",
        notifyEmail:   config.notifyEmail   || user.email,
        failureAlert:  config.failureAlert  || "Yes – email immediately",
      };

    case "seo":
      return {
        ...base,
        siteUrl:      config.siteUrl      || user.website || "",
        sitePlatform: config.sitePlatform || "",
        siteAccess:   config.siteAccess   || "",
        seedKeywords: config.seedKeywords || "",
        competitors:  config.competitors  || "",
        targetLoc:    config.targetLoc    || "",
        seoGoal:      config.seoGoal      || "Increase organic traffic",
        notifyEmail:  user.email,
      };

    case "consultation":
      return {
        ...base,
        sessionType:   config.sessionType   || "free",
        preferredDate: config.preferredDate || "",
        notes:         config.notes         || "",
        notifyEmail:   user.email,
      };

    default:
      return base;
  }
}

/* ── Update workflow status in Firestore ─────────────────────── */
async function updateWorkflowStatus(configKey, activationId, status, workflowType, extra = {}) {
  const batch = db.batch();

  // Update the service config doc
  batch.set(
    db.collection("serviceConfigs").doc(configKey),
    {
      workflowStatus: status,
      workflowType:   workflowType || null,
      updatedAt:      admin.firestore.FieldValue.serverTimestamp(),
      ...extra,
    },
    { merge: true }
  );

  // Update the activation doc if we have it
  if (activationId) {
    batch.update(
      db.collection("serviceActivations").doc(activationId),
      {
        workflowStatus: status,
        updatedAt:      admin.firestore.FieldValue.serverTimestamp(),
      }
    );
  }

  await batch.commit();
}

/* ── Infer workflow type from config keys ────────────────────── */
function inferType(config) {
  if (config.targetUrl || config.captureMethod)  return "lead_generation";
  if (config.targetCloud || config.currentProvider) return "cloud_migration";
  if (config.useCase || config.triggerEvent)     return "automation";
  if (config.siteUrl || config.seedKeywords)     return "seo";
  return "generic";
}
