// =============================================================================
// emailOtp.js — Brevo (Sendinblue) SMTP email OTP utility
// =============================================================================
// Usage:
//   const { sendOtpEmail } = require('./utils/emailOtp');
//   await sendOtpEmail('user@example.com', '283741');
//
// Requires in .env:
//   BREVO_SMTP_HOST    (default: smtp-relay.brevo.com)
//   BREVO_SMTP_PORT    (default: 587)
//   BREVO_SMTP_USER    (your Brevo SMTP login email)
//   BREVO_API_KEY      (your Brevo API key — used as SMTP password)
//   BREVO_FROM_EMAIL   (default: no-reply@fixmycity.in)
//   BREVO_FROM_NAME    (default: FixMyCity)
//
// In dev, if BREVO_SMTP_USER or BREVO_API_KEY is unset, the OTP is only
// logged to the console so the server still boots and runs without crashing.
// =============================================================================

'use strict';

const nodemailer = require('nodemailer');

const {
  BREVO_SMTP_HOST  = 'smtp-relay.brevo.com',
  BREVO_SMTP_PORT  = '587',
  BREVO_SMTP_USER  = '',
  BREVO_API_KEY    = '',
  BREVO_FROM_EMAIL = 'no-reply@fixmycity.in',
  BREVO_FROM_NAME  = 'FixMyCity',
} = process.env;

// Hard cap on how long any single send attempt may take. Keeps a blocked
// SMTP port or a hung API call from ever stalling the login request.
const SEND_TIMEOUT_MS = parseInt(process.env.OTP_SEND_TIMEOUT_MS || '9000', 10);

// Lazily create the transporter once so the connection pool is reused.
let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;
  _transporter = nodemailer.createTransport({
    host: BREVO_SMTP_HOST,
    port: parseInt(BREVO_SMTP_PORT, 10),
    secure: false, // STARTTLS on port 587
    auth: {
      user: BREVO_SMTP_USER,
      pass: BREVO_API_KEY,
    },
    // Fail fast instead of hanging the login request when the SMTP port is
    // unreachable (e.g. Render's free tier blocks outbound 25/465/587).
    connectionTimeout: 8000, // ms to establish the TCP connection
    greetingTimeout:   8000, // ms to wait for the SMTP greeting
    socketTimeout:     8000, // ms of inactivity on the socket
  });
  return _transporter;
}

/**
 * Build a premium HTML email body for the OTP.
 */
function buildOtpHtml(otp) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>FixMyCity — OTP Verification</title>
</head>
<body style="margin:0;padding:0;background:#f4f8f6;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f8f6;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0"
               style="background:#ffffff;border-radius:16px;overflow:hidden;
                      box-shadow:0 4px 24px rgba(15,118,110,0.10);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#0f766e 0%,#14b8a6 100%);
                        padding:36px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:800;
                          letter-spacing:-0.5px;">FixMyCity</h1>
              <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">
                Super Admin Verification
              </p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 24px;">
              <p style="margin:0 0 20px;color:#0f172a;font-size:16px;line-height:1.6;">
                You are logging in as the <strong>Super Admin</strong>. Use the
                one-time password below to complete authentication.
              </p>

              <!-- OTP Box -->
              <div style="background:#f0fdf9;border:2px solid #14b8a6;border-radius:12px;
                          padding:24px;text-align:center;margin:24px 0;">
                <p style="margin:0 0 8px;color:#475569;font-size:13px;
                           text-transform:uppercase;letter-spacing:0.08em;font-weight:700;">
                  Your One-Time Password
                </p>
                <p style="margin:0;color:#0f766e;font-size:42px;font-weight:900;
                           letter-spacing:12px;font-variant-numeric:tabular-nums;">
                  ${otp}
                </p>
              </div>

              <p style="margin:0 0 12px;color:#64748b;font-size:14px;line-height:1.6;">
                This OTP is valid for <strong>10 minutes</strong>. Do not share it
                with anyone. If you did not attempt to log in, please secure your
                account immediately.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px 36px;border-top:1px solid #e2e8f0;text-align:center;">
              <p style="margin:0;color:#94a3b8;font-size:12px;">
                © ${new Date().getFullYear()} FixMyCity — Civic Complaint Management System
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * sendOtpEmail(toEmail, otp)
 *
 * Sends a styled OTP email to the given address via Brevo SMTP.
 * In dev (no BREVO_SMTP_USER / BREVO_API_KEY), logs OTP to console instead.
 *
 * @param {string} toEmail  — Recipient email address
 * @param {string} otp      — 6-digit OTP string
 * @returns {Promise<void>}
 */
