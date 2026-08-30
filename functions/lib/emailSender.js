const nodemailer = require("nodemailer");
const { defineSecret } = require("firebase-functions/params");

// Stored via firebase functions:secrets:set, never hardcoded — see
// SECRETS_MANAGEMENT.md. GMAIL_APP_PASSWORD is an App Password generated
// in the Gmail account's security settings, NOT the account's normal
// login password (Google blocks plain-password SMTP login entirely).
const gmailUser = defineSecret("GMAIL_USER");
const gmailAppPassword = defineSecret("GMAIL_APP_PASSWORD");

// Both callers below need these two secrets bound to their function
// (Cloud Functions v2 requires each function to explicitly declare
// which secrets it uses) — exported so index.js/the calling function's
// onCall({ secrets: [...] }) can reference the same two objects.
const emailSecrets = [gmailUser, gmailAppPassword];

let cachedTransporter = null;
function getTransporter() {
  if (cachedTransporter) return cachedTransporter;
  cachedTransporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: gmailUser.value(),
      pass: gmailAppPassword.value(),
    },
  });
  return cachedTransporter;
}

/**
 * Sends a plain-text/HTML email via Gmail SMTP. Any function that calls
 * this MUST declare emailSecrets in its own onCall({ secrets: [...] })
 * — Cloud Functions v2 only makes a secret's value readable inside a
 * function that explicitly lists it, even if another file imports the
 * same defineSecret() object.
 */
async function sendEmail({ to, subject, text, html }) {
  const transporter = getTransporter();
  await transporter.sendMail({
    from: `"Système Hospitalier du Mali" <${gmailUser.value()}>`,
    to,
    subject,
    text,
    html: html || undefined,
  });
}

module.exports = { sendEmail, emailSecrets, gmailUser, gmailAppPassword };