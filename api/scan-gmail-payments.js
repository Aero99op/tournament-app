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

    // 1. If accessToken provided, query Gmail REST API
    if (accessToken) {
      try {
        const query = encodeURIComponent("from:(alerts@sbi.co.in OR alerts@hdfcbank.net OR noreply@phonepe.com OR alerts@fampay.in OR alerts@paytm.com) credited");
        const listRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=10`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        const listData = await listRes.json();

        if (Array.isArray(listData.messages)) {
          for (const msgItem of listData.messages.slice(0, 5)) {
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
