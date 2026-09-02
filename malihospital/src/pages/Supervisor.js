import { useState, useEffect, useRef } from "react";
import ChangePassword from "./ChangePassword";
import SessionsButton from "../components/SessionsButton";
import { auth, db, functions } from "../firebase";
import { collection, doc, getDoc, getDocs, query, where, orderBy, limit, onSnapshot, updateDoc, deleteDoc, writeBatch, addDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import NotificationsBanner from "../components/NotificationsBanner";

const COLORS = {
  green: "#14B53A", gold: "#FCD116", red: "#CE1126", ink: "#1B2A1F",
  slate: "#5B6B63", paper: "#FAF9F5", card: "#FFFFFF", line: "#E6E2D8",
  successBg: "#E9F7EC", successText: "#1E7B34",
  dangerBg: "#FBEAEC", dangerText: "#A31221",
  warnBg: "#FDF3E3", warnText: "#8A5A00",
};
const FONT_DISPLAY = "'Georgia', 'Iowan Old Style', 'Times New Roman', serif";
const FONT_BODY = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

const PRIORITY_CONFIG = {
  emergency: { label: "Urgence", emoji: "🔴", color: "#A31221", bg: "#FBEAEC" },
  urgent:    { label: "Urgent",  emoji: "🟠", color: "#8A5A00", bg: "#FDF3E3" },
  normal:    { label: "Normal",  emoji: "🟢", color: "#1E7B34", bg: "#E9F7EC" },
};

const WEEKDAY_LABELS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

function formatDateLocal(d) {
  return d.toISOString().slice(0, 10);
}

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

export default function Supervisor() {
  const [userData, setUserData] = useState(null);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [hospitalName, setHospitalName] = useState("");
  const [pageLoading, setPageLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("queue");
  const [rooms, setRooms] = useState([]);
  const [beds, setBeds] = useState([]);
  const [newRoomForm, setNewRoomForm] = useState({ name: "", numberOfBeds: "1" });
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [editingBed, setEditingBed] = useState(null);
  const [scheduleDate, setScheduleDate] = useState(new Date().toISOString().slice(0, 10));
  const [scheduleEntries, setScheduleEntries] = useState([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [shiftForm, setShiftForm] = useState({
    staffId: "", shiftStart: "08:00", shiftEnd: "16:00", notes: "",
    cadence: "daily", // daily | weekly | monthly
    daysOfWeek: [true, true, true, true, true, true, true], // Dim..Sam, all on by default
  });
  const [editingScheduleId, setEditingScheduleId] = useState(null);
  const [viewingStaffSchedule, setViewingStaffSchedule] = useState(null); // the staff member object, or null
  const [staffScheduleEntries, setStaffScheduleEntries] = useState([]);
  const [staffScheduleLoading, setStaffScheduleLoading] = useState(false);
  const [savingShift, setSavingShift] = useState(false);
  const scheduleUnsubRef = useRef(null);
  const [tickets, setTickets] = useState([]);
  const [staff, setStaff] = useState([]);
  const [broadcastForm, setBroadcastForm] = useState({ title: "", message: "", severity: "info" });
  const [broadcasting, setBroadcasting] = useState(false);
  const [msg, setMsg] = useState("");
  const nav = useNavigate();
  const ticketsUnsubRef = useRef(null);
  const staffUnsubRef = useRef(null);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user) checkAuthAndLoad();
      else {
        if (ticketsUnsubRef.current) ticketsUnsubRef.current();
        if (staffUnsubRef.current) staffUnsubRef.current();
        nav("/");
      }
    });
    return () => {
      unsubscribe();
      if (ticketsUnsubRef.current) ticketsUnsubRef.current();
      if (staffUnsubRef.current) staffUnsubRef.current();
      if (scheduleUnsubRef.current) scheduleUnsubRef.current();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav]);

  const checkAuthAndLoad = async () => {
    if (!auth.currentUser) return nav("/");
    try {
      const userSnap = await getDoc(doc(db, "users", auth.currentUser.uid));
      if (!userSnap.exists()) {
        alert("❌ Données utilisateur introuvables.");
        await signOut(auth);
        nav("/");
        return;
      }
      const user = userSnap.data();
      if (user.disabled) {
        alert("❌ Votre compte a été désactivé.");
        await signOut(auth);
        nav("/");
        return;
      }
      if (user.role !== "supervisor") {
        alert("❌ Accès refusé. Cette page est réservée aux superviseurs de département.");
        await signOut(auth);
        nav("/");
        return;
      }
      if (!user.department || !user.hospitalId) {
        alert("❌ Votre compte n'a pas de département/hôpital assigné. Contactez l'administrateur.");
        setPageLoading(false);
        return;
      }
      const hospSnap = await getDoc(doc(db, "hospitals", user.hospitalId));
      if (!hospSnap.exists() || hospSnap.data().active === false) {
        alert("❌ Cet hôpital a été désactivé.");
        await signOut(auth);
        nav("/");
        return;
      }
      setHospitalName(hospSnap.data().name);
      setUserData(user);
      loadQueue(user);
      loadStaff(user);
      cleanupExpiredSchedulesLazy(user);
      setPageLoading(false);
    } catch (e) {
      console.error("Error loading:", e);
      alert("Erreur de chargement: " + e.message);
      setPageLoading(false);
    }
  };

  const loadQueue = (user) => {
    const q = query(
      collection(db, "tickets"),
      where("hospitalId", "==", user.hospitalId),
      where("department", "==", user.department)
    );
    ticketsUnsubRef.current = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      setTickets(list);
    }, (e) => console.error("Error loading queue:", e));
  };

  const loadStaff = (user) => {
    const q = query(
      collection(db, "users"),
      where("hospitalId", "==", user.hospitalId),
      where("department", "==", user.department)
    );
    staffUnsubRef.current = onSnapshot(q, (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((u) => u.role === "doctor" || u.role === "nurse");
      setStaff(list);
    }, (e) => console.error("Error loading staff:", e));
  };

  // Live-updates whenever the selected date changes, so the supervisor
  // sees the current state of a day's roster in real time (e.g. if they
  // have this page open in two tabs, or another supervisor covers for
  // them — though write access stays locked to this exact department).
  useEffect(() => {
    if (activeTab !== "beds" || !userData?.hospitalId || !userData?.department) return;
    getDocs(query(collection(db, "rooms"), where("hospitalId", "==", userData.hospitalId), where("department", "==", userData.department)))
      .then((snap) => setRooms(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
      .catch((e) => console.error("Error loading rooms:", e));
    const q = query(collection(db, "beds"), where("hospitalId", "==", userData.hospitalId), where("department", "==", userData.department));
    const unsub = onSnapshot(q, (snap) => {
      setBeds(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, (e) => console.error("Error loading beds:", e));
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, userData?.hospitalId, userData?.department]);

  const createRoom = async () => {
    const { name, numberOfBeds } = newRoomForm;
    if (!name.trim()) return setMsg("❌ Le nom de la chambre est obligatoire.");
    const count = parseInt(numberOfBeds, 10);
    if (!count || count < 1) return setMsg("❌ Le nombre de lits doit être au moins 1.");

    setCreatingRoom(true);
    setMsg("");
    try {
      const roomRef = doc(collection(db, "rooms"));
      const batch = writeBatch(db);
      batch.set(roomRef, {
        hospitalId: userData.hospitalId,
        department: userData.department,
        name: name.trim(),
        numberOfBeds: count,
        createdAt: new Date().toISOString(),
        createdBy: auth.currentUser.uid,
      });
      for (let i = 1; i <= count; i++) {
        const bedRef = doc(collection(db, "beds"));
        batch.set(bedRef, {
          hospitalId: userData.hospitalId,
          department: userData.department,
          roomId: roomRef.id,
          roomName: name.trim(),
          bedNumber: `Lit ${i}`,
          status: "available",
          patientName: null,
          updatedAt: new Date().toISOString(),
          updatedBy: auth.currentUser.uid,
        });
      }
      await batch.commit();
      setMsg(`✅ ${name.trim()} créée avec ${count} lit${count > 1 ? "s" : ""}.`);
      setNewRoomForm({ name: "", numberOfBeds: "1" });
      const snap = await getDocs(query(collection(db, "rooms"), where("hospitalId", "==", userData.hospitalId), where("department", "==", userData.department)));
      setRooms(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      setMsg("❌ Erreur: " + e.message);
    }
    setCreatingRoom(false);
  };

  const addBedToRoom = async (room) => {
    try {
      const existingCount = beds.filter((b) => b.roomId === room.id).length;
      await addDoc(collection(db, "beds"), {
        hospitalId: userData.hospitalId,
        department: userData.department,
        roomId: room.id,
        roomName: room.name,
        bedNumber: `Lit ${existingCount + 1}`,
        status: "available",
        patientName: null,
        updatedAt: new Date().toISOString(),
        updatedBy: auth.currentUser.uid,
      });
      await updateDoc(doc(db, "rooms", room.id), { numberOfBeds: existingCount + 1 });
    } catch (e) {
      setMsg("❌ Erreur: " + e.message);
    }
  };

  const deleteRoom = async (room) => {
    if (!window.confirm(`Supprimer "${room.name}" et ses ${room.numberOfBeds} lit(s) ?`)) return;
    try {
      const roomBeds = beds.filter((b) => b.roomId === room.id);
      const batch = writeBatch(db);
      roomBeds.forEach((b) => batch.delete(doc(db, "beds", b.id)));
      batch.delete(doc(db, "rooms", room.id));
      await batch.commit();
      setRooms((prev) => prev.filter((r) => r.id !== room.id));
    } catch (e) {
      setMsg("❌ Erreur: " + e.message);
    }
  };

  const deleteBed = async (bed) => {
    if (!window.confirm(`Supprimer "${bed.bedNumber}" de ${bed.roomName} ?`)) return;
    try {
      await deleteDoc(doc(db, "beds", bed.id));
      const room = rooms.find((r) => r.id === bed.roomId);
      if (room) await updateDoc(doc(db, "rooms", room.id), { numberOfBeds: Math.max(0, room.numberOfBeds - 1) });
    } catch (e) {
      setMsg("❌ Erreur: " + e.message);
    }
  };

  const updateBedStatus = async (bed, status, patientName) => {
    try {
      await updateDoc(doc(db, "beds", bed.id), {
        status,
        patientName: status === "available" ? null : (patientName || bed.patientName || null),
        updatedAt: new Date().toISOString(),
        updatedBy: auth.currentUser.uid,
      });
      setEditingBed(null);
    } catch (e) {
      setMsg("❌ Erreur: " + e.message);
    }
  };

  // Live-updates whenever the selected date changes, so the supervisor
  // sees the current state of a day's roster in real time (e.g. if they
  // have this page open in two tabs, or another supervisor covers for
  // them — though write access stays locked to this exact department).
  useEffect(() => {
    if (!userData?.hospitalId || !userData?.department) return;
    if (scheduleUnsubRef.current) scheduleUnsubRef.current();
    setScheduleLoading(true);
    const q = query(
      collection(db, "schedules"),
      where("hospitalId", "==", userData.hospitalId),
      where("department", "==", userData.department),
      where("date", "==", scheduleDate)
    );
    scheduleUnsubRef.current = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => (a.shiftStart || "").localeCompare(b.shiftStart || ""));
      setScheduleEntries(list);
      setScheduleLoading(false);
    }, (e) => {
      console.error("Error loading schedule:", e);
      setScheduleLoading(false);
    });
    return () => { if (scheduleUnsubRef.current) scheduleUnsubRef.current(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userData?.hospitalId, userData?.department, scheduleDate]);

  // Auto-expiry without a scheduled Cloud Function (see conversation notes
  // — the v2 scheduler trigger crashes every function's shared container in
  // this environment). Runs opportunistically whenever a supervisor's
  // dashboard loads: deletes their OWN department's past-dated schedule
  // entries once they've aged past the retention window for whatever
  // cadence created them (daily=24h, weekly=7d, monthly=30d after the
  // entry's own date).
  // Honest limitation: a department nobody visits for a while just
  // accumulates old entries until someone does — there's no background
  // job. Best-effort and silent on failure; this must never block the
  // actual dashboard from loading.
  const RETENTION_DAYS = { daily: 1, weekly: 7, monthly: 30 };
  const cleanupExpiredSchedulesLazy = async (user) => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const q = query(
        collection(db, "schedules"),
        where("hospitalId", "==", user.hospitalId),
        where("department", "==", user.department),
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
      console.log(`Cleaned up ${toDelete.length} expired schedule entr${toDelete.length === 1 ? "y" : "ies"}.`);
    } catch (e) {
      // Never let cleanup failure disrupt the actual dashboard.
      console.warn("Lazy schedule cleanup skipped:", e);
    }
  };

  const emptyShiftForm = () => ({
    staffId: "", shiftStart: "08:00", shiftEnd: "16:00", notes: "",
    cadence: "daily", daysOfWeek: [true, true, true, true, true, true, true],
  });

  // Generates the list of dates a bulk shift-creation should cover, based
  // on the chosen cadence and the day-of-week filter — daily is just the
  // one selected date; weekly is the 7 days starting there; monthly is
  // every day in that date's calendar month. Days unchecked in
  // daysOfWeek are skipped (e.g. excluding weekends).
  const computeShiftDates = () => {
    const start = new Date(scheduleDate + "T00:00:00");
    const dates = [];
    if (shiftForm.cadence === "daily") {
      dates.push(new Date(start));
    } else if (shiftForm.cadence === "weekly") {
      for (let i = 0; i < 7; i++) {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        dates.push(d);
      }
    } else if (shiftForm.cadence === "monthly") {
      const year = start.getFullYear();
      const month = start.getMonth();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      for (let day = 1; day <= daysInMonth; day++) {
        dates.push(new Date(year, month, day));
      }
    }
    return dates.filter((d) => shiftForm.daysOfWeek[d.getDay()]);
  };

  const startEditShift = (entry) => {
    setEditingScheduleId(entry.id);
    setShiftForm({
      staffId: entry.staffId, shiftStart: entry.shiftStart, shiftEnd: entry.shiftEnd, notes: entry.notes || "",
      cadence: "daily", daysOfWeek: [true, true, true, true, true, true, true], // editing always touches just this one date
    });
  };

  const cancelEditShift = () => {
    setEditingScheduleId(null);
    setShiftForm(emptyShiftForm());
  };

  const openStaffSchedule = (staffMember) => {
    setViewingStaffSchedule(staffMember);
    setStaffScheduleLoading(true);
    const today = new Date().toISOString().slice(0, 10);
    const q = query(
      collection(db, "schedules"),
      where("hospitalId", "==", userData.hospitalId),
      where("department", "==", userData.department),
      where("date", ">=", today),
      orderBy("date"),
      limit(100)
    );
    getDocs(q)
      .then((snap) => {
        const theirs = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((s) => s.staffId === staffMember.id);
        setStaffScheduleEntries(theirs);
      })
      .catch((e) => console.error("Error loading staff schedule:", e))
      .finally(() => setStaffScheduleLoading(false));
  };

  const closeStaffSchedule = () => {
    setViewingStaffSchedule(null);
    setStaffScheduleEntries([]);
  };

  const notifyStaffOfSchedule = async (staffId, summary) => {
    try {
      const call = httpsCallable(functions, "broadcastNotification");
      await call({
        targetUserId: staffId,
        title: "🗓️ Planning mis à jour",
        message: summary,
        severity: "info",
      });
    } catch (e) {
      // Non-fatal — the schedule itself already saved successfully; a
      // failed notification shouldn't be reported as if the whole action failed.
      console.warn("Could not notify staff of schedule change:", e);
    }
  };

  const addShift = async () => {
    if (!shiftForm.staffId) {
      setMsg("❌ Veuillez sélectionner un membre du personnel.");
      return;
    }
    if (!shiftForm.shiftStart || !shiftForm.shiftEnd) {
      setMsg("❌ Veuillez indiquer l'heure de début et de fin.");
      return;
    }
    const staffMember = staff.find((s) => s.id === shiftForm.staffId);
    const staffName = staffMember ? `${staffMember.role === "doctor" ? "Dr. " : ""}${staffMember.firstName} ${staffMember.lastName}` : "—";
    setSavingShift(true);
    setMsg("");

    try {
      if (editingScheduleId) {
        // Editing an existing single entry in place — "modify the schedule",
        // not creating a duplicate.
        const existing = scheduleEntries.find((s) => s.id === editingScheduleId);
        await updateDoc(doc(db, "schedules", editingScheduleId), {
          staffId: shiftForm.staffId,
          staffName,
          staffRole: staffMember?.role || "",
          shiftStart: shiftForm.shiftStart,
          shiftEnd: shiftForm.shiftEnd,
          notes: shiftForm.notes || "",
          updatedAt: new Date().toISOString(),
          updatedBy: auth.currentUser.uid,
        });
        setMsg("✅ Horaire modifié.");
        setEditingScheduleId(null);
        await notifyStaffOfSchedule(
          shiftForm.staffId,
          `Votre horaire du ${new Date((existing?.date || scheduleDate) + "T00:00:00").toLocaleDateString("fr-FR")} a été modifié : ${shiftForm.shiftStart} – ${shiftForm.shiftEnd}.`
        );
      } else {
        const dates = computeShiftDates();
        if (dates.length === 0) {
          setMsg("❌ Aucun jour sélectionné — cochez au moins un jour de la semaine.");
          setSavingShift(false);
          return;
        }
        // Batched write: either every shift in this daily/weekly/monthly
        // set gets created, or none do — no risk of a bulk "set the whole
        // month" action leaving a half-finished roster if something fails
        // partway through. 500 ops is Firestore's batch cap; a month is
        // at most 31, so this never gets close.
        const batch = writeBatch(db);
        dates.forEach((d) => {
          const ref = doc(collection(db, "schedules"));
          batch.set(ref, {
            hospitalId: userData.hospitalId,
            department: userData.department,
            date: formatDateLocal(d),
            staffId: shiftForm.staffId,
            staffName,
            staffRole: staffMember?.role || "",
            shiftStart: shiftForm.shiftStart,
            shiftEnd: shiftForm.shiftEnd,
            notes: shiftForm.notes || "",
            // Persisted so the scheduled cleanup function knows which
            // retention window applies to this specific entry — daily
            // (24h), weekly (7 days), or monthly (30 days) after its date.
            cadence: shiftForm.cadence,
            createdAt: new Date().toISOString(),
            createdBy: auth.currentUser.uid,
            createdByName: `${userData.firstName} ${userData.lastName}`,
          });
        });
        await batch.commit();
        const label = shiftForm.cadence === "daily" ? "1 jour" : shiftForm.cadence === "weekly" ? `${dates.length} jour(s) sur 7` : `${dates.length} jour(s) du mois`;
        setMsg(`✅ Horaire créé pour ${label}.`);
        const firstDate = dates[0], lastDate = dates[dates.length - 1];
        const rangeLabel = dates.length === 1
          ? new Date(firstDate).toLocaleDateString("fr-FR")
          : `${new Date(firstDate).toLocaleDateString("fr-FR")} → ${new Date(lastDate).toLocaleDateString("fr-FR")}`;
        await notifyStaffOfSchedule(
          shiftForm.staffId,
          `Votre horaire a été défini pour ${rangeLabel} : ${shiftForm.shiftStart} – ${shiftForm.shiftEnd} (${dates.length} jour(s)).`
        );
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

  const sendBroadcast = async () => {
    if (!broadcastForm.title.trim() || !broadcastForm.message.trim()) {
      setMsg("❌ Le titre et le message sont obligatoires.");
      return;
    }
    setBroadcasting(true);
    setMsg("");
    try {
      const call = httpsCallable(functions, "broadcastNotification");
      // No hospitalId/department params — the Cloud Function locks a
      // supervisor's broadcast to their own department automatically,
      // using their profile, not anything the client could tamper with.
      await call({ title: broadcastForm.title.trim(), message: broadcastForm.message.trim(), severity: broadcastForm.severity });
      setMsg("✅ Annonce diffusée à votre département.");
      setBroadcastForm({ title: "", message: "", severity: "info" });
    } catch (e) {
      setMsg("❌ Erreur: " + (e.message || "Une erreur est survenue."));
    }
    setBroadcasting(false);
  };

  const logout = async () => { await signOut(auth); nav("/"); };

  if (pageLoading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16, backgroundColor: COLORS.paper, fontFamily: FONT_BODY }}>
        <MaliFlag width={56} height={38} />
        <div style={{ fontSize: 16, color: COLORS.slate }}>Chargement…</div>
      </div>
    );
  }

  if (!userData?.department || !userData?.hospitalId) {
    return (
      <div style={{ minHeight: "100vh", background: COLORS.paper, padding: 30, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_BODY }}>
        <div style={{ padding: 32, maxWidth: 480, backgroundColor: COLORS.card, border: `1px solid ${COLORS.line}`, borderTop: `4px solid ${COLORS.red}`, borderRadius: 10, textAlign: "center" }}>
          <MaliFlag width={48} height={33} style={{ margin: "0 auto 16px" }} />
          <h2 style={{ color: COLORS.ink, fontFamily: FONT_DISPLAY, fontSize: 19, marginBottom: 8 }}>Configuration requise</h2>
          <p style={{ color: COLORS.slate, fontSize: 14.5, lineHeight: 1.6 }}>Votre compte n'a pas de département/hôpital assigné.</p>
          <button onClick={logout} style={{ marginTop: 16, padding: "10px 22px", backgroundColor: COLORS.red, color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 14.5, fontWeight: 700 }}>
            Déconnexion
          </button>
        </div>
      </div>
    );
  }

  const activeQueueCount = tickets.filter((t) => ["waiting", "ready", "in-progress"].includes(t.status)).length;
  const completedCount = tickets.filter((t) => t.status === "completed").length;

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
              <div style={{ fontFamily: FONT_DISPLAY, fontStyle: "italic", fontSize: 11, color: COLORS.slate, marginTop: 1 }}>Un Peuple — Un But — Une Foi</div>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 21, fontWeight: 700, color: COLORS.ink, marginTop: 6 }}>Ministère de la Santé</div>
              <div style={{ fontSize: 13.5, color: COLORS.slate, marginTop: 4 }}>
                {hospitalName} <span style={{ color: COLORS.line }}>·</span> {userData.department} <span style={{ color: COLORS.line }}>·</span> Superviseur
              </div>
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
            <button onClick={logout} style={{ padding: "10px 20px", backgroundColor: "transparent", color: COLORS.red, border: `1.5px solid ${COLORS.red}`, borderRadius: 6, cursor: "pointer", fontSize: 14, fontWeight: 600 }}>
              Déconnexion
            </button>
          </div>
        </div>

        <div style={{ marginTop: 20 }}>
          <NotificationsBanner hospitalId={userData.hospitalId} department={userData.department} />
        </div>

        {msg && (
          <div style={{
            padding: "13px 18px", marginBottom: 20, borderRadius: 6, fontWeight: 500, fontSize: 14.5,
            backgroundColor: msg.startsWith("✅") ? COLORS.successBg : COLORS.dangerBg,
            color: msg.startsWith("✅") ? COLORS.successText : COLORS.dangerText,
          }}>
            {msg}
          </div>
        )}

        <div style={{ display: "flex", gap: 4, marginTop: 4, borderBottom: `2px solid ${COLORS.line}` }}>
          {["queue", "staff", "beds", "schedule", "announce"].map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              style={{
                padding: "13px 22px", border: "none", background: "none", cursor: "pointer",
                fontSize: 15, fontWeight: activeTab === tab ? 700 : 500,
                color: activeTab === tab ? COLORS.green : COLORS.slate,
                borderBottom: activeTab === tab ? `3px solid ${COLORS.green}` : "3px solid transparent",
                marginBottom: -2,
              }}>
              {tab === "queue" ? `File d'attente (${activeQueueCount})` : tab === "staff" ? `Personnel (${staff.length})` : tab === "beds" ? "🛏️ Lits" : tab === "schedule" ? "🗓️ Planning" : "📢 Annonce"}
            </button>
          ))}
        </div>

        <div style={{ padding: "28px 0 50px 0" }}>
          {activeTab === "queue" && (
            <div>
              <h3 style={sectionHeadingStyle}>File d'attente — {userData.department}</h3>
              <p style={{ fontSize: 13, color: COLORS.slate, marginTop: -8, marginBottom: 16 }}>
                Vue en lecture seule — {completedCount} consultation(s) complétée(s) aujourd'hui et avant.
              </p>
              {tickets.length === 0 ? (
                <div style={{ padding: 40, backgroundColor: COLORS.card, borderRadius: 10, textAlign: "center", color: COLORS.slate, border: `1.5px dashed ${COLORS.line}` }}>
                  Aucun ticket pour ce département.
                </div>
              ) : (
                <div style={{ overflowX: "auto", border: `1px solid ${COLORS.line}`, borderRadius: 10 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", backgroundColor: COLORS.card }}>
                    <thead>
                      <tr style={{ backgroundColor: COLORS.ink, color: "white" }}>
                        {["Priorité", "Ticket #", "Patient", "Statut", "Créé le"].map((h) => (
                          <th key={h} style={{ padding: "14px 16px", textAlign: "left", fontSize: 12.5, textTransform: "uppercase" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tickets.slice(0, 100).map((t) => {
                        const p = PRIORITY_CONFIG[t.priority] || PRIORITY_CONFIG.normal;
                        return (
                          <tr key={t.id} style={{ borderBottom: `1px solid ${COLORS.line}`, borderLeft: `4px solid ${p.color}` }}>
                            <td style={{ padding: "12px 16px" }}>
                              <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11.5, fontWeight: 700, color: p.color, backgroundColor: p.bg }}>{p.emoji} {p.label}</span>
                            </td>
                            <td style={{ padding: "12px 16px", fontWeight: 700, color: COLORS.ink }}>{t.ticketNumber}</td>
                            <td style={{ padding: "12px 16px" }}>{t.patientName}</td>
                            <td style={{ padding: "12px 16px" }}>
                              {t.status === "waiting" ? "🩺 Attente triage" : t.status === "ready" ? "Prêt pour médecin" : t.status === "in-progress" ? "En cours" : t.status === "completed" ? "Complété" : t.status === "no-show" ? "Non présenté" : t.status}
                            </td>
                            <td style={{ padding: "12px 16px", fontSize: 12.5, color: COLORS.slate }}>{new Date(t.createdAt).toLocaleString("fr-FR")}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === "staff" && (
            <div>
              <h3 style={sectionHeadingStyle}>Personnel — {userData.department}</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14, marginTop: 16 }}>
                {staff.length === 0 ? (
                  <div style={{ padding: 40, backgroundColor: COLORS.card, borderRadius: 10, textAlign: "center", color: COLORS.slate, border: `1.5px dashed ${COLORS.line}`, gridColumn: "1 / -1" }}>
                    Aucun médecin ou infirmier·ère dans ce département.
                  </div>
                ) : staff.map((s) => (
                  <div key={s.id} style={{ padding: 18, backgroundColor: COLORS.card, borderRadius: 10, border: `1px solid ${COLORS.line}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <button
                          onClick={() => openStaffSchedule(s)}
                          title="Voir le planning"
                          style={{
                            background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left",
                            fontWeight: 700, color: "#2E5C8C", fontSize: 15, textDecoration: "underline", textDecorationStyle: "dotted",
                          }}
                        >
                          {s.role === "doctor" ? "Dr. " : ""}{s.firstName} {s.lastName}
                        </button>
                        <div style={{ fontSize: 12.5, color: COLORS.slate, marginTop: 3 }}>{s.role === "doctor" ? "Médecin" : "Infirmier·ère"}{s.room ? ` · Chambre ${s.room}` : ""}</div>
                      </div>
                      {s.role === "doctor" && (
                        <span style={{
                          padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                          backgroundColor: s.online ? COLORS.successBg : "#EDECE7",
                          color: s.online ? COLORS.successText : COLORS.slate,
                        }}>
                          {s.online ? "● Actif" : "○ Hors ligne"}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: s.disabled ? COLORS.dangerText : COLORS.slate, marginTop: 8 }}>
                      {s.disabled ? "Compte désactivé" : `Dernière connexion : ${s.lastLoginAt ? new Date(s.lastLoginAt).toLocaleString("fr-FR") : "—"}`}
                    </div>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 12.5, color: COLORS.slate, marginTop: 16 }}>
                Créer, modifier ou désactiver des comptes reste réservé à l'administrateur de l'hôpital. Pour les horaires, voir l'onglet 🗓️ Planning.
              </p>
            </div>
          )}

          {activeTab === "beds" && (
            <div>
              <h2 style={{ color: COLORS.ink, margin: "0 0 4px 0", fontFamily: FONT_DISPLAY, fontSize: 22 }}>Gestion des lits — {userData.department}</h2>
              <p style={{ color: COLORS.slate, fontSize: 13, marginTop: 0, marginBottom: 20 }}>
                Une chambre peut contenir plusieurs lits. Ceci ne montre que les chambres de votre propre département.
              </p>

              {(() => {
                const total = beds.length;
                const available = beds.filter((b) => b.status === "available").length;
                const occupied = beds.filter((b) => b.status === "occupied").length;
                const assigned = beds.filter((b) => b.status === "assigned").length;
                return (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 24 }}>
                    <StatCard label="Total des lits" value={total} accent={COLORS.ink} />
                    <StatCard label="Disponibles" value={available} accent={COLORS.successText} />
                    <StatCard label="Assignés" value={assigned} accent="#8A5A00" />
                    <StatCard label="Occupés" value={occupied} accent={COLORS.red} />
                  </div>
                );
              })()}

              <div style={{ padding: 20, marginBottom: 26, backgroundColor: COLORS.card, borderRadius: 10, border: `1px solid ${COLORS.line}`, borderTop: `4px solid ${COLORS.gold}` }}>
                <div style={{ fontWeight: 700, color: COLORS.ink, marginBottom: 14, fontSize: 14.5 }}>Créer une chambre</div>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto", gap: 10 }}>
                  <input placeholder="Nom de la chambre (ex: Chambre 12)" value={newRoomForm.name} onChange={(e) => setNewRoomForm({ ...newRoomForm, name: e.target.value })} disabled={creatingRoom} style={{ padding: "10px 14px", borderRadius: 6, border: `1px solid ${COLORS.line}`, fontSize: 14, boxSizing: "border-box" }} />
                  <input type="number" min="1" placeholder="Nb. de lits" value={newRoomForm.numberOfBeds} onChange={(e) => setNewRoomForm({ ...newRoomForm, numberOfBeds: e.target.value })} disabled={creatingRoom} style={{ padding: "10px 14px", borderRadius: 6, border: `1px solid ${COLORS.line}`, fontSize: 14, boxSizing: "border-box" }} />
                  <button onClick={createRoom} disabled={creatingRoom} style={{
                    padding: "10px 20px", backgroundColor: COLORS.green, color: "white", border: "none",
                    borderRadius: 6, cursor: creatingRoom ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 13.5,
                    opacity: creatingRoom ? 0.7 : 1, whiteSpace: "nowrap",
                  }}>
                    {creatingRoom ? "Création…" : "+ Créer"}
                  </button>
                </div>
              </div>

              {rooms.length === 0 ? (
                <div style={{ padding: 40, backgroundColor: COLORS.card, borderRadius: 10, textAlign: "center", color: COLORS.slate, border: `1.5px dashed ${COLORS.line}` }}>
                  Aucune chambre créée pour l'instant.
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
                  {rooms.map((room) => {
                    const roomBeds = beds.filter((b) => b.roomId === room.id).sort((a, b) => a.bedNumber.localeCompare(b.bedNumber, undefined, { numeric: true }));
                    return (
                      <div key={room.id} style={{ padding: 16, backgroundColor: COLORS.card, borderRadius: 10, border: `1px solid ${COLORS.line}` }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                          <div style={{ fontWeight: 700, color: COLORS.ink, fontSize: 15 }}>{room.name}</div>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={() => addBedToRoom(room)} title="Ajouter un lit" style={{ padding: "3px 9px", backgroundColor: "#2E5C8C", color: "white", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>+ Lit</button>
                            <button onClick={() => deleteRoom(room)} title="Supprimer la chambre" style={{ padding: "3px 9px", backgroundColor: COLORS.red, color: "white", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>✕</button>
                          </div>
                        </div>
                        <div style={{ display: "grid", gap: 6 }}>
                          {roomBeds.map((bed) => {
                            const statusColors = {
                              available: { bg: COLORS.successBg, text: COLORS.successText, label: "Disponible" },
                              assigned: { bg: "#FDF3E3", text: "#8A5A00", label: "Assigné" },
                              occupied: { bg: COLORS.dangerBg, text: COLORS.dangerText, label: "Occupé" },
                            };
                            const sc = statusColors[bed.status] || statusColors.available;
                            const isEditing = editingBed === bed.id;
                            return (
                              <div key={bed.id} style={{ padding: "8px 10px", backgroundColor: COLORS.paper, borderRadius: 6, border: `1px solid ${COLORS.line}` }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                  <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink }}>
                                    {bed.bedNumber}{bed.patientName && ` — ${bed.patientName}`}
                                  </div>
                                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                                    <span style={{ padding: "2px 8px", borderRadius: 20, fontSize: 10.5, fontWeight: 700, backgroundColor: sc.bg, color: sc.text }}>{sc.label}</span>
                                    <button onClick={() => setEditingBed(isEditing ? null : bed.id)} style={{ padding: "2px 7px", backgroundColor: "transparent", border: `1px solid ${COLORS.line}`, borderRadius: 5, cursor: "pointer", fontSize: 11 }}>✎</button>
                                    <button onClick={() => deleteBed(bed)} style={{ padding: "2px 7px", backgroundColor: "transparent", border: `1px solid ${COLORS.line}`, borderRadius: 5, cursor: "pointer", fontSize: 11, color: COLORS.dangerText }}>✕</button>
                                  </div>
                                </div>
                                {isEditing && (
                                  <BedStatusEditor bed={bed} onSave={updateBedStatus} onCancel={() => setEditingBed(null)} colors={COLORS} />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === "schedule" && (
            <div>
              <h3 style={sectionHeadingStyle}>Planning — {userData.department}</h3>
              <p style={{ fontSize: 13, color: COLORS.slate, marginTop: -8, marginBottom: 18 }}>
                Choisissez une date pour voir les horaires de ce jour-là. Pour créer un horaire, choisissez
                Quotidien (juste cette date), Hebdomadaire (7 jours à partir de cette date) ou Mensuel (tout le mois
                de cette date) — le même horaire sera appliqué à tous les jours sélectionnés en une seule fois.
              </p>

              <input
                type="date"
                value={scheduleDate}
                onChange={(e) => setScheduleDate(e.target.value)}
                style={{ ...fieldStyle, width: 220, marginBottom: 20 }}
              />

              <div style={{
                padding: 20, marginBottom: 24, backgroundColor: COLORS.card, borderRadius: 10,
                border: `1px solid ${COLORS.line}`, borderTop: `4px solid ${editingScheduleId ? "#2E5C8C" : COLORS.gold}`,
              }}>
                <div style={{ fontWeight: 700, color: COLORS.ink, marginBottom: 14, fontSize: 14.5 }}>
                  {editingScheduleId ? "Modifier l'horaire" : "Ajouter un horaire"}
                </div>

                {!editingScheduleId && (
                  <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                    {[
                      { key: "daily", label: "Quotidien" },
                      { key: "weekly", label: "Hebdomadaire" },
                      { key: "monthly", label: "Mensuel" },
                    ].map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setShiftForm({ ...shiftForm, cadence: opt.key })}
                        style={{
                          padding: "8px 16px", borderRadius: 20, cursor: "pointer", fontSize: 13, fontWeight: 600,
                          border: `1px solid ${shiftForm.cadence === opt.key ? COLORS.green : COLORS.line}`,
                          backgroundColor: shiftForm.cadence === opt.key ? COLORS.green : "#fff",
                          color: shiftForm.cadence === opt.key ? "#fff" : COLORS.slate,
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}

                <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1.5fr", gap: 10, marginBottom: 12 }}>
                  <select value={shiftForm.staffId} onChange={(e) => setShiftForm({ ...shiftForm, staffId: e.target.value })} style={fieldStyle}>
                    <option value="">Sélectionner le personnel…</option>
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>{s.role === "doctor" ? "Dr. " : ""}{s.firstName} {s.lastName}</option>
                    ))}
                  </select>
                  <input type="time" value={shiftForm.shiftStart} onChange={(e) => setShiftForm({ ...shiftForm, shiftStart: e.target.value })} style={fieldStyle} />
                  <input type="time" value={shiftForm.shiftEnd} onChange={(e) => setShiftForm({ ...shiftForm, shiftEnd: e.target.value })} style={fieldStyle} />
                  <input placeholder="Notes (optionnel)" value={shiftForm.notes} onChange={(e) => setShiftForm({ ...shiftForm, notes: e.target.value })} style={fieldStyle} />
                </div>

                {!editingScheduleId && (shiftForm.cadence === "weekly" || shiftForm.cadence === "monthly") && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: COLORS.slate, marginBottom: 6 }}>
                      Répéter les jours suivants :
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {WEEKDAY_LABELS.map((label, i) => (
                        <button
                          key={label}
                          type="button"
                          onClick={() => {
                            const next = [...shiftForm.daysOfWeek];
                            next[i] = !next[i];
                            setShiftForm({ ...shiftForm, daysOfWeek: next });
                          }}
                          style={{
                            padding: "7px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12.5, fontWeight: 600,
                            border: `1px solid ${shiftForm.daysOfWeek[i] ? COLORS.green : COLORS.line}`,
                            backgroundColor: shiftForm.daysOfWeek[i] ? COLORS.successBg : "#fff",
                            color: shiftForm.daysOfWeek[i] ? COLORS.successText : COLORS.slate,
                          }}
                        >
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
                    <button onClick={cancelEditShift} style={{ padding: "10px 20px", backgroundColor: "transparent", color: COLORS.slate, border: `1px solid ${COLORS.line}`, borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13.5 }}>
                      Annuler
                    </button>
                  )}
                </div>
                {staff.length === 0 && (
                  <p style={{ fontSize: 12.5, color: COLORS.slate, marginTop: 10 }}>Aucun médecin ou infirmier·ère dans ce département pour l'instant.</p>
                )}
              </div>

              {scheduleLoading ? (
                <p style={{ color: COLORS.slate, fontSize: 14 }}>Chargement…</p>
              ) : scheduleEntries.length === 0 ? (
                <div style={{ padding: 32, backgroundColor: COLORS.card, borderRadius: 10, textAlign: "center", color: COLORS.slate, border: `1.5px dashed ${COLORS.line}` }}>
                  Aucun horaire pour cette date.
                </div>
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
                        <div style={{ fontSize: 12.5, color: COLORS.slate, marginTop: 2 }}>
                          {s.shiftStart} – {s.shiftEnd}{s.notes ? ` · ${s.notes}` : ""}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => startEditShift(s)} style={{ padding: "6px 12px", backgroundColor: "#2E5C8C", color: "white", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                          Modifier
                        </button>
                        <button onClick={() => removeShift(s.id)} style={{ padding: "6px 12px", backgroundColor: COLORS.red, color: "white", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                          Supprimer
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "announce" && (
            <div style={{ maxWidth: 560 }}>
              <h3 style={sectionHeadingStyle}>Annonce au département</h3>
              <p style={{ fontSize: 13, color: COLORS.slate, marginBottom: 18 }}>
                Visible uniquement par le personnel de {userData.department} — pas le reste de l'hôpital.
              </p>
              <div style={{ padding: 22, backgroundColor: COLORS.card, borderRadius: 10, border: `1px solid ${COLORS.line}`, borderTop: `4px solid ${COLORS.gold}` }}>
                <input placeholder="Titre" value={broadcastForm.title} onChange={(e) => setBroadcastForm({ ...broadcastForm, title: e.target.value })} disabled={broadcasting} style={fieldStyle} />
                <textarea placeholder="Message" value={broadcastForm.message} onChange={(e) => setBroadcastForm({ ...broadcastForm, message: e.target.value })} disabled={broadcasting} style={{ ...fieldStyle, minHeight: 90 }} />
                <select value={broadcastForm.severity} onChange={(e) => setBroadcastForm({ ...broadcastForm, severity: e.target.value })} disabled={broadcasting} style={fieldStyle}>
                  <option value="info">ℹ️ Information</option>
                  <option value="warning">⚠️ Avertissement</option>
                  <option value="urgent">🚨 Urgent</option>
                </select>
                <button onClick={sendBroadcast} disabled={broadcasting} style={{
                  width: "100%", padding: 13, backgroundColor: COLORS.green, color: "white", border: "none",
                  borderRadius: 6, cursor: broadcasting ? "not-allowed" : "pointer", fontSize: 14.5, fontWeight: 700,
                  opacity: broadcasting ? 0.7 : 1,
                }}>
                  {broadcasting ? "Diffusion en cours…" : "📢 Diffuser au département"}
                </button>
              </div>
            </div>
          )}
        </div>

        <div style={{ borderTop: `1px solid ${COLORS.line}`, padding: "18px 0", textAlign: "center", fontSize: 12.5, color: COLORS.slate }}>
          République du Mali — Ministère de la Santé · Système de gestion hospitalière
        </div>
      </div>

      {/* Staff schedule modal — the piece that was missing: openStaffSchedule()
          was already loading this data on click, but nothing ever displayed
          it. Shows every upcoming shift for the selected staff member. */}
      {viewingStaffSchedule && (
        <div
          onClick={closeStaffSchedule}
          style={{ position: "fixed", inset: 0, backgroundColor: "rgba(27,42,31,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 1000 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: "#fff", borderRadius: 14, width: "min(520px, 100%)", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.35)", borderTop: "6px solid #2E5C8C" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "22px 28px 18px", borderBottom: `1px solid ${COLORS.line}` }}>
              <h2 style={{ margin: 0, fontFamily: FONT_DISPLAY, fontSize: 19, color: COLORS.ink }}>
                Planning — {viewingStaffSchedule.role === "doctor" ? "Dr. " : ""}{viewingStaffSchedule.firstName} {viewingStaffSchedule.lastName}
              </h2>
              <button onClick={closeStaffSchedule} aria-label="Fermer" style={{ width: 34, height: 34, borderRadius: "50%", border: "none", backgroundColor: COLORS.paper, color: COLORS.ink, fontSize: 17, fontWeight: 700, cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ padding: "20px 28px 26px" }}>
              {staffScheduleLoading ? (
                <p style={{ color: COLORS.slate, fontSize: 14 }}>Chargement…</p>
              ) : staffScheduleEntries.length === 0 ? (
                <div style={{ padding: 28, backgroundColor: COLORS.paper, borderRadius: 8, textAlign: "center", color: COLORS.slate, fontSize: 13.5 }}>
                  Aucun horaire à venir pour ce membre du personnel.
                </div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {staffScheduleEntries.map((s) => (
                    <div key={s.id} style={{ padding: "14px 16px", backgroundColor: COLORS.paper, borderRadius: 8, border: `1px solid ${COLORS.line}` }}>
                      <div style={{ fontWeight: 700, color: COLORS.ink, fontSize: 14 }}>
                        {new Date(s.date + "T00:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
                      </div>
                      <div style={{ fontSize: 13, color: COLORS.slate, marginTop: 3 }}>
                        {s.shiftStart} – {s.shiftEnd}{s.notes ? ` · ${s.notes}` : ""}
                      </div>
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

function StatCard({ label, value, accent }) {
  return (
    <div style={{ padding: "14px 16px", backgroundColor: COLORS.card, borderRadius: 10, border: `1px solid ${COLORS.line}`, borderTop: `4px solid ${accent}` }}>
      <div style={{ fontSize: 11.5, color: COLORS.slate, textTransform: "uppercase", letterSpacing: "0.03em", fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: accent, marginTop: 4, fontFamily: FONT_DISPLAY }}>{value}</div>
    </div>
  );
}

function BedStatusEditor({ bed, onSave, onCancel, colors }) {
  const [status, setStatus] = useState(bed.status);
  const [patientName, setPatientName] = useState(bed.patientName || "");

  return (
    <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${colors.line}`, display: "grid", gap: 6 }}>
      <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ padding: "6px 8px", borderRadius: 5, border: `1px solid ${colors.line}`, fontSize: 12.5 }}>
        <option value="available">Disponible</option>
        <option value="assigned">Assigné</option>
        <option value="occupied">Occupé</option>
      </select>
      {status !== "available" && (
        <input
          placeholder="Nom du patient (optionnel)"
          value={patientName}
          onChange={(e) => setPatientName(e.target.value)}
          style={{ padding: "6px 8px", borderRadius: 5, border: `1px solid ${colors.line}`, fontSize: 12.5, boxSizing: "border-box" }}
        />
      )}
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={() => onSave(bed, status, patientName)} style={{ flex: 1, padding: "6px 10px", backgroundColor: colors.green, color: "white", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
          Enregistrer
        </button>
        <button onClick={onCancel} style={{ padding: "6px 10px", backgroundColor: "transparent", border: `1px solid ${colors.line}`, borderRadius: 5, cursor: "pointer", fontSize: 12 }}>
          Annuler
        </button>
      </div>
    </div>
  );
}
