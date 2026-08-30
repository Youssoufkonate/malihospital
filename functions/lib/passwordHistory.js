const bcrypt = require("bcryptjs");
const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getCallerProfile } = require("./helpers");

const HISTORY_LIMIT = 10;
const SALT_ROUNDS = 10;

/**
 * Checks a proposed new password against the caller's own last 10
 * password hashes. Called BEFORE the actual Firebase Auth password
 * change happens (see ChangePassword.jsx) — if this rejects, the client
 * never proceeds to updatePassword() at all.
 *
 * Why this can't just compare against what Firebase Auth itself stores:
 * Firebase's internal password hashing (scrypt, project-specific
 * parameters) isn't exposed for comparison purposes via any public API.
 * This maintains its OWN separate history of bcrypt hashes purely for
 * this reuse check — a parallel record, not a replacement for Firebase's
 * own authentication.
 *
 * The plaintext candidate password is sent here over HTTPS (encrypted
 * in transit, same as any login) and used only in-memory for the bcrypt
 * comparison — it is never written anywhere, logged, or returned.
 */
exports.checkPasswordNotReused = onCall(async (request) => {
  const caller = await getCallerProfile(request);
  const { newPassword } = request.data || {};
  if (!newPassword) {
    throw new HttpsError("invalid-argument", "Mot de passe manquant.");
  }

  const snap = await admin.firestore().collection("users").doc(caller.uid).get();
  const history = snap.exists ? (snap.data().passwordHistory || []) : [];

  for (const oldHash of history) {
    const matches = await bcrypt.compare(newPassword, oldHash);
    if (matches) {
      throw new HttpsError(
        "already-exists",
        `Ce mot de passe a déjà été utilisé récemment. Choisissez un mot de passe que vous n'avez pas utilisé parmi vos ${HISTORY_LIMIT} derniers.`
      );
    }
  }

  return { ok: true };
});

/**
 * Records a NEW password's hash into the caller's history, called only
 * AFTER updatePassword() has already succeeded client-side — this
 * function doesn't change the actual Firebase Auth password itself, it
 * only maintains the parallel history record used by the check above,
 * and stamps passwordLastChangedAt (which is what the 45-day reminder
 * system reads).
 */
exports.recordPasswordChange = onCall(async (request) => {
  const caller = await getCallerProfile(request);
  const { newPassword } = request.data || {};
  if (!newPassword) {
    throw new HttpsError("invalid-argument", "Mot de passe manquant.");
  }

  const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  const ref = admin.firestore().collection("users").doc(caller.uid);

  await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const history = snap.exists ? (snap.data().passwordHistory || []) : [];
    // Keep only the most recent HISTORY_LIMIT hashes — oldest drops off
    // the end as new ones are added.
    const updatedHistory = [newHash, ...history].slice(0, HISTORY_LIMIT);
    tx.set(ref, {
      passwordHistory: updatedHistory,
      passwordLastChangedAt: new Date().toISOString(),
    }, { merge: true });
  });

  return { message: "Mot de passe enregistré." };
});