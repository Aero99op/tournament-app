// 24/7 Multi-Organizer Cloud Payment Auto-Verification Worker
// Can be deployed on Render.com (Background Worker / Web Service)
// Zero External Dependencies (Uses native fetch and Node http)

import http from 'http';

const SUPABASE_URL = process.env.SUPABASE_URL || "https://vufeeywjdrxxxdkwwkzx.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ1ZmVleXdqZHJ4eHhka3d3a3p4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5NjI1ODQsImV4cCI6MjEwMjUzODU4NH0.kKTxCwYDaDuVEcanoEn33F_et3RCfHTyIlZyBqq_XNs";
const PORT = process.env.PORT || 3000;

console.log("⚡ Vortex Esports Cloud Payment Worker starting on port " + PORT + "...");

export async function processPaymentText(rawText, source = "Cloud_Worker") {
  if (!rawText) return { success: false, error: "Empty payment payload" };

  // 1. Extract 12-Digit UTR
  const utrRegex = /(?:UPI(?:\s*Ref(?:\s*No|\s*ID)?|\/)|UTR(?:\s*No|\s*ID)?|Ref(?:\s*No|\s*ID)?|Txn(?:\s*ID|\s*No)?|Reference(?:\s*No)?)[ :\/#-]*([0-9]{12})/i;
  const generic12Digits = /\b([0-9]{12})\b/;

  const utrMatch = rawText.match(utrRegex) || rawText.match(generic12Digits);
  const utr = utrMatch ? utrMatch[1] : null;

  // 2. Extract Unique NPCI Transaction Reference Code (e.g. VTX-TR-829104 or VTX829104)
  const trRegex = /(?:VTX-?TR-?|VTX-?)([0-9]{5,8})/i;
  const trMatch = rawText.match(trRegex);
  const trCode = trMatch ? ("VTX" + trMatch[1]) : null;

  // 3. Extract Amount
  const amtRegex = /(?:Rs\.?|INR|₹|credited\s*(?:by|with)?\s*(?:Rs\.?|INR|₹)?)\s*([0-9]+(?:\.[0-9]{1,2})?)/i;
  const amtMatch = rawText.match(amtRegex);
  const amount = amtMatch ? parseFloat(amtMatch[1]) : 0;

  console.log(`[${source}] Parsed -> trCode: ${trCode || 'N/A'}, UTR: ${utr || 'N/A'}, Amount: ₹${amount}`);

  // 4. Search and Match Supabase Database
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

          // Priority 1: Match by Unique NPCI trCode
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

          // Priority 2: Match by 12-Digit UTR
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

          // Priority 3: Fallback Match oldest pending squad if amount matches
          if (!modified && amount > 0) {
            const pendingSquad = t.teams.find(tm => tm.paymentStatus === "PENDING" && Number(tm.paymentAmount || t.entry_fee || 0) === amount);
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
            console.log(`✅ [AUTO-APPROVED] Squad: '${matchedSquad.name}' in Tourney: '${t.title}'!`);
            break;
          }
        }
      }
    }
  } catch (err) {
    console.error("Supabase Cloud Worker error:", err);
  }

  return {
    success: true,
    utr: utr,
    amount: amount,
    matched: matchedSquad ? true : false,
    squadName: matchedSquad ? matchedSquad.name : null,
    tourneyTitle: matchedTourney ? matchedTourney.title : null
  };
}

// Start Lightweight HTTP Inbound Server
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'online',
      service: 'Vortex Esports 24/7 Render Cloud Payment Worker',
      uptime: process.uptime()
    }));
    return;
  }

  if (req.method === 'POST') {
    let bodyData = '';
    req.on('data', chunk => { bodyData += chunk; });
    req.on('end', async () => {
      try {
        let parsed = {};
        try { parsed = JSON.parse(bodyData); } catch (e) { parsed = { text: bodyData }; }

        const rawText = parsed.sms || parsed.notification || parsed.message || parsed.text || parsed.emailBody || bodyData;
        const result = await processPaymentText(rawText, "Render_Inbound_Webhook");

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  }
});

server.listen(PORT, () => {
  console.log(`🚀 Vortex Cloud Worker running 24/7 on port ${PORT}!`);
});
