import { useState, useEffect, useRef } from "react";
import ChangePassword from "./ChangePassword";
import SessionsButton from "../components/SessionsButton";
import { auth, db, functions } from "../firebase";
import {
  collection, doc, getDoc, getDocs, query, where, onSnapshot,
  addDoc, updateDoc, deleteDoc, writeBatch,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import NotificationsBanner from "../components/NotificationsBanner";

const COLORS = {
  green: "#14B53A", gold: "#FCD116", red: "#CE1126", ink: "#1B2A1F",
  slate: "#5B6B63", paper: "#FAF9F5", card: "#FFFFFF", line: "#E6E2D8",
  successBg: "#E9F7EC", successText: "#1E7B34",
  dangerBg: "#FBEAEC", dangerText: "#A31221",
};
const FONT_DISPLAY = "'Georgia', 'Iowan Old Style', 'Times New Roman', serif";
const FONT_BODY = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
const WEEKDAY_LABELS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
const RETENTION_DAYS = { daily: 1, weekly: 7, monthly: 30 };

function formatDateLocal(d) { return d.toISOString().slice(0, 10); }

function MaliFlag({ width = 44, height = 30, style }) {
  return (
    <svg width={width} height={height} viewBox="0 0 90 60" style={{ display: "block", ...style }}>
      <rect x="0" y="0" width="30" height="60" fill={COLORS.green} />
      <rect x="30" y="0" width="30" height="60" fill={COLORS.gold} />
      <rect x="60" y="0" width="30" height="60" fill={COLORS.red} />
      <rect x="0.5" y="0.5" width="89" height="59" fill="none" stroke="rgba(0,0,0,0.12)" />
    </svg>
  );
}

export default function FacilityAdmin() {
  const [userData, setUserData] = useState(null);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [facility, setFacility] = useState(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("staff");
  const [reportPeriod, setReportPeriod] = useState("month"); // day | week | month
  const [reportData, setReportData] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const [staff, setStaff] = useState([]);
  const [newStaffForm, setNewStaffForm] = useState({ firstName: "", lastName: "", email: "", password: "" });
  const [creatingStaff, setCreatingStaff] = useState(false);

  const [scheduleDate, setScheduleDate] = useState(new Date().toISOString().slice(0, 10));
  const [scheduleEntries, setScheduleEntries] = useState([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [shiftForm, setShiftForm] = useState({
    staffId: "", shiftStart: "08:00", shiftEnd: "16:00", notes: "",
    cadence: "daily", daysOfWeek: [true, true, true, true, true, true, true],
  });
  const [editingScheduleId, setEditingScheduleId] = useState(null);
  const [savingShift, setSavingShift] = useState(false);
  const [viewingStaffSchedule, setViewingStaffSchedule] = useState(null);
  const [staffScheduleEntries, setStaffScheduleEntries] = useState([]);
  const [staffScheduleLoading, setStaffScheduleLoading] = useState(false);

  const nav = useNavigate();
  const staffUnsubRef = useRef(null);
  const scheduleUnsubRef = useRef(null);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user) checkAuthAndLoad();
      else {
        if (staffUnsubRef.current) staffUnsubRef.current();
        if (scheduleUnsubRef.current) scheduleUnsubRef.current();
        nav("/");
      }
    });
    return () => {
      unsubscribe();
      if (staffUnsubRef.current) staffUnsubRef.current();
      if (scheduleUnsubRef.current) scheduleUnsubRef.current();
    };
  }, [nav]);

  const checkAuthAndLoad = async () => {
    if (!auth.currentUser) return nav("/");
    try {
      const userSnap = await getDoc(doc(db, "users", auth.currentUser.uid));
      if (!userSnap.exists()) {
        alert("❌ Données utilisateur introuvables.");
        await signOut(auth); nav("/"); return;
      }
      const user = userSnap.data();
      if (user.disabled) {
        alert("❌ Votre compte a été désactivé.");
        await signOut(auth); nav("/"); return;
      }
      if (user.role !== "facilityadmin") {
        alert("❌ Accès refusé. Cette page est réservée aux administrateurs d'établissement.");
        await signOut(auth); nav("/"); return;
      }
      if (!user.facilityType || !user.facilityId) {
        alert("❌ Votre compte n'est rattaché à aucun établissement.");
        setPageLoading(false); return;
      }
      const collectionName = user.facilityType === "pharmacy" ? "pharmacies" : "labs";
      const facSnap = await getDoc(doc(db, collectionName, user.facilityId));
      if (!facSnap.exists() || facSnap.data().active === false) {
        alert("❌ Cet établissement a été désactivé.");
        await signOut(auth); nav("/"); return;
      }
      setFacility({ id: user.facilityId, ...facSnap.data() });
      setUserData(user);
      loadStaff(user);
      setPageLoading(false);
    } catch (e) {
      alert("Erreur de chargement: " + e.message);
      setPageLoading(false);
    }
  };

  const loadStaff = (user) => {
    const q = query(collection(db, "users"), where("facilityType", "==", user.facilityType), where("facilityId", "==", user.facilityId));
    staffUnsubRef.current = onSnapshot(q, (snap) => {
      setStaff(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((s) => s.role !== "facilityadmin"));
    }, (e) => console.error("Error loading staff:", e));
  };

  const createStaffMember = async () => {
    const { firstName, lastName, email, password } = newStaffForm;
    if (!firstName || !lastName || !email || !password) return setMsg("❌ Veuillez remplir tous les champs.");
    if (password.length < 6) return setMsg("❌ Le mot de passe doit contenir au moins 6 caractères.");
    setCreatingStaff(true);
    setMsg("");
    try {
      const call = httpsCallable(functions, "createFacilityStaff");
      await call({ facilityType: userData.facilityType, facilityId: userData.facilityId, firstName, lastName, email, password });
      setMsg(`✅ Compte créé pour ${firstName} ${lastName}. (Mot de passe temporaire: ${password})`);
      setNewStaffForm({ firstName: "", lastName: "", email: "", password: "" });
    } catch (e) {
      setMsg("❌ Erreur: " + (e.message || "Une erreur est survenue."));
    }
    setCreatingStaff(false);
  };

  const toggleStaffDisabled = async (userId, disabled) => {
    try {
      const call = httpsCallable(functions, "setFacilityStaffDisabled");
      await call({ userId, disabled });
    } catch (e) {
      setMsg("❌ Erreur: " + (e.message || "Une erreur est survenue."));
    }
  };

  const deleteStaffMember = async (userId, name) => {
    if (!window.confirm(`Supprimer ${name} ?`)) return;
    try {
      const call = httpsCallable(functions, "deleteFacilityStaff");
      await call({ userId });
    } catch (e) {
      setMsg("❌ Erreur: " + (e.message || "Une erreur est survenue."));
    }
  };

  // ---- Scheduling (mirrors Supervisor.jsx, scoped by facility instead of hospital+department) ----

  useEffect(() => {
    if (!userData?.facilityType || !userData?.facilityId) return;
    if (scheduleUnsubRef.current) scheduleUnsubRef.current();
    setScheduleLoading(true);
    const q = query(
      collection(db, "schedules"),
      where("facilityType", "==", userData.facilityType),
      where("facilityId", "==", userData.facilityId),
      where("date", "==", scheduleDate)
    );
    scheduleUnsubRef.current = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => (a.shiftStart || "").localeCompare(b.shiftStart || ""));
      setScheduleEntries(list);
      setScheduleLoading(false);
    }, (e) => { console.error("Error loading schedule:", e); setScheduleLoading(false); });
    return () => { if (scheduleUnsubRef.current) scheduleUnsubRef.current(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userData?.facilityType, userData?.facilityId, scheduleDate]);

  // Opportunistic auto-expiry, same reasoning as Supervisor.jsx — no
  // scheduled Cloud Function (v2 scheduler crashes in this environment),
  // so cleanup runs whenever this dashboard loads instead.
  useEffect(() => {
    if (!userData?.facilityType || !userData?.facilityId) return;
    (async () => {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const q = query(
          collection(db, "schedules"),
          where("facilityType", "==", userData.facilityType),
          where("facilityId", "==", userData.facilityId),
          where("date", "<", today)
        );
        const snap = await getDocs(q);
        if (snap.empty) return;
        const now = Date.now();
        const toDelete = snap.docs.filter((d) => {
          const data = d.data();
          const retentionDays = RETENTION_DAYS[data.cadence] ?? RETENTION_DAYS.daily;
          const entryMs = new Date(data.date + "T00:00:00").getTime();
          return now >= entryMs + retentionDays * 24 * 60 * 60 * 1000;
        });
        if (toDelete.length === 0) return;
        const batch = writeBatch(db);
        toDelete.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      } catch (e) {
        console.warn("Lazy schedule cleanup skipped:", e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userData?.facilityType, userData?.facilityId]);

  // Reports are only meaningful for pharmacies right now — labs don't have
  // requests routed to them yet (that's a later phase), so this naturally
  // returns nothing for a lab facility rather than needing a special case.
  // Client-side aggregation, not a Cloud Function — a single facility's
  // prescription volume over a day/week/month is small enough that
  // downloading and reducing it here is simpler and avoids yet another
  // new function to deploy.
  useEffect(() => {
    if (activeTab !== "reports" || !userData?.facilityId) return;
    setReportLoading(true);
    let start;
    const now = new Date();
    if (reportPeriod === "day") {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (reportPeriod === "week") {
      start = new Date(now); start.setDate(start.getDate() - 7);
    } else {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    if (userData.facilityType === "lab") {
      const q = query(
        collection(db, "labRequests"),
        where("labId", "==", userData.facilityId),
        where("createdAt", ">=", start.toISOString())
      );
      getDocs(q)
        .then((snap) => {
          const labRequests = snap.docs.map((d) => d.data());
          const received = labRequests.length;
          const completed = labRequests.filter((r) => r.status === "completed").length;
          const testCounts = {};
          labRequests.forEach((r) => {
            (r.tests || []).forEach((t) => {
              if (!t.name) return;
              testCounts[t.name] = (testCounts[t.name] || 0) + 1;
            });
          });
          const topMedications = Object.entries(testCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([name, count]) => ({ name, count }));
          setReportData({ received, completed, topMedications });
        })
        .catch((e) => { console.error("Error loading report:", e); setReportData(null); })
        .finally(() => setReportLoading(false));
      return;
    }

    const q = query(
      collection(db, "prescriptions"),
      where("pharmacyId", "==", userData.facilityId),
      where("createdAt", ">=", start.toISOString())
    );
    getDocs(q)
      .then((snap) => {
        const prescriptions = snap.docs.map((d) => d.data());
        const received = prescriptions.length;
        const completed = prescriptions.filter((p) => p.status === "collected").length;
        const medCounts = {};
        prescriptions.forEach((p) => {
          (p.medications || []).forEach((m) => {
            if (!m.name) return;
            medCounts[m.name] = (medCounts[m.name] || 0) + 1;
          });
        });
        const topMedications = Object.entries(medCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([name, count]) => ({ name, count }));
        setReportData({ received, completed, topMedications });
      })
      .catch((e) => { console.error("Error loading report:", e); setReportData(null); })
      .finally(() => setReportLoading(false));
  }, [activeTab, userData?.facilityId, userData?.facilityType, reportPeriod]);

  const notifyStaffOfSchedule = async (staffId, summary) => {
    try {
      const call = httpsCallable(functions, "broadcastNotification");
      await call({ targetUserId: staffId, title: "🗓️ Planning mis à jour", message: summary, severity: "info" });
    } catch (e) {
      console.warn("Could not notify staff of schedule change:", e);
    }
  };

  const emptyShiftForm = () => ({
    staffId: "", shiftStart: "08:00", shiftEnd: "16:00", notes: "",
    cadence: "daily", daysOfWeek: [true, true, true, true, true, true, true],
  });

  const computeShiftDates = () => {
    const start = new Date(scheduleDate + "T00:00:00");
    const dates = [];
    if (shiftForm.cadence === "daily") {
      dates.push(new Date(start));
    } else if (shiftForm.cadence === "weekly") {
      for (let i = 0; i < 7; i++) { const d = new Date(start); d.setDate(d.getDate() + i); dates.push(d); }
    } else if (shiftForm.cadence === "monthly") {
      const year = start.getFullYear(), month = start.getMonth();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      for (let day = 1; day <= daysInMonth; day++) dates.push(new Date(year, month, day));
    }
    return dates.filter((d) => shiftForm.daysOfWeek[d.getDay()]);
  };

  const startEditShift = (entry) => {
    setEditingScheduleId(entry.id);
    setShiftForm({
      staffId: entry.staffId, shiftStart: entry.shiftStart, shiftEnd: entry.shiftEnd, notes: entry.notes || "",
      cadence: "daily", daysOfWeek: [true, true, true, true, true, true, true],
    });
  };
  const cancelEditShift = () => { setEditingScheduleId(null); setShiftForm(emptyShiftForm()); };

  const addShift = async () => {
    if (!shiftForm.staffId) return setMsg("❌ Veuillez sélectionner un membre du personnel.");
    if (!shiftForm.shiftStart || !shiftForm.shiftEnd) return setMsg("❌ Veuillez indiquer l'heure de début et de fin.");
    const staffMember = staff.find((s) => s.id === shiftForm.staffId);
    const staffName = staffMember ? `${staffMember.firstName} ${staffMember.lastName}` : "—";
    setSavingShift(true);
    setMsg("");
    try {
      if (editingScheduleId) {
        const existing = scheduleEntries.find((s) => s.id === editingScheduleId);
        await updateDoc(doc(db, "schedules", editingScheduleId), {
          staffId: shiftForm.staffId, staffName, shiftStart: shiftForm.shiftStart, shiftEnd: shiftForm.shiftEnd,
          notes: shiftForm.notes || "", updatedAt: new Date().toISOString(), updatedBy: auth.currentUser.uid,
        });
        setMsg("✅ Horaire modifié.");
        setEditingScheduleId(null);
        await notifyStaffOfSchedule(shiftForm.staffId, `Votre horaire du ${new Date((existing?.date || scheduleDate) + "T00:00:00").toLocaleDateString("fr-FR")} a été modifié : ${shiftForm.shiftStart} – ${shiftForm.shiftEnd}.`);
      } else {
        const dates = computeShiftDates();
        if (dates.length === 0) { setMsg("❌ Aucun jour sélectionné."); setSavingShift(false); return; }
        const batch = writeBatch(db);
        dates.forEach((d) => {
          const ref = doc(collection(db, "schedules"));
          batch.set(ref, {
            facilityType: userData.facilityType, facilityId: userData.facilityId,
            date: formatDateLocal(d), staffId: shiftForm.staffId, staffName,
            shiftStart: shiftForm.shiftStart, shiftEnd: shiftForm.shiftEnd, notes: shiftForm.notes || "",
            cadence: shiftForm.cadence, createdAt: new Date().toISOString(),
            createdBy: auth.currentUser.uid, createdByName: `${userData.firstName} ${userData.lastName}`,
          });
        });
        await batch.commit();
        const label = shiftForm.cadence === "daily" ? "1 jour" : shiftForm.cadence === "weekly" ? `${dates.length} jour(s) sur 7` : `${dates.length} jour(s) du mois`;
        setMsg(`✅ Horaire créé pour ${label}.`);
        await notifyStaffOfSchedule(shiftForm.staffId, `Nouvel horaire assigné (${label}), à partir du ${new Date(scheduleDate + "T00:00:00").toLocaleDateString("fr-FR")} : ${shiftForm.shiftStart} – ${shiftForm.shiftEnd}.`);
      }
      setShiftForm(emptyShiftForm());
      setTimeout(() => setMsg(""), 4000);
    } catch (e) {
      setMsg("❌ Erreur: " + e.message);
    }
    setSavingShift(false);
  };

  const removeShift = async (scheduleId) => {
    if (!window.confirm("Supprimer cet horaire ?")) return;
    try {
      await deleteDoc(doc(db, "schedules", scheduleId));
      if (editingScheduleId === scheduleId) cancelEditShift();
    } catch (e) {
      setMsg("❌ Erreur: " + e.message);
    }
  };

  const openStaffSchedule = async (staffMember) => {
    setViewingStaffSchedule(staffMember);
    setStaffScheduleLoading(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const q = query(
        collection(db, "schedules"),
        where("facilityType", "==", userData.facilityType),
        where("facilityId", "==", userData.facilityId),
        where("date", ">=", today)
      );
      const snap = await getDocs(q);
      const theirs = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((s) => s.staffId === staffMember.id);
      theirs.sort((a, b) => a.date.localeCompare(b.date));
      setStaffScheduleEntries(theirs);
    } catch (e) {
      console.error("Error loading staff schedule:", e);
    }
    setStaffScheduleLoading(false);
  };
  const closeStaffSchedule = () => { setViewingStaffSchedule(null); setStaffScheduleEntries([]); };

  const logout = async () => { await signOut(auth); nav("/"); };

  if (pageLoading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16, backgroundColor: COLORS.paper, fontFamily: FONT_BODY }}>
        <MaliFlag width={56} height={38} />
        <div style={{ fontSize: 16, color: COLORS.slate }}>Chargement…</div>
      </div>
    );
  }

  if (!facility) {
    return (
      <div style={{ minHeight: "100vh", background: COLORS.paper, padding: 30, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_BODY }}>
        <div style={{ padding: 32, maxWidth: 480, backgroundColor: COLORS.card, border: `1px solid ${COLORS.line}`, borderTop: `4px solid ${COLORS.red}`, borderRadius: 10, textAlign: "center" }}>
          <MaliFlag width={48} height={33} style={{ margin: "0 auto 16px" }} />
          <h2 style={{ color: COLORS.ink, fontFamily: FONT_DISPLAY, fontSize: 19, marginBottom: 8 }}>Configuration requise</h2>
          <p style={{ color: COLORS.slate, fontSize: 14.5, lineHeight: 1.6 }}>Votre compte n'est rattaché à aucun établissement.</p>
          <button onClick={logout} style={{ marginTop: 16, padding: "10px 22px", backgroundColor: COLORS.red, color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 14.5, fontWeight: 700 }}>Déconnexion</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: COLORS.paper, fontFamily: FONT_BODY }}>
      <div style={{ height: 6, display: "flex" }}>
        <div style={{ flex: 1, background: COLORS.green }} />
        <div style={{ flex: 1, background: COLORS.gold }} />
        <div style={{ flex: 1, background: COLORS.red }} />
      </div>

      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "0 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "26px 0 22px 0", borderBottom: `1px solid ${COLORS.line}`, gap: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <MaliFlag width={54} height={37} style={{ borderRadius: 3, boxShadow: "0 1px 3px rgba(0,0,0,0.18)" }} />
            <div>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 12, letterSpacing: "0.14em", color: COLORS.slate, textTransform: "uppercase" }}>République du Mali</div>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 21, fontWeight: 700, color: COLORS.ink, marginTop: 6 }}>{facility.name}</div>
              <div style={{ fontSize: 13.5, color: COLORS.slate, marginTop: 4 }}>{userData.facilityType === "pharmacy" ? "💊 Pharmacie" : "🧪 Laboratoire"} · Administration</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 13, color: COLORS.slate }}>Connecté en tant que</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.ink }}>{userData.firstName} {userData.lastName}</div>
            </div>
            <SessionsButton />
            <button onClick={() => setShowChangePassword(true)} style={{
              padding: "10px 16px", backgroundColor: "transparent", color: "#6B4226", border: "1.5px solid #6B4226",
              borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13,
            }}>
              🔑 Mot de passe
            </button>
            <button onClick={logout} style={{ padding: "10px 20px", backgroundColor: "transparent", color: COLORS.red, border: `1.5px solid ${COLORS.red}`, borderRadius: 6, cursor: "pointer", fontSize: 14, fontWeight: 600 }}>Déconnexion</button>
          </div>
        </div>

        <div style={{ marginTop: 20 }}>
          <NotificationsBanner hospitalId={null} />
        </div>

        {msg && (
          <div style={{
            padding: "13px 18px", marginTop: 20, borderRadius: 6, fontWeight: 500, fontSize: 14.5,
            backgroundColor: msg.startsWith("✅") ? COLORS.successBg : COLORS.dangerBg,
            color: msg.startsWith("✅") ? COLORS.successText : COLORS.dangerText,
          }}>{msg}</div>
        )}

        <div style={{ display: "flex", gap: 4, marginTop: 20, borderBottom: `2px solid ${COLORS.line}` }}>
          {["staff", "schedule", "reports"].map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              style={{
                padding: "13px 22px", border: "none", background: "none", cursor: "pointer",
                fontSize: 15, fontWeight: activeTab === tab ? 700 : 500,
                color: activeTab === tab ? COLORS.green : COLORS.slate,
                borderBottom: activeTab === tab ? `3px solid ${COLORS.green}` : "3px solid transparent",
                marginBottom: -2,
              }}>
              {tab === "staff" ? `Personnel (${staff.length})` : tab === "schedule" ? "🗓️ Planning" : "📊 Rapports"}
            </button>
          ))}
        </div>

        <div style={{ padding: "28px 0 50px 0" }}>
          {activeTab === "staff" && (
            <div>
              <h3 style={sectionHeadingStyle}>Personnel</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr", gap: 24, marginTop: 16 }}>
                <div>
                  {staff.length === 0 ? (
                    <div style={{ padding: 30, backgroundColor: COLORS.card, borderRadius: 10, textAlign: "center", color: COLORS.slate, border: `1.5px dashed ${COLORS.line}` }}>
                      Aucun membre du personnel pour l'instant.
                    </div>
                  ) : (
                    <div style={{ display: "grid", gap: 10 }}>
                      {staff.map((s) => (
                        <div key={s.id} style={{ padding: 16, backgroundColor: COLORS.card, borderRadius: 10, border: `1px solid ${COLORS.line}` }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                            <button onClick={() => openStaffSchedule(s)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
                              <div style={{ fontWeight: 700, color: COLORS.ink, fontSize: 15, textDecoration: "underline", textDecorationColor: COLORS.line }}>
                                {s.firstName} {s.lastName}
                              </div>
                              <div style={{ fontSize: 12, color: COLORS.slate, marginTop: 2 }}>{s.email}{s.disabled ? " · désactivé" : ""}</div>
                            </button>
                            <div style={{ display: "flex", gap: 6 }}>
                              <button onClick={() => toggleStaffDisabled(s.id, !s.disabled)} style={{ padding: "5px 10px", backgroundColor: s.disabled ? COLORS.green : "#6c757d", color: "white", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
                                {s.disabled ? "Réactiver" : "Désactiver"}
                              </button>
                              <button onClick={() => deleteStaffMember(s.id, `${s.firstName} ${s.lastName}`)} style={{ padding: "5px 10px", backgroundColor: COLORS.red, color: "white", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
                                Supprimer
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <p style={{ fontSize: 12, color: COLORS.slate, marginTop: 12 }}>Cliquez sur un nom pour voir son planning à venir.</p>
                </div>

                <div style={{ padding: 22, backgroundColor: COLORS.card, borderRadius: 10, border: `1px solid ${COLORS.line}`, borderTop: `4px solid ${COLORS.gold}`, alignSelf: "start" }}>
                  <div style={{ fontWeight: 700, color: COLORS.ink, marginBottom: 14, fontSize: 14.5 }}>Ajouter un membre du personnel</div>
                  <input placeholder="Prénom" value={newStaffForm.firstName} onChange={(e) => setNewStaffForm({ ...newStaffForm, firstName: e.target.value })} disabled={creatingStaff} style={fieldStyle} />
                  <input placeholder="Nom" value={newStaffForm.lastName} onChange={(e) => setNewStaffForm({ ...newStaffForm, lastName: e.target.value })} disabled={creatingStaff} style={fieldStyle} />
                  <input placeholder="Email" type="email" value={newStaffForm.email} onChange={(e) => setNewStaffForm({ ...newStaffForm, email: e.target.value })} disabled={creatingStaff} style={fieldStyle} />
                  <input placeholder="Mot de passe temporaire" value={newStaffForm.password} onChange={(e) => setNewStaffForm({ ...newStaffForm, password: e.target.value })} disabled={creatingStaff} style={fieldStyle} />
                  <button onClick={createStaffMember} disabled={creatingStaff} style={{ width: "100%", padding: 12, backgroundColor: COLORS.green, color: "white", border: "none", borderRadius: 6, cursor: creatingStaff ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 14, opacity: creatingStaff ? 0.7 : 1 }}>
                    {creatingStaff ? "Création…" : "+ Créer le compte"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === "schedule" && (
            <div>
              <h3 style={sectionHeadingStyle}>Planning — {facility.name}</h3>
              <p style={{ fontSize: 13, color: COLORS.slate, marginTop: -8, marginBottom: 18 }}>
                Choisissez Quotidien, Hebdomadaire ou Mensuel — le même horaire s'applique à tous les jours sélectionnés en une seule fois.
              </p>
              <input type="date" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} style={{ ...fieldStyle, width: 220, marginBottom: 20 }} />

              <div style={{ padding: 20, marginBottom: 24, backgroundColor: COLORS.card, borderRadius: 10, border: `1px solid ${COLORS.line}`, borderTop: `4px solid ${editingScheduleId ? "#2E5C8C" : COLORS.gold}` }}>
                <div style={{ fontWeight: 700, color: COLORS.ink, marginBottom: 14, fontSize: 14.5 }}>{editingScheduleId ? "Modifier l'horaire" : "Ajouter un horaire"}</div>

                {!editingScheduleId && (
                  <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                    {[{ key: "daily", label: "Quotidien" }, { key: "weekly", label: "Hebdomadaire" }, { key: "monthly", label: "Mensuel" }].map((opt) => (
                      <button key={opt.key} type="button" onClick={() => setShiftForm({ ...shiftForm, cadence: opt.key })}
                        style={{
                          padding: "8px 16px", borderRadius: 20, cursor: "pointer", fontSize: 13, fontWeight: 600,
                          border: `1px solid ${shiftForm.cadence === opt.key ? COLORS.green : COLORS.line}`,
                          backgroundColor: shiftForm.cadence === opt.key ? COLORS.green : "#fff",
                          color: shiftForm.cadence === opt.key ? "#fff" : COLORS.slate,
                        }}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}

                <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1.5fr", gap: 10, marginBottom: 12 }}>
                  <select value={shiftForm.staffId} onChange={(e) => setShiftForm({ ...shiftForm, staffId: e.target.value })} style={fieldStyle}>
                    <option value="">Sélectionner le personnel…</option>
                    {staff.map((s) => (<option key={s.id} value={s.id}>{s.firstName} {s.lastName}</option>))}
                  </select>
                  <input type="time" value={shiftForm.shiftStart} onChange={(e) => setShiftForm({ ...shiftForm, shiftStart: e.target.value })} style={fieldStyle} />
                  <input type="time" value={shiftForm.shiftEnd} onChange={(e) => setShiftForm({ ...shiftForm, shiftEnd: e.target.value })} style={fieldStyle} />
                  <input placeholder="Notes (optionnel)" value={shiftForm.notes} onChange={(e) => setShiftForm({ ...shiftForm, notes: e.target.value })} style={fieldStyle} />
                </div>

                {!editingScheduleId && (shiftForm.cadence === "weekly" || shiftForm.cadence === "monthly") && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: COLORS.slate, marginBottom: 6 }}>Répéter les jours suivants :</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {WEEKDAY_LABELS.map((label, i) => (
                        <button key={label} type="button" onClick={() => { const next = [...shiftForm.daysOfWeek]; next[i] = !next[i]; setShiftForm({ ...shiftForm, daysOfWeek: next }); }}
                          style={{
                            padding: "7px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12.5, fontWeight: 600,
                            border: `1px solid ${shiftForm.daysOfWeek[i] ? COLORS.green : COLORS.line}`,
                            backgroundColor: shiftForm.daysOfWeek[i] ? COLORS.successBg : "#fff",
                            color: shiftForm.daysOfWeek[i] ? COLORS.successText : COLORS.slate,
                          }}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={addShift} disabled={savingShift || staff.length === 0} style={{
                    padding: "10px 20px", backgroundColor: editingScheduleId ? "#2E5C8C" : COLORS.green, color: "white", border: "none",
                    borderRadius: 6, cursor: (savingShift || staff.length === 0) ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 13.5,
                    opacity: (savingShift || staff.length === 0) ? 0.7 : 1,
                  }}>
                    {savingShift ? "Enregistrement…" : editingScheduleId ? "Enregistrer les modifications" : "+ Ajouter"}
                  </button>
                  {editingScheduleId && (
                    <button onClick={cancelEditShift} style={{ padding: "10px 20px", backgroundColor: "transparent", color: COLORS.slate, border: `1px solid ${COLORS.line}`, borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13.5 }}>Annuler</button>
                  )}
                </div>
                {staff.length === 0 && <p style={{ fontSize: 12.5, color: COLORS.slate, marginTop: 10 }}>Aucun personnel pour l'instant.</p>}
              </div>

              {scheduleLoading ? (
                <p style={{ color: COLORS.slate, fontSize: 14 }}>Chargement…</p>
              ) : scheduleEntries.length === 0 ? (
                <div style={{ padding: 32, backgroundColor: COLORS.card, borderRadius: 10, textAlign: "center", color: COLORS.slate, border: `1.5px dashed ${COLORS.line}` }}>Aucun horaire pour cette date.</div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {scheduleEntries.map((s) => (
                    <div key={s.id} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10,
                      padding: "14px 18px", backgroundColor: editingScheduleId === s.id ? "#E8F0FB" : COLORS.card, borderRadius: 8,
                      border: `1px solid ${editingScheduleId === s.id ? "#2E5C8C" : COLORS.line}`,
                    }}>
                      <div>
                        <div style={{ fontWeight: 700, color: COLORS.ink, fontSize: 14.5 }}>{s.staffName}</div>
                        <div style={{ fontSize: 12.5, color: COLORS.slate, marginTop: 2 }}>{s.shiftStart} – {s.shiftEnd}{s.notes ? ` · ${s.notes}` : ""}</div>
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => startEditShift(s)} style={{ padding: "6px 12px", backgroundColor: "#2E5C8C", color: "white", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Modifier</button>
                        <button onClick={() => removeShift(s.id)} style={{ padding: "6px 12px", backgroundColor: COLORS.red, color: "white", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Supprimer</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "reports" && (
            <div>
              <h3 style={sectionHeadingStyle}>Rapports</h3>
              <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
                {[{ key: "day", label: "Jour" }, { key: "week", label: "7 derniers jours" }, { key: "month", label: "Mois en cours" }].map((opt) => (
                  <button key={opt.key} type="button" onClick={() => setReportPeriod(opt.key)}
                    style={{
                      padding: "8px 16px", borderRadius: 20, cursor: "pointer", fontSize: 13, fontWeight: 600,
                      border: `1px solid ${reportPeriod === opt.key ? COLORS.green : COLORS.line}`,
                      backgroundColor: reportPeriod === opt.key ? COLORS.green : "#fff",
                      color: reportPeriod === opt.key ? "#fff" : COLORS.slate,
                    }}>
                    {opt.label}
                  </button>
                ))}
              </div>

              {reportLoading ? (
                <p style={{ color: COLORS.slate, fontSize: 14 }}>Chargement…</p>
              ) : !reportData ? (
                <p style={{ color: COLORS.slate, fontSize: 14 }}>Aucune donnée.</p>
              ) : (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 26 }}>
                    <div style={{ padding: 20, backgroundColor: COLORS.card, borderRadius: 10, border: `1px solid ${COLORS.line}`, borderTop: `4px solid ${COLORS.gold}` }}>
                      <div style={{ fontSize: 12, color: COLORS.slate, textTransform: "uppercase", letterSpacing: "0.03em", fontWeight: 700 }}>
                        {userData.facilityType === "lab" ? "Demandes reçues" : "Ordonnances reçues"}
                      </div>
                      <div style={{ fontSize: 30, fontWeight: 700, color: COLORS.ink, marginTop: 6, fontFamily: FONT_DISPLAY }}>{reportData.received}</div>
                    </div>
                    <div style={{ padding: 20, backgroundColor: COLORS.card, borderRadius: 10, border: `1px solid ${COLORS.line}`, borderTop: `4px solid ${COLORS.green}` }}>
                      <div style={{ fontSize: 12, color: COLORS.slate, textTransform: "uppercase", letterSpacing: "0.03em", fontWeight: 700 }}>Complétées</div>
                      <div style={{ fontSize: 30, fontWeight: 700, color: COLORS.successText, marginTop: 6, fontFamily: FONT_DISPLAY }}>{reportData.completed}</div>
                    </div>
                    <div style={{ padding: 20, backgroundColor: COLORS.card, borderRadius: 10, border: `1px solid ${COLORS.line}`, borderTop: "4px solid #0F7A6E" }}>
                      <div style={{ fontSize: 12, color: COLORS.slate, textTransform: "uppercase", letterSpacing: "0.03em", fontWeight: 700 }}>Taux de complétion</div>
                      <div style={{ fontSize: 30, fontWeight: 700, color: "#0F7A6E", marginTop: 6, fontFamily: FONT_DISPLAY }}>
                        {reportData.received > 0 ? Math.round((reportData.completed / reportData.received) * 100) : 0}%
                      </div>
                    </div>
                  </div>

                  <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.slate, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.03em" }}>
                    {userData.facilityType === "lab" ? "Analyses les plus demandées" : "Médicaments les plus prescrits"}
                  </div>
                  {reportData.topMedications.length === 0 ? (
                    <p style={{ fontSize: 13.5, color: COLORS.slate }}>Aucune donnée pour cette période.</p>
                  ) : (
                    <div style={{ display: "grid", gap: 6 }}>
                      {reportData.topMedications.map((m, i) => (
                        <div key={m.name} style={{ display: "flex", justifyContent: "space-between", padding: "9px 14px", backgroundColor: COLORS.card, borderRadius: 8, border: `1px solid ${COLORS.line}`, fontSize: 13.5 }}>
                          <span><strong>{i + 1}.</strong> {m.name}</span>
                          <span style={{ color: COLORS.slate }}>{m.count} fois</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <div style={{ borderTop: `1px solid ${COLORS.line}`, padding: "18px 0", textAlign: "center", fontSize: 12.5, color: COLORS.slate }}>
          République du Mali — Ministère de la Santé · Système de gestion hospitalière
        </div>
      </div>

      {viewingStaffSchedule && (
        <div onClick={closeStaffSchedule} style={{ position: "fixed", inset: 0, backgroundColor: "rgba(27,42,31,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 1000 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: "#fff", borderRadius: 14, width: "min(520px, 100%)", maxHeight: "80vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.35)", borderTop: `6px solid ${COLORS.gold}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 26px 16px", borderBottom: `1px solid ${COLORS.line}` }}>
              <h2 style={{ margin: 0, fontFamily: FONT_DISPLAY, fontSize: 19, color: COLORS.ink }}>Planning — {viewingStaffSchedule.firstName} {viewingStaffSchedule.lastName}</h2>
              <button onClick={closeStaffSchedule} aria-label="Fermer" style={{ width: 34, height: 34, borderRadius: "50%", border: "none", backgroundColor: COLORS.paper, color: COLORS.ink, fontSize: 17, fontWeight: 700, cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ padding: "18px 26px 26px" }}>
              {staffScheduleLoading ? (
                <p style={{ color: COLORS.slate }}>Chargement…</p>
              ) : staffScheduleEntries.length === 0 ? (
                <p style={{ color: COLORS.slate, fontSize: 14 }}>Aucun horaire à venir.</p>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {staffScheduleEntries.map((s) => (
                    <div key={s.id} style={{ padding: "10px 14px", backgroundColor: COLORS.paper, borderRadius: 8, border: `1px solid ${COLORS.line}`, fontSize: 13.5 }}>
                      <strong>{new Date(s.date + "T00:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</strong> — {s.shiftStart}–{s.shiftEnd}{s.notes ? ` · ${s.notes}` : ""}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {showChangePassword && (
        <ChangePassword onClose={() => setShowChangePassword(false)} />
      )}
    </div>
  );
}

const fieldStyle = {
  width: "100%", padding: "10px 12px", marginBottom: 12, borderRadius: "6px",
  border: `1px solid ${COLORS.line}`, fontSize: 14, boxSizing: "border-box",
  fontFamily: FONT_BODY, color: COLORS.ink, backgroundColor: "#fff",
};
const sectionHeadingStyle = {
  color: COLORS.ink, fontFamily: FONT_DISPLAY, fontSize: 17, marginBottom: 4,
  borderLeft: `4px solid ${COLORS.gold}`, paddingLeft: 10,
};