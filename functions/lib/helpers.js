const admin = require("firebase-admin");
const { HttpsError } = require("firebase-functions/v2/https");

/**
 * Cloud Functions run with the Admin SDK, which bypasses Firestore Security
 * Rules completely. That means every function is responsible for doing its
 * OWN authorization check — nothing here is protected by firestore.rules.
 * This helper re-derives the same "who is this person" shape the rules'
 * myRole()/myHospital()/isActive() functions compute, from the caller's
 * verified Auth token (request.auth.uid), so every function can reuse it.
 */
async function getCallerProfile(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Vous devez être connecté.");
  }
  const uid = request.auth.uid;
  let snap;
  try {
    snap = await admin.firestore().collection("users").doc(uid).get();
  } catch (e) {
    // Functions v2 strips error details from the client by default and
    // would otherwise show only a generic "internal" error here — which
    // would hide the real cause (commonly: the function's service account
    // not yet having Firestore permissions on a freshly-deployed project;
    // this usually resolves itself within 10-15 minutes of first deploy).
    // Re-throwing as an HttpsError with the original message keeps that
    // detail visible client-side instead of only in Functions logs.
    throw new HttpsError("internal", "Erreur d'accès au profil utilisateur: " + e.message);
  }
  if (!snap.exists) {
    throw new HttpsError("permission-denied", "Profil utilisateur introuvable.");
  }
  const data = snap.data();
  if (data.disabled === true) {
    throw new HttpsError("permission-denied", "Votre compte a été désactivé.");
  }
  if (data.approved !== true) {
    throw new HttpsError("permission-denied", "Votre compte n'est pas encore approuvé.");
  }
  return { uid, ...data };
}

function requireRole(profile, roles) {
  if (!roles.includes(profile.role)) {
    throw new HttpsError("permission-denied", "Rôle insuffisant pour effectuer cette action.");
  }
}

// A super admin can act across any hospital; everyone else is confined to
// their own hospitalId, mirroring isHospitalAdminOf()/isStaffOf() in rules.
function requireHospitalMatch(profile, hospitalId) {
  if (profile.role === "superadmin") return;
  if (!hospitalId || profile.hospitalId !== hospitalId) {
    throw new HttpsError("permission-denied", "Cette action ne concerne pas votre hôpital.");
  }
}

// Writing the audit entry as part of the same server-side action (instead
// of a separate client call afterward, as the old direct-Firestore version
// did) means a client can no longer skip or fake its own audit trail.
async function writeAuditLog({ hospitalId, adminId, adminName, adminEmail, action, targetUserId, targetUserName, details }) {
  try {
    await admin.firestore().collection("adminLogs").add({
      hospitalId: hospitalId || null,
      adminId,
      adminName,
      adminEmail,
      action,
      targetUserId: targetUserId || null,
      targetUserName: targetUserName || null,
      details: details || {},
      timestamp: new Date().toISOString(),
      source: "cloud-function",
    });
  } catch (e) {
    // Never let a logging failure block the actual operation that already
    // succeeded — just record it server-side for later investigation.
    console.error("Failed to write audit log:", e);
  }
}

// Record-editing locks (see acquirePatientRecordLock in tickets.js) auto-
// expire after this long, so a doctor's crashed browser or forgotten tab
// can never leave a ticket permanently locked. 10 minutes is meant to
// comfortably cover a real diagnosis-entry session without leaving a stale
// lock sitting around for long if someone genuinely walks away.
const LOCK_TIMEOUT_MS = 10 * 60 * 1000;

// A lock is "active" (blocks other doctors) only if it's held by someone
// AND hasn't aged past the timeout above.
function isLockActive(ticket) {
  if (!ticket.lockedBy || !ticket.lockedAt) return false;
  const age = Date.now() - new Date(ticket.lockedAt).getTime();
  return age < LOCK_TIMEOUT_MS;
}

