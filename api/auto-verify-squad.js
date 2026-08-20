// Secure Real-Time Auto-Verification API:
// 1. Scans Organizer's Bank & FamPay Gmail Alerts / Webhook Feed
// 2. Extracts 12-digit UTR from actual transaction emails
// 3. Matches player-submitted UTR against real credit records
// 4. Auto-approves squad in Supabase when matched

const SUPABASE_URL = "https://vufeeywjdrxxxdkwwkzx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ1ZmVleXdqZHJ4eHhka3d3a3p4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5NjI1ODQsImV4cCI6MjEwMjUzODU4NH0.kKTxCwYDaDuVEcanoEn33F_et3RCfHTyIlZyBqq_XNs";

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    const body = req.body || {};
    const tourneyId = body.tourneyId || body.tournamentId || body.id;
    const utr = (body.utr || '').trim();
    const squadName = (body.squadName || body.name || '').trim();
    const amount = Number(body.amount || 0);
    const googleAccessToken = req.headers.authorization?.replace('Bearer ', '') || body.access_token || '';

    if (!tourneyId) {
      return res.status(400).json({ error: 'Missing tourneyId' });
    }

    if (!utr || utr.length < 8) {
      return res.status(400).json({ error: 'Invalid or missing UTR reference number' });
    }

    // 1. Fetch tournament from Supabase
    const getRes = await fetch(`${SUPABASE_URL}/rest/v1/tournaments?id=eq.${tourneyId}&select=*`, {
      headers: {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`
      }
    });
    const tournaments = await getRes.json();

    if (!Array.isArray(tournaments) || tournaments.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const tourney = tournaments[0];
    const teams = Array.isArray(tourney.teams) ? tourney.teams : [];
    let verifiedAlerts = Array.isArray(tourney.verifiedAlerts) ? tourney.verifiedAlerts : [];

    // 2. Scan Organizer's Gmail for payment alerts from all official UPI & Bank senders (Verified via official records)
    if (googleAccessToken) {
      try {
        const senders = [
          // FamApp & FamPay (Official & TrioTech Parent Domain)
          "no-reply@famapp.in", "alerts@famapp.in", "payments@famapp.in", "support@famapp.in", "support@triotech.co.in", "alerts@fampay.in", "payments@fampay.in", "no-reply@fampay.in",
          // PhonePe
          "noreply@phonepe.com", "alerts@phonepe.com", "support@phonepe.com", "transactions@phonepe.com",
          // Google Pay / Google Payments
          "payments-noreply@google.com", "googlepay-noreply@google.com",
          // Paytm
          "alerts@paytm.com", "no-reply@paytm.com", "care@paytm.com", "payment-alerts@paytm.com",
          // Major Indian Banks
          "alerts@sbi.co.in", "donotreply@sbi.co.in", "onlinesbi@sbi.co.in",
          "alerts@hdfcbank.net", "instamail@hdfcbank.net", "alerts@hdfcbank.com", "alerts@hdfcbank.bank.in",
          "alerts@icicibank.com", "transactionalerts@icicibank.com",
          "alerts@axisbank.com", "alerts@kotak.com", "alerts@pnb.co.in", "alerts@bankofbaroda.com",
          // Neo-Banks
          "alerts@cred.club", "alerts@jupiter.money", "alerts@fi.money"
        ];
        const fromClause = `from:(${senders.join(" OR ")})`;
        const query = encodeURIComponent(`(${fromClause} OR (credited OR received OR payment OR "Money Received" OR FamApp OR FamPay OR PhonePe OR Paytm OR UPI)) ${utr}`);
        const listRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=5`, {
          headers: { Authorization: `Bearer ${googleAccessToken}` }
        });
        const listData = await listRes.json();

        if (Array.isArray(listData.messages) && listData.messages.length > 0) {
          for (const msgItem of listData.messages) {
            const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgItem.id}?format=full`, {
              headers: { Authorization: `Bearer ${googleAccessToken}` }
            });
            const msgData = await msgRes.json();
            if (msgData.snippet && msgData.snippet.includes(utr)) {
              verifiedAlerts.push({
                utr: utr,
                rawText: msgData.snippet,
                source: "Gmail_Auto_Scan",
                timestamp: new Date().toISOString()
              });
              break;
            }
          }
        }
      } catch (gmailErr) {
        console.warn("Gmail API live query note:", gmailErr.message);
      }
    }

    // 3. Check if UTR is matched in verified bank/FamPay alert records
    const isAlertMatched = verifiedAlerts.some(alert => 
      alert.utr === utr || (alert.rawText && alert.rawText.includes(utr))
    );

    // 4. Find target squad
    let targetSquad = null;
    for (const tm of teams) {
      if ((tm.utr && tm.utr.trim() === utr) || (squadName && tm.name === squadName)) {
        targetSquad = tm;
        break;
      }
    }

    if (!targetSquad) {
      return res.status(404).json({ error: 'Squad not found in tournament roster' });
    }

    // 5. IF MATCHED: Auto-approve in Supabase immediately!
    if (isAlertMatched || targetSquad.paymentStatus === "APPROVED") {
      targetSquad.paymentStatus = "APPROVED";
      targetSquad.autoVerified = true;
      targetSquad.verifiedAt = targetSquad.verifiedAt || new Date().toISOString();
      targetSquad.verifiedSource = "Bank_FamPay_Email_Match";
      if (!targetSquad.utr && utr) targetSquad.utr = utr;

      await fetch(`${SUPABASE_URL}/rest/v1/tournaments?id=eq.${tourneyId}`, {
        method: "PATCH",
        headers: {
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({ teams: teams, verifiedAlerts: verifiedAlerts })
      });

      return res.status(200).json({
        success: true,
        approved: true,
        squadName: targetSquad.name,
        slot: targetSquad.slot,
        utr: targetSquad.utr,
        status: "APPROVED",
        message: "Payment verified against Bank/FamPay email records. Squad auto-approved in real-time!"
      });
    }

    // 6. IF NOT MATCHED YET (e.g. email delayed or fake UTR):
    return res.status(200).json({
      success: true,
      approved: false,
      squadName: targetSquad.name,
      slot: targetSquad.slot,
      utr: targetSquad.utr,
      status: "PENDING",
      message: "Payment alert not found in organizer's bank records yet. System is scanning live..."
    });
  } catch (error) {
    console.error("Auto-verify error:", error);
    return res.status(500).json({ error: "Verification check failed: " + error.message });
  }
}
