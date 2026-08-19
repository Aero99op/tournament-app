# ⚡ Vortex 24/7 Cloud Auto-Verification Worker

Standalone 24/7 background worker for auto-verifying UPI tournament payments across FamPay, PhonePe, Google Pay, and Paytm.

---

## 🌟 Features

1. **NPCI Dynamic Reference Matcher (`tr` / `tn`)**:
   - Matches transactions using pre-locked unique tokens (e.g. `VTX982103`).
   - 100% zero-friction, automated matching without typing mistakes.
2. **12-Digit Bank UTR Intelligent Regex**:
   - Accurately parses 12-digit bank reference IDs from SMS, emails, and app push notifications.
3. **Live Supabase Sync & Auto-Approval**:
   - Updates tournament registrations in real-time.
   - Triggers glowing live success screen on the player's device within 3 seconds.
4. **Zero Dependencies & 100% Free**:
   - Runs natively on Node.js 18+ Web Standards (Fetch, Streams, WebCrypto).
   - Fits comfortably inside Render.com / Railway / Koyeb free tiers ($0/month).

---

## 🚀 2-Minute Free Deployment on Render

1. Go to [Render.com](https://dashboard.render.com/) and click **New +** ➔ **Web Service**.
2. Connect your GitHub repository: `tournament-app`.
3. Set the following settings:
   - **Root Directory**: `cloud-worker`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node worker.js`
   - **Instance Type**: `Free`
4. Add Environment Variables:
   - `SUPABASE_URL`: `https://vufeeywjdrxxxdkwwkzx.supabase.co`
   - `SUPABASE_ANON_KEY`: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`
   - `VTX_SMS_SECRET`: `VTX_AUTO_VERIFY_2026`
5. Click **Deploy Web Service**!

---

## 📡 API Endpoints

- `GET /health`: Healthcheck endpoint for Render / UptimeRobot keep-alive.
- `POST /webhook/payment`: Accepts incoming webhook alerts from SMS forwarders, Macrodroid, or bank alerts.
- `POST /scan-gmail`: Scans connected Google OAuth mailbox for payment credit emails.
