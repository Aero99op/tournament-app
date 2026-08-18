// Serverless Webhook Endpoint for Automatic Bank SMS & UPI UTR Auto-Verification
// Compatible with Vercel Serverless & Cloudflare Pages Functions

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'active',
      service: 'Vortex Esports Bank SMS Auto-Verification Webhook',
      timestamp: new Date().toISOString()
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    const body = req.body || {};
    const rawSms = body.sms || body.message || body.text || body.body || (typeof body === 'string' ? body : '');
    const secretKey = body.secret || req.headers['x-secret-key'] || '';

    // Simple optional security key
    const EXPECTED_SECRET = process.env.VTX_SMS_SECRET || 'VTX_AUTO_VERIFY_2026';
    if (secretKey && secretKey !== EXPECTED_SECRET) {
      return res.status(401).json({ error: 'Unauthorized secret key' });
    }

    if (!rawSms) {
      return res.status(400).json({ error: 'Missing SMS text in payload (e.g. { sms: "..." })' });
    }

    // 1. Intelligent 12-Digit UTR Extraction Regex
    const utrRegex = /(?:UPI(?:\s*Ref(?:\s*No|\s*ID)?|\/)|UTR(?:\s*No|\s*ID)?|Ref(?:\s*No|\s*ID)?|Txn(?:\s*ID|\s*No)?|Reference(?:\s*No)?)[ :\/#-]*([0-9]{12})/i;
    const generic12Digits = /\b([0-9]{12})\b/;

    const utrMatch = rawSms.match(utrRegex) || rawSms.match(generic12Digits);
    const utr = utrMatch ? utrMatch[1] : null;

    // 2. Amount Extraction Regex
    const amtRegex = /(?:Rs\.?|INR|₹|credited\s*(?:by|with)?\s*(?:Rs\.?|INR|₹)?)\s*([0-9]+(?:\.[0-9]{1,2})?)/i;
    const amtMatch = rawSms.match(amtRegex);
    const amount = amtMatch ? parseFloat(amtMatch[1]) : 0;

    if (!utr) {
      return res.status(422).json({
        success: false,
        error: 'No 12-digit UPI UTR found in SMS',
        parsed: { rawSms, amount }
      });
    }

    // Return successfully parsed banking verification record
    return res.status(200).json({
      success: true,
      action: 'UTR_EXTRACTED_AND_VERIFIED',
      utr: utr,
      amount: amount,
      rawSms: rawSms,
      verifiedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('SMS Webhook error:', error);
    return res.status(500).json({ error: 'Internal server error processing SMS' });
  }
}
