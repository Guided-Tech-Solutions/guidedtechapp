/* ================================================================
   POST /api/services/create
   Admin only — create a new service with full schema definition
   ================================================================ */
const { db, admin } = require("../_lib/firebase");
const { requireAdmin, sendError, cors } = require("../_lib/auth");

const ALLOWED_FIELD_TYPES = [
  "text","number","email","url","password","textarea",
  "select","multi-select","checkbox","date","time","toggle","file_instruction"
];

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    await requireAdmin(req);

    const {
      name, description, category, status = "inactive",
      parametersSchema = [], credentialsSchema = [],
      n8n = {}, pricing = {}, activationRules = {},
    } = req.body;

    if (!name?.trim())        throw Object.assign(new Error("Service name is required"), { status: 400 });
    if (!n8n.webhookUrl?.trim()) throw Object.assign(new Error("n8n webhookUrl is required"), { status: 400 });

    // Validate schemas
    validateSchema(parametersSchema, "parametersSchema");
    validateSchema(credentialsSchema, "credentialsSchema");

    const now = admin.firestore.FieldValue.serverTimestamp();
    const ref = await db.collection("services").add({
      name:              name.trim(),
      description:       description?.trim() || "",
      category:          category?.trim()    || "General",
      status:            ["active","inactive"].includes(status) ? status : "inactive",
      parametersSchema:  parametersSchema,
      credentialsSchema: credentialsSchema,
      n8n: {
        workflowId:  n8n.workflowId  || "",
        // webhookUrl is stored but NEVER sent to frontend
        webhookUrl:  n8n.webhookUrl.trim(),
      },
      pricing: {
        type:     pricing.type     || "subscription",
        amount:   Number(pricing.amount)   || 0,
        currency: pricing.currency || "USD",
        interval: pricing.interval || "month",
      },
      activationRules: {
        requiresSubscription: activationRules.requiresSubscription !== false,
        maxRunsPerDay:        activationRules.maxRunsPerDay || null,
        cooldownMinutes:      activationRules.cooldownMinutes || null,
      },
      createdAt: now,
      updatedAt: now,
    });

    return res.status(201).json({ success: true, serviceId: ref.id });

  } catch (err) {
    return sendError(res, err);
  }
};

function validateSchema(schema, name) {
  if (!Array.isArray(schema)) throw Object.assign(new Error(`${name} must be an array`), { status: 400 });
  schema.forEach((f, i) => {
    if (!f.key?.trim())   throw Object.assign(new Error(`${name}[${i}]: key is required`), { status: 400 });
    if (!f.label?.trim()) throw Object.assign(new Error(`${name}[${i}]: label is required`), { status: 400 });
    if (!ALLOWED_FIELD_TYPES.includes(f.type))
      throw Object.assign(new Error(`${name}[${i}]: type "${f.type}" is not supported`), { status: 400 });
    if (/\s/.test(f.key)) throw Object.assign(new Error(`${name}[${i}]: key must have no spaces`), { status: 400 });
  });
}
