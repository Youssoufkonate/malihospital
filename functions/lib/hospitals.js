const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getCallerProfile, requireRole, writeAuditLog, checkRateLimit, translateAuthError } = require("./helpers");

/**
 * "Approve hospital" in this app's current model = creating the hospital
 * and its admin account, immediately active (there's no separate
 * pending-request workflow yet — that would be a bigger schema addition).
 * Replaces SuperAdmin.jsx's client-side flow, which needed the same
 * secondary-Firebase-app workaround createStaffAccount above eliminates.
 */
exports.createHospital = onCall(async (request) => {
  const caller = await getCallerProfile(request);
  requireRole(caller, ["superadmin"]);
  await checkRateLimit("createHospital", caller.uid, 10, 60 * 60 * 1000); // 10/hour

  const { hospitalName, hospitalAddress, adminFirstName, adminLastName, adminEmail, adminPassword, ticketPrice } = request.data || {};
  if (!hospitalName || !adminFirstName || !adminLastName || !adminEmail || !adminPassword) {
    throw new HttpsError("invalid-argument", "Champs obligatoires manquants.");
  }
  if (adminPassword.length < 6) {
    throw new HttpsError("invalid-argument", "Le mot de passe doit contenir au moins 6 caractères.");
  }
  const price = Number(ticketPrice);
  if (!Number.isFinite(price) || price < 0) {
    throw new HttpsError("invalid-argument", "Le prix du ticket doit être un nombre positif.");
  }

  const hospitalRef = await admin.firestore().collection("hospitals").add({
    name: hospitalName,
    address: hospitalAddress || "",
    active: true,
    departments: [],
    ticketPrice: price, // FCFA per ticket — used to compute total revenue on the admin dashboard
    createdAt: new Date().toISOString(),
    createdBy: caller.uid,
  });

  let userRecord;
  try {
    userRecord = await admin.auth().createUser({
      email: adminEmail,
      password: adminPassword,
      displayName: `${adminFirstName} ${adminLastName}`,
    });
  } catch (e) {
    await hospitalRef.delete().catch(() => {});
    if (e.code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "Cet email administrateur est déjà utilisé.");
    }
    throw new HttpsError("internal", translateAuthError(e));
  }

  try {
    await admin.firestore().collection("users").doc(userRecord.uid).set({
      firstName: adminFirstName,
      lastName: adminLastName,
      email: adminEmail,
      role: "hospitaladmin",
      hospitalId: hospitalRef.id,
      approved: true,
      disabled: false,
      createdAt: new Date().toISOString(),
      createdBy: caller.uid,
    });
  } catch (e) {
    await admin.auth().deleteUser(userRecord.uid).catch(() => {});
    await hospitalRef.delete().catch(() => {});
    throw new HttpsError("internal", "Erreur d'enregistrement du profil: " + e.message);
  }

  try {
    const link = await admin.auth().generatePasswordResetLink(adminEmail);
    console.log(`Password reset link for ${adminEmail}: ${link}`);
  } catch (e) {
    console.warn("Could not generate password reset link:", e.message);
  }

  await writeAuditLog({
    hospitalId: hospitalRef.id,
    adminId: caller.uid,
    adminName: `${caller.firstName} ${caller.lastName}`,
    adminEmail: caller.email,
    action: "create_hospital",
    targetUserId: userRecord.uid,
    targetUserName: hospitalName,
    details: { adminEmail },
  });
  await admin.firestore().collection("superAdminLogs").add({
    action: "create_hospital",
    hospitalId: hospitalRef.id,
    hospitalName,
    adminEmail,
    performedBy: caller.uid,
    timestamp: new Date().toISOString(),
  }).catch((e) => console.warn("Could not write super admin log:", e.message));

  return { hospitalId: hospitalRef.id, message: `Hôpital "${hospitalName}" créé.` };
});

/**
 * Adds an ADDITIONAL hospital admin to an EXISTING hospital — distinct
 * from createHospital above, which bundles hospital-creation with its
 * first admin in one atomic step. This is the "the hospital already
 * exists, I just need another/replacement admin for it" case, opened
 * from the hospital detail modal in SuperAdmin.jsx. Deliberately its own
 * function rather than reusing createStaffAccount: that function's
 * STAFF_ROLES list explicitly excludes "hospitaladmin" (a hospitaladmin
 * shouldn't be able to grant themselves a peer via that path), so this
 * one exists specifically for superadmin to manage that one tier.
 */
exports.addHospitalAdmin = onCall(async (request) => {
  const caller = await getCallerProfile(request);
  requireRole(caller, ["superadmin"]);
  await checkRateLimit("addHospitalAdmin", caller.uid, 10, 60 * 60 * 1000); // 10/hour

  const { hospitalId, firstName, lastName, email, password } = request.data || {};
  if (!hospitalId || !firstName || !lastName || !email || !password) {
    throw new HttpsError("invalid-argument", "Champs obligatoires manquants.");
  }
  if (password.length < 6) {
    throw new HttpsError("invalid-argument", "Le mot de passe doit contenir au moins 6 caractères.");
  }

  const hospSnap = await admin.firestore().collection("hospitals").doc(hospitalId).get();
  if (!hospSnap.exists) throw new HttpsError("not-found", "Hôpital introuvable.");

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
      firstName, lastName, email,
      role: "hospitaladmin",
      hospitalId,
      approved: true,
      disabled: false,
      createdAt: new Date().toISOString(),
      createdBy: caller.uid,
    });
  } catch (e) {
    await admin.auth().deleteUser(userRecord.uid).catch(() => {});
    throw new HttpsError("internal", "Erreur d'enregistrement du profil: " + e.message);
  }

  await writeAuditLog({
    hospitalId,
    adminId: caller.uid,
    adminName: `${caller.firstName} ${caller.lastName}`,
    adminEmail: caller.email,
    action: "create",
    targetUserId: userRecord.uid,
    targetUserName: `${firstName} ${lastName}`,
    details: { role: "hospitaladmin", email },
  });

  return { message: `Administrateur "${firstName} ${lastName}" créé.` };
});