async function sendOtpEmail(toEmail, otp) {
  // Stub mode — no API key at all. Log the OTP so dev/boot still works.
  if (!BREVO_API_KEY) {
    console.warn(
      `[emailOtp] ⚠️  Brevo credentials not set. Stubbing email delivery.\n` +
      `[emailOtp] OTP for ${toEmail}: ${otp}  (visible in console only — configure BREVO_API_KEY for real delivery)`
    );
    return;
  }

  // Route by key type:
  //   • v3 API key ("xkeysib-…")  → HTTP API over port 443. REQUIRED on hosts
  //     that block outbound SMTP (e.g. Render's free tier).
  //   • SMTP password ("xsmtpsib-…") or anything else → nodemailer SMTP, which
  //     needs BREVO_SMTP_USER too. Works locally where 587 is reachable.
  if (BREVO_API_KEY.startsWith('xkeysib-')) {
    return sendViaHttpApi(toEmail, otp);
  }

  if (!BREVO_SMTP_USER) {
    console.warn(
      `[emailOtp] ⚠️  SMTP mode needs BREVO_SMTP_USER (none set). Stubbing.\n` +
      `[emailOtp] OTP for ${toEmail}: ${otp}  (use a v3 API key "xkeysib-…" for HTTP delivery, or set BREVO_SMTP_USER)`
    );
    return;
  }

  return sendViaSmtp(toEmail, otp);
}

/**
 * sendViaSmtp(toEmail, otp) — deliver over Brevo SMTP via nodemailer.
 * Uses the SMTP password (BREVO_API_KEY, prefix "xsmtpsib-") + BREVO_SMTP_USER.
 * Note: will fail on hosts that block outbound SMTP ports (25/465/587).
 */
async function sendViaSmtp(toEmail, otp) {
  const transporter = getTransporter();

  const mailOptions = {
    from: `"${BREVO_FROM_NAME}" <${BREVO_FROM_EMAIL}>`,
    to: toEmail,
    subject: 'FixMyCity — Super Admin OTP Verification',
    text: `Your FixMyCity Super Admin OTP is: ${otp}\nThis code expires in 10 minutes. Do not share it.`,
    html: buildOtpHtml(otp),
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`[emailOtp] OTP email sent to ${toEmail} via SMTP  messageId=${info.messageId}`);
  } catch (err) {
    // Surface the error so the caller can decide to abort or warn the user
    console.error(`[emailOtp] Failed to send OTP email to ${toEmail} via SMTP:`, err.message);
    throw err;
  }
}

/**
 * sendViaHttpApi(toEmail, otp)
 *
 * Sends the OTP through Brevo's transactional HTTP API
 * (POST https://api.brevo.com/v3/smtp/email) over HTTPS (443).
 *
 * Why this exists: many PaaS hosts (Render free tier, etc.) BLOCK outbound
 * SMTP ports (25/465/587) to curb spam, so nodemailer's transporter hangs
 * until timeout and never delivers. Port 443 is never blocked, so the HTTP
 * API works where SMTP cannot. Requires a v3 API key (prefix `xkeysib-`),
 * NOT the SMTP password (prefix `xsmtpsib-`).
 *
 * Uses the global `fetch` built into Node 18+ with an AbortController hard
 * timeout so a slow/hung API call can never block the login request.
 */
async function sendViaHttpApi(toEmail, otp) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { name: BREVO_FROM_NAME, email: BREVO_FROM_EMAIL },
        to: [{ email: toEmail }],
        subject: 'FixMyCity — Super Admin OTP Verification',
        textContent: `Your FixMyCity Super Admin OTP is: ${otp}\nThis code expires in 10 minutes. Do not share it.`,
        htmlContent: buildOtpHtml(otp),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      // Brevo returns a JSON error body (e.g. sender not verified, bad key)
      const detail = await res.text().catch(() => '');
      throw new Error(`Brevo API ${res.status}: ${detail.slice(0, 300)}`);
    }

    const data = await res.json().catch(() => ({}));
    console.log(`[emailOtp] OTP email sent to ${toEmail} via HTTP API  messageId=${data.messageId || 'n/a'}`);
  } catch (err) {
    console.error(`[emailOtp] Failed to send OTP email to ${toEmail} via HTTP API:`, err.message);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { sendOtpEmail };
