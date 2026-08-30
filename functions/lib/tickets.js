const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getCallerProfile, requireRole, requireHospitalMatch, isLockActive } = require("./helpers");

/**
 * Replaces Doctor.jsx's client-side callPatient: writes the `calls` doc
 * and (if the ticket was "ready") flips it to "in-progress" + stamps the
 * consultation-start fields, as ONE atomic batch instead of two separate
 * client writes that could partially fail (e.g. network drop between them).
 */
exports.callNextPatient = onCall(async (request) => {
  const caller = await getCallerProfile(request);
  requireRole(caller, ["doctor"]);

  const { ticketId } = request.data || {};
  if (!ticketId) throw new HttpsError("invalid-argument", "ticketId manquant.");
  if (!caller.room) {
    throw new HttpsError("failed-precondition", "Numéro de chambre non défini. Contactez l'administrateur.");
  }

  const db = admin.firestore();
  const ticketRef = db.collection("tickets").doc(ticketId);
  const ticketSnap = await ticketRef.get();
  if (!ticketSnap.exists) throw new HttpsError("not-found", "Ticket introuvable.");
  const ticket = ticketSnap.data();

  requireHospitalMatch(caller, ticket.hospitalId);
  if (ticket.department !== caller.department) {
    throw new HttpsError("permission-denied", "Ce ticket n'appartient pas à votre département.");
  }
  // Enforces the nurse-triage gate server-side too, not just in the UI:
  // a doctor cannot call a patient who hasn't been marked "ready" by a nurse.
  if (!["ready", "in-progress"].includes(ticket.status)) {
    throw new HttpsError("failed-precondition", "Ce patient n'est pas encore prêt (triage infirmier requis).");
  }

  const calledAt = new Date().toISOString();
  const callData = {
    ticketNumber: ticket.ticketNumber,
    patientName: ticket.patientName,
    department: ticket.department,
    hospitalId: ticket.hospitalId,
    doctorId: caller.uid,
    doctorName: `Dr. ${caller.firstName} ${caller.lastName}`,
    calledAt,
    room: caller.room,
  };

  const updates = {};
  if (ticket.status === "ready") {
    updates.status = "in-progress";
    updates.updatedAt = calledAt;
    updates.updatedBy = caller.uid;
    if (!ticket.consultationStartedAt) {
      updates.consultationStartedAt = calledAt;
      updates.consultationDoctorId = caller.uid;
      updates.consultationDoctorName = `Dr. ${caller.firstName} ${caller.lastName}`;
    }
  }

  const batch = db.batch();
  batch.set(db.collection("calls").doc(), callData);
  if (Object.keys(updates).length) batch.update(ticketRef, updates);
  await batch.commit();

  return { message: `Patient appelé : ${ticket.patientName} (${ticket.ticketNumber}) à la chambre ${caller.room}.` };
});

/**
 * New capability — there was no diagnosis concept in the schema before.
 * Feeds the new getDiseaseStatistics function.
 */
exports.saveDiagnosis = onCall(async (request) => {
  const caller = await getCallerProfile(request);
  requireRole(caller, ["doctor"]);

  const { ticketId, diagnosis, diagnosisNotes } = request.data || {};
  if (!ticketId || !diagnosis || !diagnosis.trim()) {
    throw new HttpsError("invalid-argument", "ticketId et diagnosis sont obligatoires.");
  }

  const db = admin.firestore();
  const ticketRef = db.collection("tickets").doc(ticketId);
  const ticketSnap = await ticketRef.get();
  if (!ticketSnap.exists) throw new HttpsError("not-found", "Ticket introuvable.");
  const ticket = ticketSnap.data();

  requireHospitalMatch(caller, ticket.hospitalId);
  // NOTE: this used to also require caller.uid === ticket.consultationDoctorId
  // (only the doctor who originally called the patient could save a
  // diagnosis). That's now redundant with — and was actively conflicting
  // with — the lock system below: a doctor can legitimately hold the lock
  // (acquirePatientRecordLock already succeeded) without being the exact
  // doctor who first clicked "Appeler" on this ticket. The lock is now the
  // single source of truth for "who's allowed to edit this right now."
  if (isLockActive(ticket) && ticket.lockedBy !== caller.uid) {
    throw new HttpsError("failed-precondition", `Ce dossier est actuellement modifié par ${ticket.lockedByName || "un autre médecin"}. Réessayez dans quelques minutes.`);
  }

  await ticketRef.update({
    diagnosis: diagnosis.trim(),
    diagnosisNotes: diagnosisNotes || "",
    diagnosisSavedAt: new Date().toISOString(),
    diagnosisSavedBy: caller.uid,
    diagnosisSavedByName: `Dr. ${caller.firstName} ${caller.lastName}`,
    // Editing session is done once saved — release the lock so the next
    // doctor doesn't have to wait out the full timeout for no reason.
    lockedBy: null,
    lockedByName: null,
    lockedAt: null,
  });

  return { message: "Diagnostic enregistré." };
});

// Only these fields are writable through this endpoint — status, priority,
// hospitalId, etc. all have their own dedicated, more tightly-scoped paths.
// A crafted client payload can't use this generic endpoint to sneak past
// those narrower checks.
const RECORD_ALLOWED_FIELDS = ["treatmentNotes", "prescription", "followUpInstructions", "patientName", "age", "sex"];

