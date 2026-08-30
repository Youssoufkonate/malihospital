const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getCallerProfile, requireRole } = require("./helpers");

/**
 * Enables TOTP as an available multi-factor method at the PROJECT level.
 * This is a one-time (idempotent — safe to call more than once) setup
 * step, not something end users trigger. Per Firebase's own current
 * documentation, TOTP has no Console UI toggle at all — it can only be
 * turned on via the Admin SDK, which is exactly what this function does,
 * so a Super Admin can trigger it with a button instead of needing to
 * write and run a standalone Node script with service account
 * credentials.
 *
 * Once this has been called successfully ONE time, individual users can
 * enroll in TOTP MFA normally (see MfaSetup.jsx) — this function itself
 * never needs to be called again unless you want to change the
 * adjacentIntervals tolerance below.
 */
exports.enableTotpMfa = onCall(async (request) => {
  const caller = await getCallerProfile(request);
  requireRole(caller, ["superadmin"]);

  try {
    await admin.auth().projectConfigManager().updateProjectConfig({
      multiFactorConfig: {
        providerConfigs: [{
          state: "ENABLED",
          totpProviderConfig: {
            // How many 30-second time steps of drift to tolerate on
            // either side, to accommodate a phone's clock being slightly
            // off. 5 is Firebase's own suggested default.
            adjacentIntervals: 5,
          },
        }],
      },
    });
  } catch (e) {
    throw new HttpsError("internal", "Erreur lors de l'activation du TOTP: " + e.message);
  }

  return { message: "TOTP activé pour le projet. Les comptes Super Admin et Hospital Admin peuvent maintenant configurer la double authentification." };
});