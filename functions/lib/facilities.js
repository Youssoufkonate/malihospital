const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getCallerProfile, requireRole, writeAuditLog, checkRateLimit, translateAuthError } = require("./helpers");

const FACILITY_TYPES = ["pharmacy", "lab"];
const FACILITY_COLLECTIONS = { pharmacy: "pharmacies", lab: "labs" };

function validateFacilityType(facilityType) {
  if (!FACILITY_TYPES.includes(facilityType)) {
    throw new HttpsError("invalid-argument", "Type d'établissement invalide.");
  }
  return FACILITY_COLLECTIONS[facilityType];
}

// A hospital admin may only act on a facility THEY created (their own
// in-house pharmacy/lab); a facility admin may only act on THEIR OWN
// facility. Super admin can act on any. facilityId is passed explicitly
// since a facility document doesn't store its own ID as a field.
async function requireFacilityOwnership(caller, facility, facilityId) {
  if (caller.role === "superadmin") return;
  if (caller.role === "hospitaladmin" && facility.hospitalId === caller.hospitalId) return;
  if (caller.role === "facilityadmin" && caller.facilityId === facilityId) return;
  throw new HttpsError("permission-denied", "Vous ne gérez pas cet établissement.");
}

/**
 * Creates a pharmacy or lab, AND its own dedicated Facility Admin account
 * in the same operation — mirrors createHospital exactly. That admin then
 * manages their facility's staff and schedule independently, the same way
 * a hospital admin manages their hospital. Per your decision, EVERY
 * facility is publicly routable — any doctor at any hospital can send a
 * prescription/lab request there if it matches the patient's location —
 * regardless of whether it was created by a super admin (fully
 * independent) or a hospital admin (their own in-house pharmacy/lab).
 * hospitalId is kept only as ownership metadata (who manages its staff /
 * can deactivate it), not as an access restriction.
 */
exports.createFacility = onCall(async (request) => {
  const caller = await getCallerProfile(request);
  requireRole(caller, ["superadmin", "hospitaladmin"]);
  await checkRateLimit("createFacility", caller.uid, 10, 60 * 60 * 1000); // 10/hour

  const {
    facilityType, name, address, ville, commune, quartier, phone, hospitalId,
    adminFirstName, adminLastName, adminEmail, adminPassword,
  } = request.data || {};
  const collectionName = validateFacilityType(facilityType);

  if (!name || !name.trim()) {
    throw new HttpsError("invalid-argument", "Le nom est obligatoire.");
  }
  if (!ville) {
    throw new HttpsError("invalid-argument", "La ville est obligatoire pour le filtrage par localisation.");
  }
  if (!adminFirstName || !adminLastName || !adminEmail || !adminPassword) {
    throw new HttpsError("invalid-argument", "Les informations de l'administrateur de l'établissement sont obligatoires.");
  }
  if (adminPassword.length < 6) {
    throw new HttpsError("invalid-argument", "Le mot de passe doit contenir au moins 6 caractères.");
  }

  // A hospital admin can only ever create an in-house facility tied to
  // their OWN hospital — they can't claim to create one for another
  // hospital, or an independent one. A super admin can do either: pass a
  // hospitalId to tie it to a specific hospital, or omit it for a fully
  // independent facility.
  const ownerHospitalId = caller.role === "hospitaladmin" ? caller.hospitalId : (hospitalId || null);

  const ref = await admin.firestore().collection(collectionName).add({
    name: name.trim(),
    address: address || "",
    ville,
    commune: commune || "",
    quartier: quartier || "",
    phone: phone || "",
    hospitalId: ownerHospitalId,
    active: true,
    claimed: true, // has a real admin account from the moment it's created — see bulkImportPharmacies/claimFacility for the unclaimed path
    createdAt: new Date().toISOString(),
    createdBy: caller.uid,
    createdByName: `${caller.firstName} ${caller.lastName}`,
  });

  let adminRecord;
  try {
    adminRecord = await admin.auth().createUser({
      email: adminEmail, password: adminPassword, displayName: `${adminFirstName} ${adminLastName}`,
    });
  } catch (e) {
    await ref.delete().catch(() => {});
    if (e.code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "Cet email administrateur est déjà utilisé.");
    }
    throw new HttpsError("internal", translateAuthError(e));
  }

  try {
    await admin.firestore().collection("users").doc(adminRecord.uid).set({
      firstName: adminFirstName, lastName: adminLastName, email: adminEmail,
      role: "facilityadmin",
      facilityType, facilityId: ref.id, facilityName: name.trim(),
      approved: true, disabled: false,
      createdAt: new Date().toISOString(), createdBy: caller.uid,
    });
  } catch (e) {
    await admin.auth().deleteUser(adminRecord.uid).catch(() => {});
    await ref.delete().catch(() => {});
    throw new HttpsError("internal", "Erreur d'enregistrement du profil administrateur: " + e.message);
  }

  try {
    const link = await admin.auth().generatePasswordResetLink(adminEmail);
    console.log(`Password reset link for ${adminEmail}: ${link}`);
  } catch (e) {
    console.warn("Could not generate password reset link:", e.message);
  }

  await writeAuditLog({
    hospitalId: ownerHospitalId,
    adminId: caller.uid,
    adminName: `${caller.firstName} ${caller.lastName}`,
    adminEmail: caller.email,
    action: `create_${facilityType}`,
    targetUserId: ref.id,
    targetUserName: name.trim(),
    details: { ville, commune, quartier, facilityAdminEmail: adminEmail },
  });

  return { id: ref.id, adminUid: adminRecord.uid, message: `${facilityType === "pharmacy" ? "Pharmacie" : "Laboratoire"} créé(e) avec son administrateur.` };
});