/**
 * Deletes a hospitaladmin account specifically — the hospitaladmin-tier
 * equivalent of deleteStaffAccount, which explicitly refuses to touch
 * this role (same reasoning as addHospitalAdmin above: a hospitaladmin
 * shouldn't be able to delete a peer via the staff-management path, so
 * this stays superadmin-only and its own function).
 */
exports.deleteHospitalAdmin = onCall(async (request) => {
  const caller = await getCallerProfile(request);
  requireRole(caller, ["superadmin"]);

  const { userId } = request.data || {};
  if (!userId) throw new HttpsError("invalid-argument", "userId manquant.");

  const targetSnap = await admin.firestore().collection("users").doc(userId).get();
  if (!targetSnap.exists) throw new HttpsError("not-found", "Utilisateur introuvable.");
  const target = targetSnap.data();

  if (target.role !== "hospitaladmin") {
    throw new HttpsError("permission-denied", "Ce compte n'est pas un administrateur d'hôpital.");
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
    details: { role: "hospitaladmin" },
  });

  return { message: `Administrateur "${target.firstName} ${target.lastName}" supprimé.` };
});

/**
 * Activating/deactivating now also locks/unlocks every staff member's
 * actual Auth login, not just the app-level "is my hospital active" check
 * that ran after sign-in — a deactivated hospital's staff genuinely can't
 * authenticate at all now, instead of just being redirected post-login.
 */
exports.setHospitalActive = onCall(async (request) => {
  const caller = await getCallerProfile(request);
  requireRole(caller, ["superadmin"]);

  const { hospitalId, active } = request.data || {};
  if (!hospitalId || typeof active !== "boolean") {
    throw new HttpsError("invalid-argument", "Paramètres invalides.");
  }

  const db = admin.firestore();
  await db.collection("hospitals").doc(hospitalId).update({ active });

  const staffSnap = await db.collection("users").where("hospitalId", "==", hospitalId).get();
  await Promise.all(staffSnap.docs.map((d) => {
    // When reactivating, only lift the Auth lock for staff who aren't
    // individually disabled for some other reason.
    const shouldBeAuthDisabled = !active || d.data().disabled === true;
    return admin.auth().updateUser(d.id, { disabled: shouldBeAuthDisabled }).catch(() => {});
  }));

  await db.collection("superAdminLogs").add({
    action: active ? "activate_hospital" : "deactivate_hospital",
    hospitalId,
    performedBy: caller.uid,
    timestamp: new Date().toISOString(),
  }).catch(() => {});

  return { message: active ? "Hôpital réactivé." : "Hôpital désactivé." };
});

/**
 * Cascading delete, done as batched Firestore writes (500-op cap per batch)
 * plus actual Auth account deletion for every affected user — something
 * the old client-side Promise.all version could never do (no Auth access,
 * and no atomicity guarantee if one of the deletes failed partway through).
 */
exports.deleteHospital = onCall(async (request) => {
  const caller = await getCallerProfile(request);
  requireRole(caller, ["superadmin"]);

  const { hospitalId, confirmName } = request.data || {};
  if (!hospitalId) throw new HttpsError("invalid-argument", "hospitalId manquant.");

  const db = admin.firestore();
  const hospSnap = await db.collection("hospitals").doc(hospitalId).get();
  if (!hospSnap.exists) throw new HttpsError("not-found", "Hôpital introuvable.");
  const hospital = hospSnap.data();

  if (confirmName !== hospital.name) {
    throw new HttpsError("failed-precondition", "Le nom saisi ne correspond pas au nom de l'hôpital.");
  }

  const [usersSnap, ticketsSnap, callsSnap] = await Promise.all([
    db.collection("users").where("hospitalId", "==", hospitalId).get(),
    db.collection("tickets").where("hospitalId", "==", hospitalId).get(),
    db.collection("calls").where("hospitalId", "==", hospitalId).get(),
  ]);

  const allDocs = [...usersSnap.docs, ...ticketsSnap.docs, ...callsSnap.docs];
  for (let i = 0; i < allDocs.length; i += 450) {
    const batch = db.batch();
    allDocs.slice(i, i + 450).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  await db.collection("hospitals").doc(hospitalId).delete();

  await Promise.all(usersSnap.docs.map((d) => admin.auth().deleteUser(d.id).catch(() => {})));

  await db.collection("superAdminLogs").add({
    action: "delete_hospital",
    hospitalId,
    hospitalName: hospital.name,
    deletedUsers: usersSnap.size,
    deletedTickets: ticketsSnap.size,
    deletedCalls: callsSnap.size,
    performedBy: caller.uid,
    timestamp: new Date().toISOString(),
  }).catch(() => {});

  return { message: `Hôpital "${hospital.name}" supprimé (${usersSnap.size} compte(s), y compris leurs connexions).` };
});