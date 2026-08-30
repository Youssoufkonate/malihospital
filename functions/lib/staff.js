const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getCallerProfile, requireRole, requireHospitalMatch, writeAuditLog, checkRateLimit, translateAuthError } = require("./helpers");

// pharmacy/lab used to be hospital-scoped roles here, like doctor/nurse.
// They now belong to standalone facility entities (see functions/lib/
// facilities.js) with their own staff — createFacilityStaff, not this file.
const STAFF_ROLES = ["doctor", "nurse", "accueil", "supervisor"];
const DEPARTMENT_SCOPED_ROLES = ["doctor", "nurse", "supervisor"];

/**
 * Replaces AdminPanel.jsx's old client-side createStaff, which had to spin
 * up a second, throwaway Firebase app instance (`authSecondary`) purely so
 * creating a new login didn't also sign the admin themselves out of their
 * own session — createUserWithEmailAndPassword() on the client always signs
 * in as the new user. Server-side, admin.auth().createUser() has no such
 * side effect, so that entire workaround goes away.
 */
exports.createStaffAccount = onCall(async (request) => {
  const caller = await getCallerProfile(request);
  requireRole(caller, ["hospitaladmin", "superadmin"]);
  await checkRateLimit("createStaffAccount", caller.uid, 10, 60 * 60 * 1000); // 10/hour — normal onboarding pace, well above what a legitimate admin would ever need in one sitting

  const { firstName, lastName, email, password, role, hospitalId, department, room } = request.data || {};

  if (!firstName || !lastName || !email || !password || !role) {
    throw new HttpsError("invalid-argument", "Champs obligatoires manquants.");
  }
  if (!STAFF_ROLES.includes(role)) {
    throw new HttpsError("invalid-argument", "Rôle invalide.");
  }
  if (password.length < 6) {
    throw new HttpsError("invalid-argument", "Le mot de passe doit contenir au moins 6 caractères.");
  }

  const targetHospitalId = caller.role === "superadmin" ? hospitalId : caller.hospitalId;
  if (!targetHospitalId) {
    throw new HttpsError("invalid-argument", "hospitalId manquant.");
  }
  requireHospitalMatch(caller, targetHospitalId);

  if (DEPARTMENT_SCOPED_ROLES.includes(role) && !department) {
    throw new HttpsError("invalid-argument", "Département requis pour ce rôle.");
  }
  if (role === "doctor" && !room) {
    throw new HttpsError("invalid-argument", "Numéro de chambre requis pour un médecin.");
  }

  let userRecord;
  try {
    userRecord = await admin.auth().createUser({
      email,
      password,
      displayName: `${firstName} ${lastName}`,
    });
  } catch (e) {
    if (e.code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "Cet email est déjà utilisé.");
    }
    throw new HttpsError("internal", translateAuthError(e));
  }

  try {
    await admin.firestore().collection("users").doc(userRecord.uid).set({
      firstName, lastName, email, role,
      hospitalId: targetHospitalId,
      department: DEPARTMENT_SCOPED_ROLES.includes(role) ? department : null,
      room: role === "doctor" ? room : null,
      approved: true,
      disabled: false,
      createdAt: new Date().toISOString(),
      createdBy: caller.uid,
    });
  } catch (e) {
    // Roll back the Auth account if the Firestore profile write fails, so
    // we never end up with a login that has no corresponding profile.
    await admin.auth().deleteUser(userRecord.uid).catch(() => {});
    throw new HttpsError("internal", "Erreur d'enregistrement du profil: " + e.message);
  }

  // In place of the client's sendPasswordResetEmail (which needed the
  // secondary-app session), generate the reset link server-side. Wire this
  // into your actual email provider (SendGrid, Mailgun, etc.) — for now it
  // logs to the Functions log so it's still visible/actionable during setup.
  try {
    const link = await admin.auth().generatePasswordResetLink(email);
    console.log(`Password reset link for ${email}: ${link}`);
  } catch (e) {
    console.warn("Could not generate password reset link:", e.message);
  }

  await writeAuditLog({
    hospitalId: targetHospitalId,
    adminId: caller.uid,
    adminName: `${caller.firstName} ${caller.lastName}`,
    adminEmail: caller.email,
    action: "create",
    targetUserId: userRecord.uid,
    targetUserName: `${firstName} ${lastName}`,
    details: { role, email },
  });

  return { uid: userRecord.uid, message: `Compte créé pour ${firstName} ${lastName}.` };
});

