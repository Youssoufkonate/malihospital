const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getCallerProfile, requireRole, requireHospitalMatch } = require("./helpers");

exports.createLabRequest = onCall(async (request) => {
  const caller = await getCallerProfile(request);
  requireRole(caller, ["doctor"]);

  const { ticketId, labId, tests, patientPhone: submittedPhone } = request.data || {};
  if (!ticketId || !labId) {
    throw new HttpsError("invalid-argument", "ticketId et labId sont obligatoires.");
  }
  if (!Array.isArray(tests) || tests.length === 0) {
    throw new HttpsError("invalid-argument", "Au moins une analyse est requise.");
  }
  const cleanTests = tests
    .map((t) => ({
      name: (t.name || "").trim(),
      labTestId: t.labTestId || null,
      sampleType: (t.sampleType || "").trim(),
      notes: (t.notes || "").trim(),
      result: "",
    }))
    .filter((t) => t.name);
  if (cleanTests.length === 0) {
    throw new HttpsError("invalid-argument", "Chaque analyse doit avoir un nom.");
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

  let patientPhone = (submittedPhone || "").trim();
  let patientId = null;
  if (ticket.patientDocId) {
    try {
      const patientSnap = await db.collection("patients").doc(ticket.patientDocId).get();
      if (patientSnap.exists) {
        const patientData = patientSnap.data();
        if (!patientPhone) patientPhone = patientData.phone || "";
        patientId = patientData.patientId || null;
      }
    } catch (e) {
      console.warn("Could not read patient record (non-fatal):", e.message);
    }
  }

  let labSnap;
  try {
    labSnap = await db.collection("labs").doc(labId).get();
  } catch (e) {
    throw new HttpsError("internal", "Erreur de lecture du laboratoire: " + e.message);
  }
  if (!labSnap.exists) throw new HttpsError("not-found", "Laboratoire introuvable.");
  const lab = labSnap.data();
  if (lab.active === false) {
    throw new HttpsError("failed-precondition", "Ce laboratoire est actuellement désactivé.");
  }

  let ref;
  try {
    ref = await db.collection("labRequests").add({
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
      labId,
      labName: lab.name,
      tests: cleanTests,
      status: "pending",
      createdAt: new Date().toISOString(),
    });
  } catch (e) {
    throw new HttpsError("internal", "Erreur d'enregistrement de la demande: " + e.message);
  }

  return { id: ref.id, message: `Demande d'analyse envoyée à ${lab.name}.` };
});