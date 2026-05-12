/* ================================================================
   FILE: api/verify-paystack.js
   GTS Amplify — Verify a Paystack transaction reference
   ================================================================ */
const fetch = (...a) => import("node-fetch").then(({ default: f }) => f(...a));

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "GET") return res.status(405).json({ error:"Method not allowed" });

  const { reference } = req.query;
  if (!reference) return res.status(400).json({ error:"Missing reference" });

  try {
    const psRes  = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
    });
    const psData = await psRes.json();
    if (!psData.status) return res.status(400).json({ success:false, error: psData.message });

    const tx = psData.data;
    return res.status(200).json({
      success:   true,
      status:    tx.status,
      amount:    tx.amount / 100,
      email:     tx.customer?.email,
      reference: tx.reference,
      itemName:  tx.metadata?.itemName || "Subscription",
      provider:  "paystack",
    });
  } catch(err) {
    return res.status(500).json({ success:false, error: err.message });
  }
};
