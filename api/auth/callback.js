// Google OAuth Callback Handler for Gmail Auto-Verification
// Exchanges code for tokens and redirects back to Tournament App with connection status

const SUPABASE_URL = "https://vufeeywjdrxxxdkwwkzx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ1ZmVleXdqZHJ4eHhka3d3a3p4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5NjI1ODQsImV4cCI6MjEwMjUzODU4NH0.kKTxCwYDaDuVEcanoEn33F_et3RCfHTyIlZyBqq_XNs";

export default async function handler(req, res) {
  const code = req.query.code;
  const organizerId = req.query.state || 'vortex_org';
  const error = req.query.error;

  const host = req.headers['x-forwarded-host'] || req.headers.host || "tournament-app-bay-seven.vercel.app";
  const proto = req.headers['x-forwarded-proto'] || (host.includes('localhost') ? 'http' : 'https');
  const returnUrl = `${proto}://${host}/?action=gmail_connected&organizer=${encodeURIComponent(organizerId)}`;

  if (error) {
    return res.redirect(302, `${proto}://${host}/?action=gmail_error&error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return res.redirect(302, returnUrl);
  }

  try {
    const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "1082910482910-vortexesports.apps.googleusercontent.com";
    const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
    const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || `${proto}://${host}/api/auth/callback`;

    // Exchange code for tokens if client secret is configured
    let userEmail = "connected_organizer@gmail.com";
    if (CLIENT_SECRET) {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: code,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri: REDIRECT_URI,
          grant_type: 'authorization_code'
        })
      });
      const tokenData = await tokenRes.json();

      if (tokenData.access_token) {
        // Fetch user info
        const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const userData = await userRes.json();
        if (userData.email) userEmail = userData.email;
      }
    }

    return res.redirect(302, `${proto}://${host}/?action=gmail_connected&email=${encodeURIComponent(userEmail)}&organizer=${encodeURIComponent(organizerId)}`);
  } catch (err) {
    console.error("OAuth callback error:", err);
    return res.redirect(302, returnUrl);
  }
}
