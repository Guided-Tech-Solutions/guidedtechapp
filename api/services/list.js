/* ================================================================
   GET /api/services/list
   Public (unauthenticated) — returns active services for the catalog.
   Admin (authenticated admin) — returns all services including drafts.
   webhookUrl and n8n credentials are NEVER sent to any client.
   ================================================================ */
const { db } = require("../_lib/firebase");
const { verifyToken, isAdmin, cors } = require("../_lib/auth");

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    // Check if admin — admins see all; public only sees active
    let adminMode = false;
    try {
      const decoded = await verifyToken(req);
      adminMode     = await isAdmin(decoded.uid);
    } catch { /* not logged in or not admin — fine for public catalog */ }

    let query = db.collection("services").where("deleted", "!=", true);
    if (!adminMode) query = query.where("status", "==", "active");

    const snap = await query.orderBy("deleted").orderBy("createdAt", "desc").get();

    const services = [];
    snap.forEach(d => {
      const data = d.data();
      services.push(sanitize(d.id, data, adminMode));
    });

    return res.status(200).json({ success: true, services });

  } catch (err) {
    console.error("[services/list]", err);
    return res.status(500).json({ success: false, error: "Failed to fetch services" });
  }
};

/**
 * Strip sensitive fields before sending to client.
 * webhookUrl is ONLY available to the backend, never to any browser.
 */
function sanitize(id, data, includeAdminFields = false) {
  const out = {
    id,
    name:             data.name,
    description:      data.description,
    category:         data.category,
    status:           data.status,
    parametersSchema: data.parametersSchema  || [],
    credentialsSchema:data.credentialsSchema || [],
    pricing:          data.pricing           || {},
    // Show the workflowId (not secret) but NEVER webhookUrl
    n8n: { workflowId: data.n8n?.workflowId || "" },
    createdAt:        data.createdAt,
    updatedAt:        data.updatedAt,
  };
  if (includeAdminFields) {
    // Admin gets to see/edit the webhookUrl in the admin panel
    out.n8n.webhookUrl = data.n8n?.webhookUrl || "";
    out.activationRules = data.activationRules || {};
    out.deleted  = data.deleted  || false;
    out.deletedAt= data.deletedAt|| null;
  }
  return out;
}
