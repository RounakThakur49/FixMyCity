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
  NODE_ENV         = 'development',
} = process.env;

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
  // Stub mode — credentials not configured
  if (!BREVO_SMTP_USER || !BREVO_API_KEY) {
    console.warn(
      `[emailOtp] ⚠️  Brevo credentials not set. Stubbing email delivery.\n` +
      `[emailOtp] OTP for ${toEmail}: ${otp}  (visible in console only — configure BREVO_SMTP_USER + BREVO_API_KEY for real delivery)`
    );
    return;
  }

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
    console.log(`[emailOtp] OTP email sent to ${toEmail}  messageId=${info.messageId}`);
  } catch (err) {
    // Surface the error so the caller can decide to abort or warn the user
    console.error(`[emailOtp] Failed to send OTP email to ${toEmail}:`, err.message);
    throw err;
  }
}

module.exports = { sendOtpEmail };
