/* FILE: api/get-payment-config.js */
function cors(res) { res.setHeader("Access-Control-Allow-Origin","*"); res.setHeader("Access-Control-Allow-Headers","Content-Type"); }

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  return res.status(200).json({
    stripe:   { publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || "" },
    paystack: { publicKey:      process.env.PAYSTACK_PUBLIC_KEY    || "" },
    paypal:   { clientId:       process.env.PAYPAL_CLIENT_ID       || "", mode: process.env.PAYPAL_MODE || "sandbox" },
  });
};
