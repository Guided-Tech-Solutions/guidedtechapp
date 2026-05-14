/* ================================================================
   POST /api/user-services/activate
   Authenticated user — full activation flow.

   This is the most important endpoint. It:
   1.  Verifies user owns the userService
   2.  Loads and checks the service (must be admin-active)
   3.  Checks subscriptionStatus is active/trialing
   4.  Checks subscription has not expired
   5.  Validates ALL required parameters against schema
   6.  Validates ALL required credentials against schema
   7.  Decrypts credentials (ONLY here — never elsewhere)
   8.  Creates a workflowRun record with status "queued"
   9.  Calls n8n webhook (backend-to-backend, URL hidden from browser)
   10. Updates userService status to "running"
   11. Returns runId to frontend (for polling)

   n8n webhook URL is read from Firestore services doc — the
   frontend NEVER has access to it.
   ================================================================ */
const { db, admin } = require("../_lib/firebase");
const { verifyToken, sendError, cors } = require("../_lib/auth");
const { decryptCredentials } = require("../_lib/crypto");
const { validateSchema } = require("../_lib/schema-validator");
const fetch = (...a) => import("node-fetch").then(({ default: f }) => f(...a));
const crypto = require("crypto");

const APP_URL         = process.env.APP_URL          || "https://www.gtsamplify.com";
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || "";
const N8N_TIMEOUT_MS  = 25000;

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const decoded = await verifyToken(req);
    const userId  = decoded.uid;

    const { userServiceId } = req.body;
    if (!userServiceId) throw Object.assign(new Error("userServiceId is required"), { status: 400 });

    /* ── 1-2. Load userService (ownership check built in) ────────── */
    const usRef  = db.collection("users").doc(userId).collection("services").doc(userServiceId);
    const usSnap = await usRef.get();
    if (!usSnap.exists()) throw Object.assign(new Error("User service not found"), { status: 404 });
    const us = usSnap.data();

    /* ── 2. Load admin service config ────────────────────────────── */
    const svcSnap = await db.collection("services").doc(us.serviceId).get();
    if (!svcSnap.exists()) throw Object.assign(new Error("Service configuration not found"), { status: 404 });
    const svc = svcSnap.data();

    // Admin service must be active
    if (svc.status !== "active")
      throw Object.assign(new Error("This service is currently unavailable"), { status: 400 });

    /* ── 3. Check subscription status ────────────────────────────── */
    if (!["active","trialing"].includes(us.subscriptionStatus))
      throw Object.assign(new Error(`Cannot activate — subscription is ${us.subscriptionStatus}`), { status: 403 });

    /* ── 4. Check expiry ──────────────────────────────────────────── */
    if (us.subscriptionExpiresAt) {
      const expiresAt = us.subscriptionExpiresAt.toDate?.() || new Date(us.subscriptionExpiresAt);
      if (new Date() > expiresAt)
        throw Object.assign(new Error("Subscription has expired. Please renew to continue."), { status: 403 });
    }

    /* ── 5. Validate parameters ──────────────────────────────────── */
    const paramSchema = svc.parametersSchema || [];
    const paramResult = validateSchema(paramSchema, us.parameters || {});
    if (!paramResult.valid)
      throw Object.assign(
        new Error(`Missing required parameters: ${paramResult.errors.join("; ")}`),
        { status: 400 }
      );

    /* ── 6. Load and validate credentials ────────────────────────── */
    const credSchema = svc.credentialsSchema || [];
    let decryptedCreds = {};

    if (credSchema.length > 0) {
      if (!us.credentialsRef)
        throw Object.assign(new Error("Credentials not saved. Please save your credentials first."), { status: 400 });

      const credSnap = await db.doc(us.credentialsRef).get();
      if (!credSnap.exists())
        throw Object.assign(new Error("Credential record not found. Please re-enter your credentials."), { status: 400 });

      const credData    = credSnap.data();
      decryptedCreds    = decryptCredentials(credData.credentials || {});

      const credResult  = validateSchema(credSchema, decryptedCreds);
      if (!credResult.valid)
        throw Object.assign(
          new Error(`Missing required credentials: ${credResult.errors.join("; ")}`),
          { status: 400 }
        );
    }

    /* ── 7. Check activation rules ───────────────────────────────── */
    const rules = svc.activationRules || {};
    if (rules.cooldownMinutes && us.lastRunAt) {
      const lastRun = us.lastRunAt.toDate?.() || new Date(us.lastRunAt);
      const diffMin = (Date.now() - lastRun.getTime()) / 60000;
      if (diffMin < rules.cooldownMinutes)
        throw Object.assign(
          new Error(`Please wait ${Math.ceil(rules.cooldownMinutes - diffMin)} minutes before running again.`),
          { status: 429 }
        );
    }

    /* ── 8. Create workflow run record ──────────────────────────────
       Input stored in run — credentials are NEVER stored here
    ─────────────────────────────────────────────────────────────── */
    const runId  = "run_" + crypto.randomBytes(10).toString("hex");
    const runRef = db.collection("workflowRuns").doc(runId);
    const nowTs  = admin.firestore.FieldValue.serverTimestamp();

    await runRef.set({
      runId,
      userId,
      serviceId:    us.serviceId,
      userServiceId,
      serviceName:  svc.name || "",
      status:       "queued",
      input:        us.parameters || {},   // parameters only — no credentials
      output:       null,
      error:        null,
      startedAt:    null,
      completedAt:  null,
      createdAt:    nowTs,
      updatedAt:    nowTs,
    });

    /* ── 9. Update userService to "running" before firing n8n ────── */
    await usRef.update({
      serviceStatus: "running",
      lastRunId:     runId,
      lastRunAt:     nowTs,
      updatedAt:     nowTs,
    });

    /* ── 10. Fire n8n webhook — backend to backend only ──────────── */
    // webhookUrl is read from Firestore svc doc — NEVER from the request body
    const webhookUrl = svc.n8n?.webhookUrl;
    if (!webhookUrl)
      throw Object.assign(new Error("Service automation not configured yet. Contact support."), { status: 503 });

    const n8nPayload = {
      runId,
      userId,
      serviceId:    us.serviceId,
      userServiceId,
      serviceName:  svc.name,
      parameters:   us.parameters || {},
      credentials:  decryptedCreds,      // decrypted — sent to n8n only, never stored
      callbackUrl:  `${APP_URL}/api/n8n-callback`,
      callbackSecret: INTERNAL_SECRET,
    };

    // Fire n8n — don't await (let n8n run async)
    // If n8n call itself fails, we still return success to user
    // because the run record already exists and n8n can retry via callback
    fireN8n(webhookUrl, n8nPayload, runId).catch(async (err) => {
      console.error(`[activate] n8n call failed for run ${runId}:`, err.message);
      await runRef.update({
        status:    "failed",
        error:     { message: "Failed to reach automation service: " + err.message },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      await usRef.update({
        serviceStatus: "failed",
        updatedAt:     admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    return res.status(200).json({ success: true, runId });

  } catch (err) {
    return sendError(res, err);
  }
};

async function fireN8n(webhookUrl, payload, runId) {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), N8N_TIMEOUT_MS);
  try {
    const r = await fetch(webhookUrl, {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        "x-gts-secret": process.env.INTERNAL_API_SECRET || "",
      },
      body:   JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!r.ok) throw new Error(`n8n returned HTTP ${r.status}`);
    // Mark run as "running" now that n8n acknowledged
    await require("../_lib/firebase").db.collection("workflowRuns").doc(runId).update({
      status:    "running",
      startedAt: require("../_lib/firebase").admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: require("../_lib/firebase").admin.firestore.FieldValue.serverTimestamp(),
    });
  } finally {
    clearTimeout(timeout);
  }
}
