const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

const MAX_ATTEMPTS = 2;
const LOCKOUT_MS = 2 * 60 * 60 * 1000; // 2 hours

// These three run BEFORE a user is authenticated (that's the whole
// point — the lock has to exist independently of any login session), so
// unlike almost every other function in this app, they're intentionally
// NOT gated by getCallerProfile/requireRole. Trade-off worth knowing:
// because anyone can call recordFailedLogin for any email without first
// proving they actually attempted that account's real password, this
// could in principle be used to lock a specific person out by repeatedly
// calling it against their address. That's a known, generally-accepted
// trade-off of email-keyed lockout systems (most real-world ones work
// exactly this way) rather than a bug — flagging it here rather than
// quietly hoping nobody asks.
function emailKey(email) {
  return (email || "").trim().toLowerCase();
}

exports.checkLoginLock = onCall(async (request) => {
  const key = emailKey(request.data?.email);
  if (!key) throw new HttpsError("invalid-argument", "Email manquant.");

  const snap = await admin.firestore().collection("loginAttempts").doc(key).get();
  if (!snap.exists) return { locked: false, lockedUntil: null, attempts: 0 };

  const data = snap.data();
  const lockedUntil = data.lockedUntil ? new Date(data.lockedUntil) : null;
  const isLocked = lockedUntil && lockedUntil.getTime() > Date.now();
  return {
    locked: !!isLocked,
    lockedUntil: isLocked ? data.lockedUntil : null,
    attempts: isLocked ? data.failedCount : (data.failedCount || 0),
  };
});

exports.recordFailedLogin = onCall(async (request) => {
  const key = emailKey(request.data?.email);
  if (!key) throw new HttpsError("invalid-argument", "Email manquant.");

  const ref = admin.firestore().collection("loginAttempts").doc(key);
  const result = await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    const existing = snap.exists ? snap.data() : {};

    // A lock that already expired resets the counter — this is a fresh
    // run of attempts, not a continuation of the old one.
    const previouslyLocked = existing.lockedUntil && new Date(existing.lockedUntil).getTime() > now;
    const baseCount = previouslyLocked ? existing.failedCount : (existing.lockedUntil ? 0 : (existing.failedCount || 0));

    const newCount = baseCount + 1;
    const shouldLock = newCount >= MAX_ATTEMPTS;
    const lockedUntil = shouldLock ? new Date(now + LOCKOUT_MS).toISOString() : null;

    tx.set(ref, {
      failedCount: newCount,
      lockedUntil,
      lastAttemptAt: new Date(now).toISOString(),
    }, { merge: true });

    return { locked: shouldLock, lockedUntil, attempts: newCount };
  });

  // Logged here (Admin SDK, server-side) rather than by the client,
  // because at this point in the flow the user isn't authenticated yet —
  // there's no request.auth for a client-side securityEvents write to
  // attach to, so this has to be the one writing it.
  const db = admin.firestore();
  db.collection("securityEvents").doc(`${Date.now()}-${Math.random().toString(36).slice(2, 8)}`).set({
    type: result.locked ? "account_locked" : "failed_login",
    email: key,
    timestamp: new Date().toISOString(),
  }).catch((e) => console.warn("Could not log security event (non-fatal):", e.message));

  return result;
});

exports.clearLoginAttempts = onCall(async (request) => {
  const key = emailKey(request.data?.email);
  if (!key) throw new HttpsError("invalid-argument", "Email manquant.");

  await admin.firestore().collection("loginAttempts").doc(key).set({
    failedCount: 0,
    lockedUntil: null,
    lastAttemptAt: new Date().toISOString(),
  }, { merge: true });

  return { message: "OK" };
});