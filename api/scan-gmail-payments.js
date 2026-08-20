// Serverless API to Scan Gmail Payment Alerts & Auto-Approve Squads in Supabase
// Works on Vercel & Cloudflare Edge (Zero dependencies)

const SUPABASE_URL = "https://vufeeywjdrxxxdkwwkzx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ1ZmVleXdqZHJ4eHhka3d3a3p4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5NjI1ODQsImV4cCI6MjEwMjUzODU4NH0.kKTxCwYDaDuVEcanoEn33F_et3RCfHTyIlZyBqq_XNs";

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const accessToken = req.headers.authorization?.replace('Bearer ', '') || req.query.access_token || '';
    const organizerId = req.query.organizer_id || req.body?.organizer_id || '';
    const directEmailText = req.body?.emailText || req.body?.text || '';

    let scannedAlerts = [];

    // 1. If accessToken provided, query Gmail REST API across all official UPI & Bank senders
    if (accessToken) {
      try {
        const senders = [
          "no-reply@famapp.in", "alerts@famapp.in", "payments@famapp.in", "support@famapp.in", "alerts@fampay.in", "payments@fampay.in", "no-reply@fampay.in",
          "noreply@phonepe.com", "alerts@phonepe.com", "support@phonepe.com", "transactions@phonepe.com",
          "payments-noreply@google.com", "googlepay-noreply@google.com",
          "alerts@paytm.com", "no-reply@paytm.com", "care@paytm.com", "payment-alerts@paytm.com",
          "alerts@sbi.co.in", "donotreply@sbi.co.in", "onlinesbi@sbi.co.in",
          "alerts@hdfcbank.net", "instamail@hdfcbank.net", "alerts@hdfcbank.bank.in",
          "alerts@icicibank.com", "transactionalerts@icicibank.com",
          "alerts@axisbank.com", "alerts@kotak.com", "alerts@pnb.co.in", "alerts@bankofbaroda.com",
          "alerts@cred.club", "alerts@jupiter.money", "alerts@fi.money"
        ];
        const fromClause = `from:(${senders.join(" OR ")})`;
        const query = encodeURIComponent(`(${fromClause} OR (credited OR received OR payment OR "Money Received" OR FamApp OR FamPay OR PhonePe OR Paytm OR UPI))`);
        const listRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=15`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        const listData = await listRes.json();

        if (Array.isArray(listData.messages)) {
          for (const msgItem of listData.messages.slice(0, 10)) {
            const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgItem.id}?format=full`, {
              headers: { Authorization: `Bearer ${accessToken}` }
            });
            const msgData = await msgRes.json();
            if (msgData.snippet) {
              scannedAlerts.push(msgData.snippet);
            }
          }
        }
      } catch (gmailErr) {
        console.warn("Gmail API query note:", gmailErr.message);
      }
    }

    if (directEmailText) {
      scannedAlerts.push(directEmailText);
    }

    // 2. Fetch pending squads from Supabase
    const getRes = await fetch(`${SUPABASE_URL}/rest/v1/tournaments?select=*`, {
      headers: {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`
      }
    });
    const tournaments = await getRes.json();

    let approvedSquads = [];

    if (Array.isArray(tournaments)) {
      for (const t of tournaments) {
        if (Array.isArray(t.teams)) {
          let modified = false;

          for (const tm of t.teams) {
            if (tm.paymentStatus === "PENDING" && tm.utr) {
              // Check if UTR is found in any scanned alerts
              for (const alertText of scannedAlerts) {
                if (alertText.includes(tm.utr)) {
                  tm.paymentStatus = "APPROVED";
                  tm.autoVerified = true;
                  tm.verifiedAt = new Date().toISOString();
                  tm.verifiedSource = "Gmail_Cloud_Auto_Verify";
                  approvedSquads.push({
                    squadName: tm.name,
                    tourneyTitle: t.title,
                    utr: tm.utr,
                    amount: tm.paymentAmount || t.entry_fee || 20
                  });
                  modified = true;
                  break;
                }
              }
            }
          }

          t.verifiedAlerts = Array.isArray(t.verifiedAlerts) ? t.verifiedAlerts : [];
          for (const alertText of scannedAlerts) {
            const utrM = alertText.match(/\b([0-9]{12})\b/);
            if (utrM && !t.verifiedAlerts.some(a => a.utr === utrM[1])) {
              t.verifiedAlerts.push({ utr: utrM[1], rawText: alertText, timestamp: new Date().toISOString() });
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
              body: JSON.stringify({ teams: t.teams, verifiedAlerts: t.verifiedAlerts })
            });
          }
        }
      }
    }

    return res.status(200).json({
      success: true,
      scannedAlertsCount: scannedAlerts.length,
      approvedSquadsCount: approvedSquads.length,
      approvedSquads: approvedSquads,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Scan Gmail error:", error);
    return res.status(500).json({ error: "Failed to scan Gmail payments: " + error.message });
  }
}
