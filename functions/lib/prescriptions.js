const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getCallerProfile, requireRole, requireHospitalMatch } = require("./helpers");

/**
 * Doctor writes a prescription and routes it directly to a chosen pharmacy
 * — it appears on that pharmacy's dashboard immediately, before the
 * patient physically arrives. The pharmacy is picked by the doctor from a
 * location-filtered list on the client (see Doctor.jsx); this function
 * re-validates the pharmacy actually exists and is active, rather than
 * trusting the client's filtering.
 */
exports.createPrescription = onCall(async (request) => {
  const caller = await getCallerProfile(request);
  requireRole(caller, ["doctor"]);

  const { ticketId, pharmacyId, medications, patientPhone: submittedPhone } = request.data || {};
  if (!ticketId || !pharmacyId) {
    throw new HttpsError("invalid-argument", "ticketId et pharmacyId sont obligatoires.");
  }
  if (!Array.isArray(medications) || medications.length === 0) {
    throw new HttpsError("invalid-argument", "Au moins un médicament est requis.");
  }
  const cleanMeds = medications
    .map((m) => ({
      name: (m.name || "").trim(),
      dosage: (m.dosage || "").trim(),
      quantity: (m.quantity || "").trim(),
      duration: (m.duration || "").trim(),
      instructions: (m.instructions || "").trim(),
    }))
    .filter((m) => m.name);
  if (cleanMeds.length === 0) {
    throw new HttpsError("invalid-argument", "Chaque médicament doit avoir un nom.");
  }

  const db = admin.firestore();
  let ticketSnap, ticket;
  try {
    ticketSnap = await db.collection("tickets").doc(ticketId).get();
  } catch (e) {
    throw new HttpsError("internal", "Erreur de lecture du ticket: " + e.message);
  }
  if (!ticketSnap.exists) throw new HttpsError("not-found", "Ticket introuvable.");
  ticket = ticketSnap.data();
  requireHospitalMatch(caller, ticket.hospitalId);

  // The doctor confirms the phone with the patient in the room — takes
  // priority over whatever's on file, since it's what the pharmacy will
  // actually ask the patient for. Falls back to the registered number
  // only if the doctor left it blank for some reason. patientId (the
  // human-readable PAT-000123 form) always comes from the record itself —
  // there's no reason for the doctor to retype something already fixed.
  let patientPhone = (submittedPhone || "").trim();
  let patientId = null;
  if (ticket.patientDocId) {
    try {
      const patientSnap = await db.collection("patients").doc(ticket.patientDocId).get();
      // .exists is a boolean PROPERTY on the Admin SDK's DocumentSnapshot,
      // not a method — calling it as a function (patientSnap.exists())
      // throws a TypeError, which is exactly what caused every
      // prescription to fail with a generic "internal" error before.
      if (patientSnap.exists) {
        const patientData = patientSnap.data();
        if (!patientPhone) patientPhone = patientData.phone || "";
        patientId = patientData.patientId || null;
      }
    } catch (e) {
      console.warn("Could not read patient record (non-fatal):", e.message);
    }
  }

  let pharmSnap;
  try {
    pharmSnap = await db.collection("pharmacies").doc(pharmacyId).get();
  } catch (e) {
    throw new HttpsError("internal", "Erreur de lecture de la pharmacie: " + e.message);
  }
  if (!pharmSnap.exists) throw new HttpsError("not-found", "Pharmacie introuvable.");
  const pharmacy = pharmSnap.data();
  if (pharmacy.active === false) {
    throw new HttpsError("failed-precondition", "Cette pharmacie est actuellement désactivée.");
  }

  let ref;
  try {
    ref = await db.collection("prescriptions").add({
      ticketId,
      patientDocId: ticket.patientDocId || null,
      patientId,
      patientName: ticket.patientName,
      patientPhone,
      hospitalId: ticket.hospitalId,
      department: ticket.department,
      doctorId: caller.uid,
      doctorName: `Dr. ${caller.firstName} ${caller.lastName}`,
      diagnosis: ticket.diagnosis || null,
      pharmacyId,
      pharmacyName: pharmacy.name,
      medications: cleanMeds,
      status: "pending", // pending -> preparing -> ready -> collected
      createdAt: new Date().toISOString(),
    });
  } catch (e) {
    throw new HttpsError("internal", "Erreur d'enregistrement de l'ordonnance: " + e.message);
  }

  return { id: ref.id, message: `Ordonnance envoyée à ${pharmacy.name}.` };
});