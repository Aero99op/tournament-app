// Serverless Webhook Endpoint for Bank SMS & PhonePe App Notification Auto-Verification
// Works on Vercel Serverless & Cloudflare Pages Edge Runtime (Zero dependencies, pure Web Standards)

const SUPABASE_URL = "https://vufeeywjdrxxxdkwwkzx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ1ZmVleXdqZHJ4eHhka3d3a3p4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5NjI1ODQsImV4cCI6MjEwMjUzODU4NH0.kKTxCwYDaDuVEcanoEn33F_et3RCfHTyIlZyBqq_XNs";

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
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
      service: 'Vortex Esports PhonePe & Bank SMS Auto-Verification Webhook',
      timestamp: new Date().toISOString()
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    const body = req.body || {};
    const rawText = body.sms || body.notification || body.message || body.text || body.body || (typeof body === 'string' ? body : '');
    const secretKey = body.secret || req.headers['x-secret-key'] || '';

    // Simple optional security key
    const EXPECTED_SECRET = process.env.VTX_SMS_SECRET || 'VTX_AUTO_VERIFY_2026';
    if (secretKey && secretKey !== EXPECTED_SECRET) {
      return res.status(401).json({ error: 'Unauthorized secret key' });
    }

    if (!rawText) {
      return res.status(400).json({ error: 'Missing text in payload (e.g. { sms: "..." })' });
    }

    // 1. Intelligent 12-Digit UTR Extraction Regex
    const utrRegex = /(?:UPI(?:\s*Ref(?:\s*No|\s*ID)?|\/)|UTR(?:\s*No|\s*ID)?|Ref(?:\s*No|\s*ID)?|Txn(?:\s*ID|\s*No)?|Reference(?:\s*No)?)[ :\/#-]*([0-9]{12})/i;
    const generic12Digits = /\b([0-9]{12})\b/;

    const utrMatch = rawText.match(utrRegex) || rawText.match(generic12Digits);
    const utr = utrMatch ? utrMatch[1] : null;

    // 2. Extract Unique NPCI Transaction Reference Code (e.g. VTX-TR-829104 or VTX829104)
    const trRegex = /(?:VTX-?TR-?|VTX-?)([0-9]{5,8})/i;
    const trMatch = rawText.match(trRegex);
    const trCode = trMatch ? ("VTX" + trMatch[1]) : null;

    // 3. Amount Extraction Regex (Handles: "₹50", "Rs 50", "50.00 received", "credited with Rs 50")
    const amtRegex = /(?:Rs\.?|INR|₹|credited\s*(?:by|with)?\s*(?:Rs\.?|INR|₹)?)\s*([0-9]+(?:\.[0-9]{1,2})?)/i;
    const amtMatch = rawText.match(amtRegex);
    const amount = amtMatch ? parseFloat(amtMatch[1]) : 0;

    // 4. Search and Auto-Update Supabase Database directly
    let matchedSquad = null;
    let matchedTourney = null;

    try {
      const getRes = await fetch(`${SUPABASE_URL}/rest/v1/tournaments?select=*`, {
        headers: {
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`
        }
      });
      const tournaments = await getRes.json();

      if (Array.isArray(tournaments)) {
        for (const t of tournaments) {
          if (Array.isArray(t.teams)) {
            let modified = false;
            
            // Priority 1: Exact Unique NPCI trCode Match
            if (trCode) {
              for (const tm of t.teams) {
                if (tm.trCode && String(tm.trCode).toLowerCase().replace(/[^a-z0-9]/g, '') === String(trCode).toLowerCase().replace(/[^a-z0-9]/g, '')) {
                  tm.paymentStatus = "APPROVED";
                  tm.autoVerified = true;
                  tm.verifiedAt = new Date().toISOString();
                  tm.verifiedAmount = amount || tm.paymentAmount || 50;
                  if (utr && !tm.utr) tm.utr = utr;
                  matchedSquad = tm;
                  matchedTourney = t;
                  modified = true;
                  break;
                }
              }
            }

            // Priority 2: Exact 12-digit UTR Match
            if (!modified && utr) {
              for (const tm of t.teams) {
                if (tm.utr && String(tm.utr).trim() === String(utr).trim()) {
                  tm.paymentStatus = "APPROVED";
                  tm.autoVerified = true;
                  tm.verifiedAt = new Date().toISOString();
                  tm.verifiedAmount = amount || tm.paymentAmount || 50;
                  matchedSquad = tm;
                  matchedTourney = t;
                  modified = true;
                  break;
                }
              }
            }

            // Priority 3: PhonePe Instant Notification Amount Match for oldest pending squad
            if (!modified && amount > 0) {
              const pendingSquad = t.teams.find(tm => tm.paymentStatus === "PENDING");
              if (pendingSquad) {
                pendingSquad.paymentStatus = "APPROVED";
                pendingSquad.autoVerified = true;
                pendingSquad.verifiedAt = new Date().toISOString();
                pendingSquad.verifiedAmount = amount;
                if (utr && !pendingSquad.utr) pendingSquad.utr = utr;
                matchedSquad = pendingSquad;
                matchedTourney = t;
                modified = true;
              }
            }

            if (modified) {
              await fetch(`${SUPABASE_URL}/rest/v1/tournaments?id=eq.${t.id}`, {
                method: "PATCH",
                headers: {
                  "apikey": SUPABASE_ANON_KEY,
                  "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
                  "Content-Type": "application/json",
                  "Prefer": "return=minimal"
                },
                body: JSON.stringify({ teams: t.teams })
              });
              break;
            }
          }
        }
      }
    } catch (dbErr) {
      console.warn("Supabase direct update note:", dbErr);
    }

    return res.status(200).json({
      success: true,
      action: 'NOTIFICATION_VERIFIED',
      utr: utr || 'PHONEPE_INSTANT_ALERT',
      amount: amount,
      matched: matchedSquad ? true : false,
      squadName: matchedSquad ? matchedSquad.name : null,
      tourneyTitle: matchedTourney ? matchedTourney.title : null,
      rawText: rawText,
      verifiedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('PhonePe Webhook error:', error);
    return res.status(500).json({ error: 'Internal server error processing notification' });
  }
}
