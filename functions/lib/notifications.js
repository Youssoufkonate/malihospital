const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getCallerProfile, requireRole } = require("./helpers");

/**
 * In-app only, as decided — writes a doc to `notifications` that every
 * dashboard reads directly via Firestore (see NotificationsBanner.jsx on
 * the client). No FCM/push, no SMS provider, no extra cost or setup beyond
 * what's already deployed.
 *
 * Scopes:
 *   - superadmin: one hospital, or every hospital (hospitalId omitted)
 *   - hospitaladmin: their own hospital, every department
 *   - supervisor: their own hospital, their own department ONLY — they
 *     cannot broadcast hospital-wide, and their own department is taken
 *     from their profile, not a free-choice field they could tamper with.
 *   - facilityadmin: cannot broadcast hospital/department-wide at all —
 *     targetUserId is required for them (their own facility's staff, one
 *     at a time), verified below.
 *   - lab / pharmacy (operational facility staff, not the facility admin):
 *     same as facilityadmin — targetUserId only, no broadcast option —
 *     but restricted to targeting a doctor specifically (e.g. "your lab
 *     results are ready"), not arbitrary staff. There's no hospitalId or
 *     facilityId relationship to check here (a lab responds to whichever
 *     doctor actually sent them a request, possibly from any hospital,
 *     matching the platform's existing "any facility is reachable by any
 *     doctor" design) — the meaningful guarantee is simply "this can only
 *     ever reach a doctor," not "this hospital's own facility."
 *   - targetUserId (any role above): a single specific person, instead of
 *     a hospital/department-wide broadcast. Ownership is verified against
 *     the ACTUAL relationship type — hospital-based callers check the
 *     target's hospitalId, facility-based callers check the target's
 *     facilityId. Comparing hospitalId alone would have been wrong for a
 *     facilityadmin: facility staff don't have a hospitalId at all, so
 *     both sides would read as undefined and incorrectly "match" for any
 *     facility, not just the caller's own.
 */
exports.broadcastNotification = onCall(async (request) => {
  const caller = await getCallerProfile(request);
  requireRole(caller, ["hospitaladmin", "superadmin", "supervisor", "facilityadmin", "lab", "pharmacy"]);

  const { hospitalId, title, message, severity, targetUserId } = request.data || {};
  if (!title || !title.trim() || !message || !message.trim()) {
    throw new HttpsError("invalid-argument", "title et message sont obligatoires.");
  }

  let targetHospitalId = null;
  let targetDepartment = null;
  let finalTargetUserId = null;

  if (targetUserId) {
    const targetSnap = await admin.firestore().collection("users").doc(targetUserId).get();
    if (!targetSnap.exists) throw new HttpsError("not-found", "Utilisateur introuvable.");
    const target = targetSnap.data();

    if (caller.role === "facilityadmin") {
      if (target.facilityId !== caller.facilityId) {
        throw new HttpsError("permission-denied", "Cette personne ne fait pas partie de votre établissement.");
      }
    } else if (caller.role === "lab" || caller.role === "pharmacy") {
      if (target.role !== "doctor") {
        throw new HttpsError("permission-denied", "Le personnel de laboratoire/pharmacie ne peut notifier qu'un médecin.");
      }
    } else if (caller.role !== "superadmin" && target.hospitalId !== caller.hospitalId) {
      throw new HttpsError("permission-denied", "Cet utilisateur n'appartient pas à votre hôpital.");
    }
    finalTargetUserId = targetUserId;
    targetHospitalId = target.hospitalId || null;
  } else if (caller.role === "facilityadmin" || caller.role === "lab" || caller.role === "pharmacy") {
    // No hospital/department-wide broadcast option for facility staff —
    // targetUserId (handled above) is the only path for them.
    throw new HttpsError("invalid-argument", "Le personnel d'établissement doit cibler une personne spécifique.");
  } else if (caller.role === "supervisor") {
    if (!caller.department) {
      throw new HttpsError("failed-precondition", "Votre compte superviseur n'a pas de département assigné.");
    }
    targetHospitalId = caller.hospitalId;
    targetDepartment = caller.department;
  } else if (caller.role === "hospitaladmin") {
    targetHospitalId = caller.hospitalId;
  } else if (hospitalId) {
    targetHospitalId = hospitalId;
  }

  const allowedSeverity = ["info", "warning", "urgent"];
  const finalSeverity = allowedSeverity.includes(severity) ? severity : "info";

  const ref = await admin.firestore().collection("notifications").add({
    hospitalId: targetHospitalId, // null = visible to every hospital (super admin broadcasts only)
    department: targetDepartment, // null = visible hospital-wide; set = only that department's staff
    targetUserId: finalTargetUserId, // null = not an individual notice; set = only that one person
    title: title.trim(),
    message: message.trim(),
    severity: finalSeverity,
    createdAt: new Date().toISOString(),
    createdBy: caller.uid,
    createdByName: `${caller.firstName} ${caller.lastName}`,
  });

  return { id: ref.id, message: "Notification diffusée." };
});