exports.setFacilityActive = onCall(async (request) => {
  const caller = await getCallerProfile(request);
  requireRole(caller, ["superadmin", "hospitaladmin"]);

  const { facilityType, facilityId, active } = request.data || {};
  const collectionName = validateFacilityType(facilityType);
  if (!facilityId || typeof active !== "boolean") {
    throw new HttpsError("invalid-argument", "Paramètres invalides.");
  }

  const ref = admin.firestore().collection(collectionName).doc(facilityId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Établissement introuvable.");
  await requireFacilityOwnership(caller, snap.data(), facilityId);

  await ref.update({ active });

  // Deactivating also locks out its staff's actual logins, same pattern
  // used for deactivating a hospital.
  const staffSnap = await admin.firestore().collection("users")
    .where("facilityType", "==", facilityType).where("facilityId", "==", facilityId).get();
  await Promise.all(staffSnap.docs.map((d) => {
    const shouldBeAuthDisabled = !active || d.data().disabled === true;
    return admin.auth().updateUser(d.id, { disabled: shouldBeAuthDisabled }).catch(() => {});
  }));

  return { message: active ? "Établissement réactivé." : "Établissement désactivé." };
});

/**
 * The "all at once" counterpart to setFacilityActive — built for exactly
 * this situation: you're piloting the platform with a batch of imported
 * pharmacies, and if the response is lukewarm, you want to switch every
 * one of them off in a single action rather than clicking through
 * hundreds individually. Same staff-login-locking behavior as the
 * single-facility version, just applied across the whole set. Super
 * Admin only — this is a platform-wide action, not something a hospital
 * admin should be able to trigger even for facilities they own.
 */
exports.bulkSetFacilitiesActive = onCall(async (request) => {
  const caller = await getCallerProfile(request);
  requireRole(caller, ["superadmin"]);

  const { facilityType, active, facilityIds } = request.data || {};
  const collectionName = validateFacilityType(facilityType);
  if (typeof active !== "boolean") {
    throw new HttpsError("invalid-argument", "Paramètres invalides.");
  }

  const db = admin.firestore();

  // facilityIds omitted/null = every facility of this type. Provided =
  // just that specific subset (kept flexible for a future "select some"
  // UI, even though today's UI only ever sends "all").
  let targetIds;
  if (Array.isArray(facilityIds) && facilityIds.length > 0) {
    targetIds = facilityIds;
  } else {
    const allSnap = await db.collection(collectionName).get();
    targetIds = allSnap.docs.map((d) => d.id);
  }
  if (targetIds.length === 0) {
    return { updated: 0, message: "Aucun établissement à mettre à jour." };
  }

  // Firestore batches cap at 500 writes; chunk generously under that.
  const chunks = [];
  for (let i = 0; i < targetIds.length; i += 400) chunks.push(targetIds.slice(i, i + 400));
  for (const chunk of chunks) {
    const batch = db.batch();
    chunk.forEach((id) => batch.update(db.collection(collectionName).doc(id), { active }));
    await batch.commit();
  }

  // Lock/unlock every staff login across all affected facilities. Most
  // bulk-imported facilities have no staff yet (unclaimed), so this is
  // typically a small, fast pass in practice even at hundreds of
  // facilities — but chunked all the same in case that's not always true.
  const usersRef = db.collection("users");
  let disabledCount = 0;
  for (let i = 0; i < targetIds.length; i += 30) {
    // Firestore 'in' queries cap at 30 values per query.
    const idBatch = targetIds.slice(i, i + 30);
    const staffSnap = await usersRef
      .where("facilityType", "==", facilityType)
      .where("facilityId", "in", idBatch)
      .get();
    await Promise.all(staffSnap.docs.map((d) => {
      const shouldBeAuthDisabled = !active || d.data().disabled === true;
      disabledCount++;
      return admin.auth().updateUser(d.id, { disabled: shouldBeAuthDisabled }).catch(() => {});
    }));
  }

  return {
    updated: targetIds.length,
    message: `${targetIds.length} établissement(s) ${active ? "réactivé(s)" : "désactivé(s)"}${disabledCount > 0 ? ` (${disabledCount} compte(s) de personnel synchronisé(s))` : ""}.`,
  };
});

exports.deleteFacility = onCall(async (request) => {
  const caller = await getCallerProfile(request);
  requireRole(caller, ["superadmin", "hospitaladmin"]);

  const { facilityType, facilityId, confirmName } = request.data || {};
  const collectionName = validateFacilityType(facilityType);
  if (!facilityId) throw new HttpsError("invalid-argument", "facilityId manquant.");

  const db = admin.firestore();
  const ref = db.collection(collectionName).doc(facilityId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Établissement introuvable.");
  const facility = snap.data();
  await requireFacilityOwnership(caller, facility, facilityId);

  if (confirmName !== facility.name) {
    throw new HttpsError("failed-precondition", "Le nom saisi ne correspond pas.");
  }

  const staffSnap = await db.collection("users")
    .where("facilityType", "==", facilityType).where("facilityId", "==", facilityId).get();

  const batch = db.batch();
  staffSnap.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(ref);
  await batch.commit();

  await Promise.all(staffSnap.docs.map((d) => admin.auth().deleteUser(d.id).catch(() => {})));

  return { message: `${facility.name} supprimé(e) (${staffSnap.size} compte(s) de personnel, y compris leurs connexions).` };
});

/**
 * Facility staff (pharmacy/lab employees) — mirrors createStaffAccount's
 * pattern but scoped to a facilityId instead of a hospitalId, since a
 * facility isn't necessarily attached to any one hospital.
 */
exports.createFacilityStaff = onCall(async (request) => {
  const caller = await getCallerProfile(request);
  requireRole(caller, ["superadmin", "hospitaladmin", "facilityadmin"]);

  const { facilityType, facilityId, firstName, lastName, email, password } = request.data || {};
  const collectionName = validateFacilityType(facilityType);

  if (!facilityId || !firstName || !lastName || !email || !password) {
    throw new HttpsError("invalid-argument", "Champs obligatoires manquants.");
  }
  if (password.length < 6) {
    throw new HttpsError("invalid-argument", "Le mot de passe doit contenir au moins 6 caractères.");
  }

  const facilitySnap = await admin.firestore().collection(collectionName).doc(facilityId).get();
  if (!facilitySnap.exists) throw new HttpsError("not-found", "Établissement introuvable.");
  await requireFacilityOwnership(caller, facilitySnap.data(), facilityId);

  let userRecord;
  try {
    userRecord = await admin.auth().createUser({ email, password, displayName: `${firstName} ${lastName}` });
  } catch (e) {
    if (e.code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "Cet email est déjà utilisé.");
    }
    throw new HttpsError("internal", translateAuthError(e));
  }

  try {
    await admin.firestore().collection("users").doc(userRecord.uid).set({
      firstName, lastName, email,
      role: facilityType, // "pharmacy" or "lab" — matches existing Login.jsx/ProtectedRoute routing
      facilityType, facilityId,
      facilityName: facilitySnap.data().name,
      approved: true, disabled: false,
      createdAt: new Date().toISOString(),
      createdBy: caller.uid,
    });
  } catch (e) {
    await admin.auth().deleteUser(userRecord.uid).catch(() => {});
    throw new HttpsError("internal", "Erreur d'enregistrement du profil: " + e.message);
  }

  try {
    const link = await admin.auth().generatePasswordResetLink(email);
    console.log(`Password reset link for ${email}: ${link}`);
  } catch (e) {
    console.warn("Could not generate password reset link:", e.message);
  }

  return { uid: userRecord.uid, message: `Compte créé pour ${firstName} ${lastName}.` };
});

exports.deleteFacilityStaff = onCall(async (request) => {
  const caller = await getCallerProfile(request);
  requireRole(caller, ["superadmin", "hospitaladmin", "facilityadmin"]);

  const { userId } = request.data || {};
  if (!userId) throw new HttpsError("invalid-argument", "userId manquant.");

  const targetSnap = await admin.firestore().collection("users").doc(userId).get();
  if (!targetSnap.exists) throw new HttpsError("not-found", "Utilisateur introuvable.");
  const target = targetSnap.data();
  if (!target.facilityType || !target.facilityId) {
    throw new HttpsError("failed-precondition", "Cet utilisateur n'est pas un membre du personnel d'un établissement.");
  }

  const collectionName = FACILITY_COLLECTIONS[target.facilityType];
  const facilitySnap = await admin.firestore().collection(collectionName).doc(target.facilityId).get();
  if (facilitySnap.exists) await requireFacilityOwnership(caller, facilitySnap.data(), target.facilityId);

  await admin.firestore().collection("users").doc(userId).delete();
  await admin.auth().deleteUser(userId).catch(() => {});

  return { message: "Utilisateur supprimé (profil et connexion)." };
});

exports.setFacilityStaffDisabled = onCall(async (request) => {
  const caller = await getCallerProfile(request);
  requireRole(caller, ["superadmin", "hospitaladmin", "facilityadmin"]);

  const { userId, disabled } = request.data || {};
  if (!userId || typeof disabled !== "boolean") {
    throw new HttpsError("invalid-argument", "Paramètres invalides.");
  }

  const targetSnap = await admin.firestore().collection("users").doc(userId).get();
  if (!targetSnap.exists) throw new HttpsError("not-found", "Utilisateur introuvable.");
  const target = targetSnap.data();
  if (!target.facilityType || !target.facilityId) {
    throw new HttpsError("failed-precondition", "Cet utilisateur n'est pas un membre du personnel d'un établissement.");
  }

  const collectionName = FACILITY_COLLECTIONS[target.facilityType];
  const facilitySnap = await admin.firestore().collection(collectionName).doc(target.facilityId).get();
  if (facilitySnap.exists) await requireFacilityOwnership(caller, facilitySnap.data(), target.facilityId);

  await admin.firestore().collection("users").doc(userId).update({
    disabled,
    disabledAt: disabled ? new Date().toISOString() : null,
  });
  await admin.auth().updateUser(userId, { disabled }).catch(() => {});

  admin.firestore().collection("securityEvents").doc(`${Date.now()}-${Math.random().toString(36).slice(2, 8)}`).set({
    type: disabled ? "account_disabled" : "account_enabled",
    email: target.email,
    actorEmail: caller.email,
    timestamp: new Date().toISOString(),
  }).catch((e) => console.warn("Could not log security event (non-fatal):", e.message));

  return { message: disabled ? "Utilisateur désactivé." : "Utilisateur réactivé." };
});

/**
 * Bulk-imports pharmacies (or labs, though pharmacies is the driving use
 * case) from a real, authoritative external list — e.g. a national
 * pharmacy registry — as UNCLAIMED listings: real location data (name,
 * address, region), but no admin account, since there's no way to invent
 * working credentials for hundreds of businesses that haven't actually
 * signed up. They're still fully routable (per your decision — a doctor
 * can send a prescription there for accurate geographic coverage), just
 * flagged claimed:false so Super Admin can track which ones still need a
 * real admin account attached once that pharmacy actually onboards (see
 * claimFacility below). Super Admin only — this is bulk-creating
 * location data, not something a hospital admin should be able to do at
 * scale.
 */
exports.bulkImportPharmacies = onCall(async (request) => {
  const caller = await getCallerProfile(request);
  requireRole(caller, ["superadmin"]);

  const { facilityType, rows } = request.data || {};
  const collectionName = validateFacilityType(facilityType);
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new HttpsError("invalid-argument", "Aucune ligne à importer.");
  }
  if (rows.length > 500) {
    throw new HttpsError("invalid-argument", "Maximum 500 lignes par import — divisez en plusieurs lots.");
  }

  const db = admin.firestore();
  let imported = 0;
  const skipped = [];
  // Batches are capped at 500 writes by Firestore itself; chunking at 400
  // here leaves headroom and keeps each commit comfortably under that.
  const chunks = [];
  for (let i = 0; i < rows.length; i += 400) chunks.push(rows.slice(i, i + 400));

  for (const chunk of chunks) {
    const batch = db.batch();
    for (const row of chunk) {
      const name = (row.name || "").trim();
      const ville = (row.ville || "").trim();
      if (!name || !ville) { skipped.push(row); continue; }
      const ref = db.collection(collectionName).doc();
      const address = (row.address || "").trim();
      batch.set(ref, {
        name,
        address,
        ville,
        commune: (row.commune || "").trim(),
        // The seed/paste format doesn't have a separate quartier column —
        // address IS the quartier-equivalent for these entries (e.g.
        // "Wayerma"), so it's stored in both fields rather than leaving
        // quartier blank.
        quartier: (row.quartier || address).trim(),
        phone: (row.phone || "").trim(),
        responsiblePerson: (row.responsiblePerson || "").trim(),
        hospitalId: null,
        active: true,
        claimed: false,
        createdAt: new Date().toISOString(),
        createdBy: caller.uid,
        createdByName: `${caller.firstName} ${caller.lastName}`,
        importedInBulk: true,
      });
      imported++;
    }
    await batch.commit();
  }

  return { imported, skipped: skipped.length, message: `${imported} établissement(s) importé(s)${skipped.length > 0 ? `, ${skipped.length} ligne(s) ignorée(s) (nom ou ville manquant)` : ""}.` };
});