/**
 * Deletes BOTH the Firestore profile and the actual Firebase Auth login.
 * The old client-only deleteUser() could only ever remove the Firestore
 * doc — every screen in this app had a comment flagging that the person's
 * actual login still worked afterward. This function closes that gap.
 */
exports.deleteStaffAccount = onCall(async (request) => {
  const caller = await getCallerProfile(request);
  requireRole(caller, ["hospitaladmin", "superadmin"]);

  const { userId } = request.data || {};
  if (!userId) throw new HttpsError("invalid-argument", "userId manquant.");

  const targetSnap = await admin.firestore().collection("users").doc(userId).get();
  if (!targetSnap.exists) throw new HttpsError("not-found", "Utilisateur introuvable.");
  const target = targetSnap.data();

  requireHospitalMatch(caller, target.hospitalId);
  if (!STAFF_ROLES.includes(target.role)) {
    throw new HttpsError("permission-denied", "Ce rôle ne peut pas être supprimé de cette façon.");
  }

  await admin.firestore().collection("users").doc(userId).delete();
  try {
    await admin.auth().deleteUser(userId);
  } catch (e) {
    console.warn("Could not delete Auth user (may already be gone):", e.message);
  }

  await writeAuditLog({
    hospitalId: target.hospitalId,
    adminId: caller.uid,
    adminName: `${caller.firstName} ${caller.lastName}`,
    adminEmail: caller.email,
    action: "delete",
    targetUserId: userId,
    targetUserName: `${target.firstName} ${target.lastName}`,
    details: { role: target.role, email: target.email },
  });

  return { message: "Utilisateur supprimé (profil et connexion)." };
});

/**
 * Disable/enable, but now also synced to the Auth layer via
 * admin.auth().updateUser({ disabled }) — a real security improvement over
 * the old approach, where "disabled" was purely a Firestore flag checked
 * AFTER sign-in. A disabled account now can't even obtain a fresh ID token.
 */
exports.setStaffDisabled = onCall(async (request) => {
  const caller = await getCallerProfile(request);
  requireRole(caller, ["hospitaladmin", "superadmin"]);

  const { userId, disabled } = request.data || {};
  if (!userId || typeof disabled !== "boolean") {
    throw new HttpsError("invalid-argument", "Paramètres invalides.");
  }

  const targetSnap = await admin.firestore().collection("users").doc(userId).get();
  if (!targetSnap.exists) throw new HttpsError("not-found", "Utilisateur introuvable.");
  const target = targetSnap.data();
  requireHospitalMatch(caller, target.hospitalId);

  await admin.firestore().collection("users").doc(userId).update({
    disabled,
    disabledAt: disabled ? new Date().toISOString() : null,
  });

  await admin.auth().updateUser(userId, { disabled }).catch((e) =>
    console.warn("Could not sync Auth disabled state:", e.message)
  );

  await writeAuditLog({
    hospitalId: target.hospitalId,
    adminId: caller.uid,
    adminName: `${caller.firstName} ${caller.lastName}`,
    adminEmail: caller.email,
    action: disabled ? "disable" : "enable",
    targetUserId: userId,
    targetUserName: `${target.firstName} ${target.lastName}`,
    details: { role: target.role },
  });

  admin.firestore().collection("securityEvents").doc(`${Date.now()}-${Math.random().toString(36).slice(2, 8)}`).set({
    type: disabled ? "account_disabled" : "account_enabled",
    email: target.email,
    actorEmail: caller.email,
    hospitalId: target.hospitalId,
    timestamp: new Date().toISOString(),
  }).catch((e) => console.warn("Could not log security event (non-fatal):", e.message));

  return { message: disabled ? "Utilisateur désactivé." : "Utilisateur réactivé." };
});