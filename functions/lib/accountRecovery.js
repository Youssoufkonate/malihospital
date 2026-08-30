const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { checkRateLimit } = require("./helpers");
const { verifyRecaptchaToken, recaptchaV2Secret } = require("./recaptcha");
const { sendEmail, emailSecrets } = require("./emailSender");

/**
 * Replaces relying on Firebase's own generic "forgot password" flow
 * with a version that adds three real layers, matching the actual ask:
 *
 *   1. RATE LIMITING — at most 3 requests per email per hour. Without
 *      this, "Forgot Password" is a free, repeatable action anyone can
 *      hammer against any email address.
 *   2. RECAPTCHA — the same v2 checkbox already on the login page,
 *      required here too, so this endpoint can't be scripted directly.
 *   3. VERIFIED EMAIL REQUIRED — if the account's email was never
 *      verified (see the email-verification gate already in
 *      SessionGuard), no reset link is sent at all. An unverified email
 *      might not even belong to the real account owner.
 *
 * Deliberately returns the SAME generic success message whether the
 * account exists, is unverified, or genuinely gets a reset link — this
 * is standard practice specifically to prevent using this endpoint to
 * enumerate which email addresses have accounts on the platform. The
 * only way to know whether it actually worked is whether an email
 * arrives.
 */
exports.requestPasswordReset = onCall({ secrets: [recaptchaV2Secret, ...emailSecrets] }, async (request) => {
  const { email, recaptchaToken } = request.data || {};
  const cleanEmail = (email || "").trim().toLowerCase();

  if (!cleanEmail) {
    throw new HttpsError("invalid-argument", "Email manquant.");
  }

  await checkRateLimit("passwordResetRequest", cleanEmail, 3, 60 * 60 * 1000); // 3/hour per email
  await verifyRecaptchaToken(recaptchaToken);

  const genericMessage = "Si un compte existe avec cette adresse et que l'email est vérifié, un lien de réinitialisation a été envoyé.";

  let userRecord;
  try {
    userRecord = await admin.auth().getUserByEmail(cleanEmail);
  } catch (e) {
    // No account with this email — say nothing different, same generic response.
    return { message: genericMessage };
  }

  if (!userRecord.emailVerified) {
    // Account exists but email was never verified — still say nothing
    // different. Sending a reset link to an unverified address would
    // undermine the whole point of requiring verification elsewhere.
    return { message: genericMessage };
  }

  if (userRecord.disabled) {
    // A disabled account shouldn't be re-enterable via password reset either.
    return { message: genericMessage };
  }

  try {
    const resetLink = await admin.auth().generatePasswordResetLink(cleanEmail);
    await sendEmail({
      to: cleanEmail,
      subject: "Réinitialisation de votre mot de passe — Système Hospitalier du Mali",
      text: `Vous avez demandé la réinitialisation de votre mot de passe.\n\nCliquez sur ce lien pour choisir un nouveau mot de passe :\n${resetLink}\n\nSi vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet email — votre mot de passe actuel reste inchangé.`,
      html: `<p>Vous avez demandé la réinitialisation de votre mot de passe.</p><p><a href="${resetLink}">Cliquez ici pour choisir un nouveau mot de passe</a></p><p>Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet email — votre mot de passe actuel reste inchangé.</p>`,
    });
  } catch (e) {
    // Log for the admin's own visibility, but still return the generic
    // message to the caller — don't leak internal failure details.
    console.error("Error sending password reset email:", e.message);
  }

  return { message: genericMessage };
});