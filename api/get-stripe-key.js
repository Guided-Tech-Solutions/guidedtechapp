/* ============================================================
   FILE: api/get-stripe-key.js
   Vercel Serverless Function - Returns Stripe publishable key
   ============================================================ */

export default function handler(req, res) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Return the publishable key from environment variables
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;

  if (!publishableKey) {
    return res.status(500).json({ error: 'Stripe key not configured' });
  }

  res.status(200).json({ 
    publishableKey: publishableKey 
  });
}
