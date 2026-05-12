/* ================================================================
   FILE: api/get-payment-config.js
   GTS Amplify — Returns public payment config to frontend
   ================================================================ */
module.exports = function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "GET") return res.status(405).json({ error:"Method not allowed" });

  const config = {
    paystack: {
      publicKey: process.env.PAYSTACK_PUBLIC_KEY || null,
      currency:  "NGN",
      available: !!process.env.PAYSTACK_PUBLIC_KEY,
    },
    stripe: {
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
      currency:       "USD",
      available:      !!process.env.STRIPE_PUBLISHABLE_KEY,
    },
    paypal: {
      clientId:  process.env.PAYPAL_CLIENT_ID || null,
      mode:      process.env.PAYPAL_MODE || "sandbox",
      currency:  "USD",
      available: !!process.env.PAYPAL_CLIENT_ID,
    },
  };

  return res.status(200).json({ success: true, providers: config });
};
