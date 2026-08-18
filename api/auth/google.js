// Serverless Endpoint to Initiate 1-Click Google OAuth for Multi-Organizer Gmail Auto-Verification
// Works on Vercel & Cloudflare Edge (Zero dependencies)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "1082910482910-vortexesports.apps.googleusercontent.com";
  const host = req.headers['x-forwarded-host'] || req.headers.host || "localhost:3000";
  const proto = req.headers['x-forwarded-proto'] || (host.includes('localhost') ? 'http' : 'https');
  const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || `${proto}://${host}/api/auth/callback`;
  const SCOPES = encodeURIComponent("https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile");
  const organizerId = req.query.organizer_id || req.query.tourney_id || "vortex_org";

  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(CLIENT_ID)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${SCOPES}&access_type=offline&prompt=consent&state=${encodeURIComponent(organizerId)}`;

  if (req.query.format === 'json') {
    return res.status(200).json({
      success: true,
      authUrl: googleAuthUrl,
      clientIdConfigured: Boolean(process.env.GOOGLE_CLIENT_ID)
    });
  }

  return res.redirect(302, googleAuthUrl);
}
