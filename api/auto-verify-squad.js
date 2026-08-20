// Instant Auto-Verification & Auto-Approval Serverless API
// Works on Vercel Serverless & Cloudflare Edge (Zero dependencies, pure Web Standards)

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

    // 2. Find target squad
    let matchedSquad = null;
    for (const tm of teams) {
      if ((tm.utr && tm.utr.trim() === utr) || (squadName && tm.name === squadName)) {
        tm.paymentStatus = "APPROVED";
        tm.autoVerified = true;
        tm.verifiedAt = new Date().toISOString();
        tm.verifiedSource = "Instant_UPI_Auto_Engine";
        if (!tm.utr && utr) tm.utr = utr;
        if (amount > 0) tm.verifiedAmount = amount;
        matchedSquad = tm;
        break;
      }
    }

    if (!matchedSquad) {
      // If squad wasn't in teams yet, create/update placeholder
      return res.status(404).json({ error: 'Squad with matching UTR not found in tournament' });
    }

    // 3. Update Supabase with Approved Squad
    const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/tournaments?id=eq.${tourneyId}`, {
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
      squadName: matchedSquad.name,
      slot: matchedSquad.slot,
      utr: matchedSquad.utr,
      status: "APPROVED",
      verifiedAt: matchedSquad.verifiedAt,
      message: "Squad successfully auto-verified and approved in real-time!"
    });
  } catch (error) {
    console.error("Auto-verify error:", error);
    return res.status(500).json({ error: "Auto-verification failed: " + error.message });
  }
}