/**
 * A simple Firestore-backed rate limiter for expensive/sensitive Cloud
 * Functions (account creation, password/credential operations, bulk
 * imports). Not a substitute for infrastructure-level protection (Cloud
 * Armor, App Check) against a genuinely distributed attack — this is
 * deliberately lightweight, meant to stop one caller from hammering a
 * single sensitive endpoint, using a doc per (action, identity) pair with
 * a rolling window.
 *
 * @param {string} action - a short name for what's being limited, e.g. "createStaffAccount"
 * @param {string} identity - who's being limited, usually caller.uid
 * @param {number} maxCalls - how many calls are allowed within the window
 * @param {number} windowMs - the rolling window size in milliseconds
 */
async function checkRateLimit(action, identity, maxCalls, windowMs) {
  const key = `${action}_${identity}`;
  const ref = admin.firestore().collection("rateLimits").doc(key);
  const now = Date.now();

  await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : { calls: [] };
    // Keep only calls within the current rolling window.
    const recentCalls = (data.calls || []).filter((t) => now - t < windowMs);

    if (recentCalls.length >= maxCalls) {
      throw new HttpsError(
        "resource-exhausted",
        `Trop de tentatives pour cette action. Réessayez dans quelques minutes.`
      );
    }

    recentCalls.push(now);
    tx.set(ref, { calls: recentCalls, lastCallAt: new Date(now).toISOString() }, { merge: true });
  });
}

/**
 * Translates a Firebase Admin SDK auth error (from createUser/updateUser)
 * into a clean, French, non-technical message — the raw errors Firebase
 * throws (especially for password policy violations) come back as a
 * literal dump of server JSON, which means nothing to a hospital admin
 * who isn't a developer. Every account-creation function should route
 * its catch block through this rather than falling back to e.message.
 */
function translateAuthError(e) {
  if (e.code === "auth/email-already-exists") {
    return "Cet email est déjà utilisé par un autre compte.";
  }
  if (e.code === "auth/invalid-email") {
    return "L'adresse email n'est pas valide.";
  }
  if (e.code === "auth/invalid-password") {
    return "Le mot de passe doit contenir au moins 6 caractères.";
  }
  if (e.code === "auth/password-does-not-meet-requirements") {
    // Firebase's own message looks like:
    //   PASSWORD_DOES_NOT_MEET_REQUIREMENTS : Missing password requirements: [Password may contain at most 15 characters]
    // — technically accurate, completely unreadable to a non-developer.
    // Pull out the specific reason(s) and translate each one we recognize.
    const raw = e.message || "";
    const reasons = [];
    if (/at most (\d+) characters/i.test(raw)) {
      const max = raw.match(/at most (\d+) characters/i)[1];
      reasons.push(`ne pas dépasser ${max} caractères`);
    }
    if (/at least (\d+) characters/i.test(raw)) {
      const min = raw.match(/at least (\d+) characters/i)[1];
      reasons.push(`contenir au moins ${min} caractères`);
    }
    if (/upper case/i.test(raw)) reasons.push("contenir au moins une lettre majuscule");
    if (/lower case/i.test(raw)) reasons.push("contenir au moins une lettre minuscule");
    if (/numeric character/i.test(raw)) reasons.push("contenir au moins un chiffre");
    if (/non-alphanumeric/i.test(raw)) reasons.push("contenir au moins un caractère spécial (ex: !, @, #)");

    if (reasons.length > 0) {
      return `Le mot de passe doit ${reasons.join(", ")}.`;
    }
    return "Le mot de passe ne respecte pas les exigences de sécurité du système. Essayez un mot de passe différent.";
  }
  return "Une erreur est survenue lors de la création du compte. Réessayez, ou contactez le support technique si le problème persiste.";
}

module.exports = { getCallerProfile, requireRole, requireHospitalMatch, writeAuditLog, LOCK_TIMEOUT_MS, isLockActive, checkRateLimit, translateAuthError };