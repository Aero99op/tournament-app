// Secure Auto-Verification API: Verifies incoming UTR against genuine Bank/FamPay transaction records
// Works on Vercel Serverless & Cloudflare Edge (Zero dependencies)

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

    if (!tourneyId) {
      return res.status(400).json({ error: 'Missing tourneyId' });
    }

    if (!utr || utr.length < 8) {
      return res.status(400).json({ error: 'Invalid or missing UTR reference number' });
    }

    // 1. Fetch tournament and its team records from Supabase
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

    // 2. Check if a genuine bank credit alert (via Webhook, FamPay email, or SMS Bot) matches this UTR
    const verifiedAlerts = Array.isArray(tourney.verifiedAlerts) ? tourney.verifiedAlerts : [];
    const isAlertMatched = verifiedAlerts.some(alert => 
      alert.utr === utr || (alert.rawText && alert.rawText.includes(utr))
    );

    // 3. Find target squad
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

    // 4. If genuine bank alert confirmed OR already approved:
    if (isAlertMatched || targetSquad.paymentStatus === "APPROVED") {
      targetSquad.paymentStatus = "APPROVED";
      targetSquad.autoVerified = true;
      targetSquad.verifiedAt = targetSquad.verifiedAt || new Date().toISOString();
      targetSquad.verifiedSource = "Bank_UPI_Gateway_Match";

      await fetch(`${SUPABASE_URL}/rest/v1/tournaments?id=eq.${tourneyId}`, {
        method: "PATCH",
        headers: {
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({ teams: teams })
      });

      return res.status(200).json({
        success: true,
        approved: true,
        squadName: targetSquad.name,
        slot: targetSquad.slot,
        utr: targetSquad.utr,
        status: "APPROVED",
        message: "Payment verified against Bank/FamPay records. Squad approved!"
      });
    }

    // 5. If NO bank alert received yet for this UTR:
    return res.status(200).json({
      success: true,
      approved: false,
      squadName: targetSquad.name,
      slot: targetSquad.slot,
      utr: targetSquad.utr,
      status: "PENDING",
      message: "Payment alert not received in organizer's bank account yet. Slot is safely reserved pending bank credit confirmation."
    });
  } catch (error) {
    console.error("Auto-verify error:", error);
    return res.status(500).json({ error: "Verification check failed: " + error.message });
  }
}
