// Serverless Endpoint to Initiate 1-Click Google OAuth for Multi-Organizer Gmail Auto-Verification
// Works on Vercel & Cloudflare Edge (Zero dependencies)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "1030679144152-9o499o7dpfoo5u7o9eir9hn4hplq6k61.apps.googleusercontent.com";
  
  // Intelligent Redirect URI resolver
  let REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;
  if (!REDIRECT_URI) {
    const origin = req.headers.origin || (req.headers.referer ? new URL(req.headers.referer).origin : null);
    if (origin) {
      REDIRECT_URI = `${origin}/api/auth/callback`;
    } else {
      const host = req.headers['x-forwarded-host'] || req.headers.host || "tournament-app-bay-seven.vercel.app";
      const proto = req.headers['x-forwarded-proto'] || (host.includes('localhost') || host.includes('127.0.0.1') ? 'http' : 'https');
      REDIRECT_URI = `${proto}://${host}/api/auth/callback`;
    }
  }

  const SCOPES = encodeURIComponent("https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile");
  const organizerId = req.query.organizer_id || req.query.tourney_id || "vortex_org";

  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(CLIENT_ID)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${SCOPES}&access_type=offline&prompt=consent&state=${encodeURIComponent(organizerId)}`;

  if (req.query.format === 'json') {
    return res.status(200).json({
      success: true,
      authUrl: googleAuthUrl,
      clientIdConfigured: Boolean(CLIENT_ID),
      redirectUri: REDIRECT_URI
    });
  }

  return res.redirect(302, googleAuthUrl);
}
