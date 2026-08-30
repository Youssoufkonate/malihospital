const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

// Stored via Firebase's secret manager (firebase functions:secrets:set
// RECAPTCHA_V2_SECRET), never hardcoded here — see SECRETS_MANAGEMENT.md
// for why. Exported so other functions (e.g. the secure account-recovery
// flow) can also declare it in their own onCall({ secrets: [...] }) and
// reuse the same verification logic below.
const recaptchaV2Secret = defineSecret("RECAPTCHA_V2_SECRET");

/**
 * Plain reusable function (not itself an onCall endpoint) — verifies a
 * reCAPTCHA v2 token against Google's servers. Throws HttpsError on
 * failure, so callers can just `await verifyRecaptchaToken(token)` and
 * let the error propagate naturally.
 */
async function verifyRecaptchaToken(token) {
  if (!token) {
    throw new HttpsError("invalid-argument", "Vérification anti-robot manquante.");
  }

  let result;
  try {
    const response = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `secret=${encodeURIComponent(recaptchaV2Secret.value())}&response=${encodeURIComponent(token)}`,
    });
    result = await response.json();
  } catch (e) {
    throw new HttpsError("internal", "Erreur de vérification anti-robot: " + e.message);
  }

  if (!result.success) {
    throw new HttpsError("permission-denied", "Vérification anti-robot échouée. Veuillez réessayer.");
  }
}

/**
 * Verifies a reCAPTCHA v2 ("I'm not a robot" checkbox) token against
 * Google's own servers. Called from the login page BEFORE attempting
 * sign-in — the checkbox alone proves nothing on its own; the token it
 * produces has to be verified server-side (this function), because a
 * bot could otherwise just skip the checkbox entirely and call
 * signInWithEmailAndPassword directly. Deliberately separate from the
 * invisible App Check/reCAPTCHA v3 layer already in place — this is the
 * visible, user-facing second layer specifically for the login page.
 */
exports.verifyRecaptcha = onCall({ secrets: [recaptchaV2Secret] }, async (request) => {
  const { token } = request.data || {};
  await verifyRecaptchaToken(token);
  return { success: true };
});

exports.verifyRecaptchaToken = verifyRecaptchaToken;
exports.recaptchaV2Secret = recaptchaV2Secret;