exports.updatePatientRecord = onCall(async (request) => {
  const caller = await getCallerProfile(request);
  requireRole(caller, ["doctor", "nurse"]);

  const { ticketId, fields } = request.data || {};
  if (!ticketId || !fields || typeof fields !== "object") {
    throw new HttpsError("invalid-argument", "ticketId et fields sont obligatoires.");
  }

  const updates = {};
  for (const key of RECORD_ALLOWED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) updates[key] = fields[key];
  }
  if (Object.keys(updates).length === 0) {
    throw new HttpsError("invalid-argument", "Aucun champ modifiable fourni.");
  }

  const db = admin.firestore();
  const ticketRef = db.collection("tickets").doc(ticketId);
  const ticketSnap = await ticketRef.get();
  if (!ticketSnap.exists) throw new HttpsError("not-found", "Ticket introuvable.");
  const ticket = ticketSnap.data();
  requireHospitalMatch(caller, ticket.hospitalId);

  // A doctor's active lock blocks writes here too, even from a nurse —
  // both write to the same ticket document, so a nurse edit mid-diagnosis
  // could otherwise silently clobber what the doctor is entering.
  if (isLockActive(ticket) && ticket.lockedBy !== caller.uid) {
    throw new HttpsError("failed-precondition", `Ce dossier est actuellement modifié par ${ticket.lockedByName || "un autre membre du personnel"}. Réessayez dans quelques minutes.`);
  }

  updates.recordUpdatedAt = new Date().toISOString();
  updates.recordUpdatedBy = caller.uid;
  updates.recordUpdatedByName = `${caller.firstName} ${caller.lastName}`;

  await ticketRef.update(updates);
  return { message: "Dossier patient mis à jour." };
});

/**
 * Lock/unlock a ticket for exclusive editing. Acquisition is doctor-only,
 * matching "only a doctor edits at a time" — but the lock itself blocks
 * ANY writer (doctor or nurse) via saveDiagnosis/updatePatientRecord above,
 * since both write to the same document. Re-acquiring your own already-
 * held lock just refreshes its timestamp (extends the session) rather
 * than failing.
 */
exports.acquirePatientRecordLock = onCall(async (request) => {
  const caller = await getCallerProfile(request);
  requireRole(caller, ["doctor"]);

  const { ticketId } = request.data || {};
  if (!ticketId) throw new HttpsError("invalid-argument", "ticketId manquant.");

  const db = admin.firestore();
  const ticketRef = db.collection("tickets").doc(ticketId);
  const ticketSnap = await ticketRef.get();
  if (!ticketSnap.exists) throw new HttpsError("not-found", "Ticket introuvable.");
  const ticket = ticketSnap.data();
  requireHospitalMatch(caller, ticket.hospitalId);

  if (isLockActive(ticket) && ticket.lockedBy !== caller.uid) {
    const ageMinutes = Math.max(1, Math.round((Date.now() - new Date(ticket.lockedAt).getTime()) / 60000));
    throw new HttpsError("failed-precondition", `Ce dossier est en cours de modification par ${ticket.lockedByName || "un autre médecin"} depuis ${ageMinutes} min.`);
  }

  const lockedAt = new Date().toISOString();
  await ticketRef.update({
    lockedBy: caller.uid,
    lockedByName: `Dr. ${caller.firstName} ${caller.lastName}`,
    lockedAt,
  });

  return { message: "Dossier verrouillé pour modification.", lockedAt };
});

exports.releasePatientRecordLock = onCall(async (request) => {
  const caller = await getCallerProfile(request);
  requireRole(caller, ["doctor"]);

  const { ticketId } = request.data || {};
  if (!ticketId) throw new HttpsError("invalid-argument", "ticketId manquant.");

  const db = admin.firestore();
  const ticketRef = db.collection("tickets").doc(ticketId);
  const ticketSnap = await ticketRef.get();
  if (!ticketSnap.exists) throw new HttpsError("not-found", "Ticket introuvable.");
  const ticket = ticketSnap.data();
  requireHospitalMatch(caller, ticket.hospitalId);

  // Only the doctor holding the lock can release it (releasing someone
  // else's active lock is what forceUnlockPatientRecord, admin-only, is for).
  if (ticket.lockedBy && ticket.lockedBy !== caller.uid) {
    throw new HttpsError("permission-denied", "Vous ne détenez pas le verrou de ce dossier.");
  }

  await ticketRef.update({ lockedBy: null, lockedByName: null, lockedAt: null });
  return { message: "Verrou libéré." };
});

/**
 * Escape hatch for hospital admins when a lock gets stuck longer than
 * anyone wants to wait for the 10-minute auto-expiry (e.g. a doctor's
 * browser crashed mid-edit and someone urgently needs the record).
 */
exports.forceUnlockPatientRecord = onCall(async (request) => {
  const caller = await getCallerProfile(request);
  requireRole(caller, ["hospitaladmin", "superadmin"]);

  const { ticketId } = request.data || {};
  if (!ticketId) throw new HttpsError("invalid-argument", "ticketId manquant.");

  const db = admin.firestore();
  const ticketRef = db.collection("tickets").doc(ticketId);
  const ticketSnap = await ticketRef.get();
  if (!ticketSnap.exists) throw new HttpsError("not-found", "Ticket introuvable.");
  const ticket = ticketSnap.data();
  requireHospitalMatch(caller, ticket.hospitalId);

  await ticketRef.update({ lockedBy: null, lockedByName: null, lockedAt: null });
  return { message: "Verrou retiré de force." };
});