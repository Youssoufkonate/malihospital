const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getCallerProfile, requireRole, requireHospitalMatch } = require("./helpers");

async function fetchYearTickets(hospitalId, year) {
  const start = new Date(`${year}-01-01T00:00:00`).toISOString();
  const end = new Date(`${year}-12-31T23:59:59.999`).toISOString();
  try {
    const snap = await admin.firestore().collection("tickets")
      .where("hospitalId", "==", hospitalId)
      .where("createdAt", ">=", start)
      .where("createdAt", "<=", end)
      .get();
    return snap.docs.map((d) => d.data());
  } catch (e) {
    // Functions v2 strips error details from the client by default (for
    // security) and would otherwise surface only a generic "internal"
    // error — which would hide the auto-generated Firestore index-creation
    // link that used to be directly clickable in the browser console when
    // this same query ran on the client. Re-throwing as an HttpsError with
    // the original message keeps that link (as text) visible to whoever's
    // debugging, even though it now has to be checked in Functions logs
    // too (Firebase Console → Functions → Logs) if it's not fully visible
    // client-side.
    throw new HttpsError("internal", "Erreur de requête Firestore: " + e.message);
  }
}

function resolveHospitalId(caller, requested) {
  const hid = caller.role === "superadmin" ? requested : caller.hospitalId;
  if (!hid) throw new HttpsError("invalid-argument", "hospitalId manquant.");
  requireHospitalMatch(caller, hid);
  return hid;
}

/**
 * New capability — no diagnosis-based aggregation existed before because
 * there was no diagnosis field. Groups completed tickets by their
 * diagnosis label.
 */
exports.getDiseaseStatistics = onCall(async (request) => {
  const caller = await getCallerProfile(request);
  requireRole(caller, ["hospitaladmin", "superadmin"]);
  const { hospitalId, year } = request.data || {};
  if (!year) throw new HttpsError("invalid-argument", "year est requis.");
  const hid = resolveHospitalId(caller, hospitalId);

  const tickets = await fetchYearTickets(hid, year);
  const byDisease = {};
  tickets.forEach((t) => {
    if (!t.diagnosis) return;
    if (!byDisease[t.diagnosis]) byDisease[t.diagnosis] = { name: t.diagnosis, count: 0, byDepartment: {} };
    byDisease[t.diagnosis].count++;
    const dept = t.department || "Non spécifié";
    byDisease[t.diagnosis].byDepartment[dept] = (byDisease[t.diagnosis].byDepartment[dept] || 0) + 1;
  });

  return {
    year,
    totalDiagnosed: tickets.filter((t) => t.diagnosis).length,
    totalTickets: tickets.length,
    diseases: Object.values(byDisease).sort((a, b) => b.count - a.count),
  };
});

/**
 * Replaces the doctor-completion portion of AdminPanel.jsx's client-side
 * loadStatistics, which downloaded every matching ticket to the browser
 * just to sum them in JS. Same result, computed server-side instead.
 */
exports.getDoctorStatistics = onCall(async (request) => {
  const caller = await getCallerProfile(request);
  requireRole(caller, ["hospitaladmin", "superadmin"]);
  const { hospitalId, year } = request.data || {};
  if (!year) throw new HttpsError("invalid-argument", "year est requis.");
  const hid = resolveHospitalId(caller, hospitalId);

  const db = admin.firestore();
  const [tickets, doctorsSnap] = await Promise.all([
    fetchYearTickets(hid, year),
    db.collection("users").where("hospitalId", "==", hid).where("role", "==", "doctor").get(),
  ]);
  const doctors = doctorsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const stats = doctors.map((doctor) => {
    const deptTickets = tickets.filter((t) => t.department === doctor.department);
    const completed = deptTickets.filter((t) => t.status === "completed" && t.consultationDoctorId === doctor.id);
    const totalSeconds = completed.reduce((sum, t) => sum + (t.consultationDurationSeconds || 0), 0);
    return {
      id: doctor.id,
      name: `Dr. ${doctor.firstName} ${doctor.lastName}`,
      department: doctor.department || "Non assigné",
      room: doctor.room || "-",
      totalInDept: deptTickets.length,
      completed: completed.length,
      completionRate: deptTickets.length > 0 ? ((completed.length / deptTickets.length) * 100).toFixed(1) : "0.0",
      avgConsultationMinutes: completed.length > 0 ? Math.round(totalSeconds / completed.length / 60) : null,
    };
  });

  return { year, doctors: stats.sort((a, b) => b.completed - a.completed) };
});

/**
 * New capability — a single combined report (department breakdown,
 * priority mix, average consultation time) computed server-side, meant to
 * back a proper "Admin reports" view instead of only the ad-hoc printed
 * Statistiques tab that already existed.
 */
exports.generateAdminReport = onCall(async (request) => {
  const caller = await getCallerProfile(request);
  requireRole(caller, ["hospitaladmin", "superadmin"]);
  const { hospitalId, year } = request.data || {};
  if (!year) throw new HttpsError("invalid-argument", "year est requis.");
  const hid = resolveHospitalId(caller, hospitalId);

  const db = admin.firestore();
  const [tickets, hospSnap] = await Promise.all([
    fetchYearTickets(hid, year),
    db.collection("hospitals").doc(hid).get(),
  ]);

  const byDepartment = {};
  tickets.forEach((t) => {
    const dept = t.department || "Non spécifié";
    if (!byDepartment[dept]) byDepartment[dept] = { total: 0, waiting: 0, ready: 0, inProgress: 0, completed: 0, noShow: 0 };
    byDepartment[dept].total++;
    if (t.status === "waiting") byDepartment[dept].waiting++;
    if (t.status === "ready") byDepartment[dept].ready++;
    if (t.status === "in-progress") byDepartment[dept].inProgress++;
    if (t.status === "completed") byDepartment[dept].completed++;
    if (t.status === "no-show") byDepartment[dept].noShow++;
  });

  const priorityBreakdown = { emergency: 0, urgent: 0, normal: 0 };
  tickets.forEach((t) => { priorityBreakdown[t.priority || "normal"] = (priorityBreakdown[t.priority || "normal"] || 0) + 1; });

  const completed = tickets.filter((t) => t.status === "completed" && t.consultationDurationSeconds != null);
  const avgConsultationMinutes = completed.length > 0
    ? Math.round(completed.reduce((s, t) => s + t.consultationDurationSeconds, 0) / completed.length / 60)
    : null;

  return {
    hospitalName: hospSnap.exists ? hospSnap.data().name : "—",
    year,
    generatedAt: new Date().toISOString(),
    totals: {
      tickets: tickets.length,
      completed: completed.length,
      noShow: tickets.filter((t) => t.status === "no-show").length,
      avgConsultationMinutes,
    },
    priorityBreakdown,
    byDepartment: Object.entries(byDepartment).map(([name, d]) => ({
      name,
      ...d,
      completionRate: d.total > 0 ? ((d.completed / d.total) * 100).toFixed(1) : "0.0",
    })),
  };
});