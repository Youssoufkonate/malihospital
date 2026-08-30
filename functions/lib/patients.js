const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getCallerProfile, requireRole, writeAuditLog } = require("./helpers");

function calcAge(dob) {
  if (!dob) return null;
  const birth = new Date(dob);
  if (isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

/**
 * Patient records are scoped to a single hospital (your decision — a
 * patient registered at Hospital A is invisible to Hospital B). Patient
 * IDs (PAT-000001, PAT-000002, ...) are generated inside a Firestore
 * transaction against a per-hospital counter doc, so two receptionists
 * registering patients at the exact same moment can never end up with the
 * same ID — a plain "read the count, add one" approach on the client
 * could not safely guarantee that.
 */
exports.registerPatient = onCall(async (request) => {
  const caller = await getCallerProfile(request);
  requireRole(caller, ["accueil", "hospitaladmin"]);

  const {
    firstName, lastName, phone, dob, sex,
    address, city, commune, quartier,
    bloodType, allergies, notes,
  } = request.data || {};

  if (!firstName || !firstName.trim() || !lastName || !lastName.trim()) {
    throw new HttpsError("invalid-argument", "Le nom et le prénom sont obligatoires.");
  }

  const db = admin.firestore();
  const counterRef = db.collection("counters").doc(caller.hospitalId);
  const patientRef = db.collection("patients").doc();

  let patientId;
  try {
    await db.runTransaction(async (tx) => {
      const counterSnap = await tx.get(counterRef);
      const nextNumber = (counterSnap.exists ? (counterSnap.data().patientCount || 0) : 0) + 1;
      patientId = `PAT-${String(nextNumber).padStart(6, "0")}`;

      tx.set(counterRef, { patientCount: nextNumber }, { merge: true });
      tx.set(patientRef, {
        patientId,
        hospitalId: caller.hospitalId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone || "",
        dob: dob || "",
        sex: sex || "",
        address: address || "",
        city: city || "",
        commune: commune || "",
        quartier: quartier || "",
        bloodType: bloodType || "",
        allergies: allergies || "",
        notes: notes || "",
        createdAt: new Date().toISOString(),
        createdBy: caller.uid,
        createdByName: `${caller.firstName} ${caller.lastName}`,
      });
    });
  } catch (e) {
    throw new HttpsError("internal", "Erreur lors de l'enregistrement du patient: " + e.message);
  }

  await writeAuditLog({
    hospitalId: caller.hospitalId,
    adminId: caller.uid,
    adminName: `${caller.firstName} ${caller.lastName}`,
    adminEmail: caller.email,
    action: "register_patient",
    targetUserId: patientRef.id,
    targetUserName: `${firstName} ${lastName}`,
    details: { patientId },
  });

  return {
    id: patientRef.id,
    patientId,
    age: calcAge(dob),
    message: `Patient enregistré : ${patientId}`,
  };
});