/**
 * Attaches a real admin account to an EXISTING unclaimed facility (one
 * created via bulkImportPharmacies) — the missing half of what
 * createFacility does atomically for a freshly-created one. Super Admin
 * only, same reasoning as facility creation itself.
 */
exports.claimFacility = onCall(async (request) => {
  const caller = await getCallerProfile(request);
  requireRole(caller, ["superadmin"]);
  await checkRateLimit("claimFacility", caller.uid, 15, 60 * 60 * 1000); // 15/hour — legitimate use case for bulk-claiming several imported facilities at once

  const { facilityType, facilityId, adminFirstName, adminLastName, adminEmail, adminPassword } = request.data || {};
  const collectionName = validateFacilityType(facilityType);
  if (!facilityId || !adminFirstName || !adminLastName || !adminEmail || !adminPassword) {
    throw new HttpsError("invalid-argument", "Champs obligatoires manquants.");
  }
  if (adminPassword.length < 6) {
    throw new HttpsError("invalid-argument", "Le mot de passe doit contenir au moins 6 caractères.");
  }

  const db = admin.firestore();
  const facilityRef = db.collection(collectionName).doc(facilityId);
  const facilitySnap = await facilityRef.get();
  if (!facilitySnap.exists) throw new HttpsError("not-found", "Établissement introuvable.");
  const facility = facilitySnap.data();
  if (facility.claimed) {
    throw new HttpsError("failed-precondition", "Cet établissement a déjà un administrateur.");
  }

  let adminRecord;
  try {
    adminRecord = await admin.auth().createUser({
      email: adminEmail, password: adminPassword, displayName: `${adminFirstName} ${adminLastName}`,
    });
  } catch (e) {
    if (e.code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "Cet email administrateur est déjà utilisé.");
    }
    throw new HttpsError("internal", translateAuthError(e));
  }

  try {
    await db.collection("users").doc(adminRecord.uid).set({
      firstName: adminFirstName, lastName: adminLastName, email: adminEmail,
      role: "facilityadmin",
      facilityType, facilityId, facilityName: facility.name,
      approved: true, disabled: false,
      createdAt: new Date().toISOString(), createdBy: caller.uid,
    });
    await facilityRef.update({ claimed: true });
  } catch (e) {
    await admin.auth().deleteUser(adminRecord.uid).catch(() => {});
    throw new HttpsError("internal", "Erreur d'enregistrement du profil administrateur: " + e.message);
  }

  try {
    const link = await admin.auth().generatePasswordResetLink(adminEmail);
    console.log(`Password reset link for ${adminEmail}: ${link}`);
  } catch (e) {
    console.warn("Could not generate password reset link:", e.message);
  }

  return { message: `${facility.name} réclamé(e) avec succès.` };
});