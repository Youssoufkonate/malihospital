import { useState, useEffect } from "react";
import ChangePassword from "./ChangePassword";
import SessionsButton from "../components/SessionsButton";
import MfaSetup from "../components/MfaSetup";
import { db, auth, functions } from "../firebase";
import {
  collection, getDocs, doc, updateDoc, getDoc, addDoc,
  query, where, orderBy, limit, getCountFromServer, writeBatch, deleteDoc, onSnapshot,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import NotificationsBanner from "../components/NotificationsBanner";
import HamburgerMenu from "../components/HamburgerMenu";

/* ------------------------------------------------------------------ */
/*  Design tokens — Republic of Mali institutional palette             */
/* ------------------------------------------------------------------ */
const COLORS = {
  green: "#14B53A",
  gold: "#FCD116",
  red: "#CE1126",
  ink: "#1B2A1F",
  slate: "#5B6B63",
  paper: "#FAF9F5",
  card: "#FFFFFF",
  line: "#E6E2D8",
  successBg: "#E9F7EC",
  successText: "#1E7B34",
  dangerBg: "#FBEAEC",
  dangerText: "#A31221",
};

const FONT_DISPLAY = "'Georgia', 'Iowan Old Style', 'Times New Roman', serif";
const FONT_BODY = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

// Must stay in sync with Accueil.jsx / Doctor.jsx.
const PRIORITY_CONFIG = {
  emergency: { label: "Urgence", emoji: "🔴", color: "#A31221", bg: "#FBEAEC" },
  urgent:    { label: "Urgent",  emoji: "🟠", color: "#8A5A00", bg: "#FDF3E3" },
  normal:    { label: "Normal",  emoji: "🟢", color: "#1E7B34", bg: "#E9F7EC" },
};

// Must stay in sync with functions/lib/staff.js — roles that are scoped to
// one department (need the Département field) vs. hospital-wide roles.
const DEPARTMENT_SCOPED_ROLES = ["doctor", "nurse", "supervisor"];
const ROLE_LABELS = {
  doctor: "Médecin",
  nurse: "Infirmier·ère",
  accueil: "Accueil",
  supervisor: "Superviseur",
  pharmacy: "Pharmacie",
  lab: "Laboratoire",
};
const ROLE_BADGE_COLORS = {
  doctor: { bg: "#E8F0FB", text: "#2E5C8C" },
  nurse: { bg: "#FDF0E3", text: "#B8720C" },
  accueil: { bg: "#E9F7EC", text: "#1E7B34" },
  supervisor: { bg: "#F1E7FB", text: "#6B3FA0" },
  pharmacy: { bg: "#E3F7F5", text: "#0F7A6E" },
  lab: { bg: "#FBEAEC", text: "#A31221" },
};

// Compact tab-bar definition — icon + short label per section, plus an
// optional "warning" predicate (used for the Départements tab when the
// hospital hasn't configured any yet).
const TABS = [
  { key: "departments",   icon: "🏥", label: "Départements", warn: (deptCount) => deptCount === 0 },
  { key: "staff",         icon: "👥", label: "Personnel" },
  { key: "devices",       icon: "📱", label: "Appareils" },
  { key: "logins",        icon: "🕐", label: "Connexions" },
  { key: "beds",          icon: "🛏️", label: "Lits" },
  { key: "activity",      icon: "📊", label: "Activité" },
  { key: "statistics",    icon: "📈", label: "Statistiques" },
  { key: "logs",          icon: "📜", label: "Historique" },
  { key: "search",        icon: "🔍", label: "Recherche" },
  { key: "notifications", icon: "📢", label: "Notifications" },
  { key: "display",       icon: "🖥️", label: "Affichage" },
];

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

export default function AdminPanel() {
  const [staff, setStaff] = useState([]);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [hospital, setHospital] = useState(null);
  const [msg, setMsg] = useState("");
  const [activeTab, setActiveTab] = useState("staff");
  const [rooms, setRooms] = useState([]);
  const [beds, setBeds] = useState([]);
  const [bedsUnsub, setBedsUnsub] = useState(null);
  const [newRoomForm, setNewRoomForm] = useState({ name: "", department: "", numberOfBeds: "1" });
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [editingBed, setEditingBed] = useState(null); // bed being edited, or null
  const [staffSubTab, setStaffSubTab] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterRole, setFilterRole] = useState("all");
  const [editingUser, setEditingUser] = useState(null);
  const [staffSessionsFor, setStaffSessionsFor] = useState(null); // { id, firstName, lastName } or null
  const [showMfaSetup, setShowMfaSetup] = useState(false);
  const [staffDevice, setStaffDevice] = useState(null);
  const [revokingDevice, setRevokingDevice] = useState(false);
  const [pendingDevices, setPendingDevices] = useState([]);
  const [approvingPendingId, setApprovingPendingId] = useState(null);
  const [activeDevices, setActiveDevices] = useState([]);
  const [revokingActiveDeviceId, setRevokingActiveDeviceId] = useState(null);
  const [loginsSearch, setLoginsSearch] = useState("");
  const [loginsRole, setLoginsRole] = useState("all");
  const [loginsDepartment, setLoginsDepartment] = useState("all");
  const [loginsDate, setLoginsDate] = useState("");
  const [loginsStatus, setLoginsStatus] = useState("all");
  const [staffSessions, setStaffSessions] = useState([]);
  const [revokingStaffSession, setRevokingStaffSession] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [stats, setStats] = useState({ byDepartment: [], byDoctor: [], diseases: [], totals: null, priorityBreakdown: null });
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [montantPeriodType, setMontantPeriodType] = useState("year"); // day | month | year
  const [montantDate, setMontantDate] = useState(new Date().toISOString().slice(0, 10));
  const [montantMonth, setMontantMonth] = useState(new Date().toISOString().slice(0, 7));
  const [montantTicketCount, setMontantTicketCount] = useState(null);
  const [montantLoading, setMontantLoading] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [filterAction, setFilterAction] = useState("all");
  const [doctorSessions, setDoctorSessions] = useState([]);
  const [sessionDateFilter, setSessionDateFilter] = useState(new Date().toISOString().slice(0, 10));
  const [consultations, setConsultations] = useState([]);
  const [consultationDateFilter, setConsultationDateFilter] = useState(new Date().toISOString().slice(0, 10));
  const [activityLoading, setActivityLoading] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());

  // "Search Everything" tab state
  const [searchType, setSearchType] = useState("ticket"); // ticket | patient | department | date | doctor
  const [globalSearchTerm, setGlobalSearchTerm] = useState("");
  const [searchDate, setSearchDate] = useState("");
  const [doctorFilter, setDoctorFilter] = useState("");
  const [selectedDoctor, setSelectedDoctor] = useState(null);
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchRan, setSearchRan] = useState(false);

  // Create-staff form
  const [creating, setCreating] = useState(false);
  const [staffForm, setStaffForm] = useState({
    firstName: "", lastName: "", email: "", password: "",
    role: "accueil", department: "", room: "",
  });
  const [passwordFieldFocused, setPasswordFieldFocused] = useState(false);
  const [justGeneratedPassword, setJustGeneratedPassword] = useState(false);

  const nav = useNavigate();

  // checkAuthAndLoad/loadStatistics/loadLogs/loadActivity are plain functions
  // redefined on every render (not wrapped in useCallback), so adding them to
  // these dependency arrays — as the exhaustive-deps rule suggests — would
  // make each effect re-run on every render instead of only on mount / when
  // activeTab or selectedYear actually change, spamming Firestore reads.
  // That's intentional here, so the rule is silenced rather than "fixed".
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { checkAuthAndLoad(); }, []);
  useEffect(() => {
    if (activeTab === "statistics") loadStatistics();
    else if (activeTab === "logs") loadLogs();
    else if (activeTab === "activity") loadActivity();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedYear]);

  // Once the hospital's department list loads (or changes), default the
  // create-staff form to the first one if nothing's selected yet — avoids
  // leaving the dropdown on a blank/invalid value.
  useEffect(() => {
    const depts = hospital?.departments || [];
    if (DEPARTMENT_SCOPED_ROLES.includes(staffForm.role) && !staffForm.department && depts.length > 0) {
      setStaffForm((f) => ({ ...f, department: depts[0] }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hospital?.departments, staffForm.role]);

  // Ticking clock so an in-progress consultation's timer visibly counts up
  // while the admin is looking at the Activité tab.
  useEffect(() => {
    if (activeTab !== "activity") return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [activeTab]);

  // Re-queries for the SPECIFIC selected date rather than relying on the
  // static "most recent 50 sessions hospital-wide" fetch from initial
  // load — that top-50 window can silently miss an older date entirely
  // once enough newer sessions have accumulated past it.
  useEffect(() => {
    if (activeTab !== "activity" || !currentUser?.hospitalId) return;
    const start = new Date(sessionDateFilter + "T00:00:00").toISOString();
    const end = new Date(sessionDateFilter + "T23:59:59.999").toISOString();
    const q = query(
      collection(db, "doctorSessions"),
      where("hospitalId", "==", currentUser.hospitalId),
      where("loginAt", ">=", start),
      where("loginAt", "<=", end)
    );
    getDocs(q)
      .then((snap) => setDoctorSessions(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
      .catch((e) => console.error("Error loading sessions for date:", e));
  }, [activeTab, currentUser?.hospitalId, sessionDateFilter]);

  // Same reasoning as the sessions fix above — re-queries for the
  // SPECIFIC selected date rather than relying on a static "most recent
  // 50 consultations hospital-wide" fetch, which could silently miss an
  // older date once enough newer consultations have accumulated past it.
  // Unlike sessions, rows here stay one-per-consultation (not collapsed
  // per doctor) — each row is a different patient encounter, and
  // collapsing them would hide exactly which patients were seen and for
  // how long, which is the whole point of this table.
  useEffect(() => {
    if (activeTab !== "activity" || !currentUser?.hospitalId) return;
    const start = new Date(consultationDateFilter + "T00:00:00").toISOString();
    const end = new Date(consultationDateFilter + "T23:59:59.999").toISOString();
    const q = query(
      collection(db, "tickets"),
      where("hospitalId", "==", currentUser.hospitalId),
      where("consultationStartedAt", ">=", start),
      where("consultationStartedAt", "<=", end)
    );
    getDocs(q)
      .then((snap) => setConsultations(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
      .catch((e) => console.error("Error loading consultations for date:", e));
  }, [activeTab, currentUser?.hospitalId, consultationDateFilter]);

  useEffect(() => {
    if (activeTab !== "beds" || !hospital?.id) return;
    getDocs(query(collection(db, "rooms"), where("hospitalId", "==", hospital.id)))
      .then((snap) => setRooms(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
      .catch((e) => console.error("Error loading rooms:", e));
    const q = query(collection(db, "beds"), where("hospitalId", "==", hospital.id));
    const unsub = onSnapshot(q, (snap) => {
      setBeds(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, (e) => console.error("Error loading beds:", e));
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, hospital?.id]);

  const createRoom = async () => {
    const { name, department, numberOfBeds } = newRoomForm;
    if (!name.trim()) return setMsg("❌ Le nom de la chambre est obligatoire.");
    if (!department) return setMsg("❌ Veuillez sélectionner un département.");
    const count = parseInt(numberOfBeds, 10);
    if (!count || count < 1) return setMsg("❌ Le nombre de lits doit être au moins 1.");

    setCreatingRoom(true);
    setMsg("");
    try {
      const roomRef = doc(collection(db, "rooms"));
      const batch = writeBatch(db);
      batch.set(roomRef, {
        hospitalId: hospital.id,
        department,
        name: name.trim(),
        numberOfBeds: count,
        createdAt: new Date().toISOString(),
        createdBy: auth.currentUser.uid,
      });
      for (let i = 1; i <= count; i++) {
        const bedRef = doc(collection(db, "beds"));
        batch.set(bedRef, {
          hospitalId: hospital.id,
          department,
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
      setNewRoomForm({ name: "", department: "", numberOfBeds: "1" });
      const snap = await getDocs(query(collection(db, "rooms"), where("hospitalId", "==", hospital.id)));
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
        hospitalId: hospital.id,
        department: room.department,
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

  const checkAuthAndLoad = async () => {
    if (!auth.currentUser) return nav("/");
    try {
      const userDoc = await getDoc(doc(db, "users", auth.currentUser.uid));
      const userData = userDoc.data();

      if (userData?.role !== "hospitaladmin") {
        setMsg("❌ Accès refusé.");
        setTimeout(() => nav("/"), 2000);
        return;
      }
      if (userData?.disabled || !userData?.approved) {
        setMsg("❌ Votre compte n'est pas actif.");
        setTimeout(() => nav("/"), 2000);
        return;
      }

      const hospSnap = await getDoc(doc(db, "hospitals", userData.hospitalId));
      if (!hospSnap.exists() || hospSnap.data().active === false) {
        setMsg("❌ Cet hôpital a été désactivé par le Super Administrateur.");
        await signOut(auth);
        setTimeout(() => nav("/"), 2000);
        return;
      }

      // Self-heal: some Firestore security rules (tickets, doctorSessions,
      // adminLogs) require `approved` to be the literal boolean `true` and
      // `disabled` to be strictly not-`true`. The truthy check above only
      // confirms these fields are "truthy enough" client-side — if this
      // account's doc ever ended up with e.g. approved stored as the
      // string "true" (common after a manual Firestore Console edit), the
      // client check above still passes but every rule using isActive()
      // silently rejects reads with "Missing or insufficient permissions",
      // while the `users` collection rule (which doesn't check isActive())
      // keeps working — exactly the Statistiques/Activité-but-not-Personnel
      // pattern this fixes. This write is always safe: we only reach here
      // once we've already confirmed (client-side) that the account should
      // be active, and the "update own record" rule doesn't require
      // isActive() to succeed, so it can repair itself.
      if (userData.approved !== true || userData.disabled !== false) {
        try {
          await updateDoc(doc(db, "users", auth.currentUser.uid), {
            approved: true,
            disabled: false,
          });
          userData.approved = true;
          userData.disabled = false;
        } catch (e) {
          console.warn("Could not normalize own account flags:", e);
        }
      }

      setCurrentUser(userData);
      setHospital({ id: hospSnap.id, ...hospSnap.data() });
      if (!(hospSnap.data().departments || []).length) {
        setActiveTab("departments");
      }
      await loadStaff(userData.hospitalId);
    } catch (err) {
      console.error("Error loading:", err);
      setMsg("❌ Erreur: " + err.message);
      setLoading(false);
    }
  };

  const loadStaff = async (hospitalId) => {
    try {
      const q = query(collection(db, "users"), where("hospitalId", "==", hospitalId));
      const snap = await getDocs(q);
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((u) => ["doctor", "nurse", "accueil", "supervisor", "pharmacy", "lab"].includes(u.role));
      setStaff(list);
      setLoading(false);
    } catch (err) {
      console.error("Error loading staff:", err);
      setMsg("❌ Erreur de chargement: " + err.message);
      setLoading(false);
    }
  };

  const logAdminAction = async (action, targetUserId, targetUserName, details = {}) => {
    try {
      await addDoc(collection(db, "adminLogs"), {
        hospitalId: currentUser.hospitalId,
        adminId: auth.currentUser.uid,
        adminName: `${currentUser.firstName} ${currentUser.lastName}`,
        adminEmail: auth.currentUser.email,
        action, targetUserId, targetUserName, details,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Error logging action:", error);
    }
  };

  // ---------------------------------------------------------------
  // Department management. Departments live as a simple string array on
  // the hospital document (hospitals/{id}.departments) — no separate
  // collection needed for a list this small. Rename/delete are both
  // unrestricted (per hospital admin's own call), but rename cascades to
  // every doctor and ticket currently using the old name, so nothing is
  // left silently pointing at a name that no longer exists in the list.
  // Delete does NOT cascade — historical tickets/doctors keep whatever
  // department string they already had; the UI elsewhere is responsible
  // for still showing/allowing that value even after it drops off the
  // active list (see the doctor-edit dropdown below).
  // ---------------------------------------------------------------
  const addDepartment = async (name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (departments.some((d) => d.toLowerCase() === trimmed.toLowerCase())) {
      setMsg("❌ Ce département existe déjà.");
      return;
    }
    try {
      const updated = [...departments, trimmed];
      await updateDoc(doc(db, "hospitals", currentUser.hospitalId), { departments: updated });
      setHospital((prev) => ({ ...prev, departments: updated }));
      await logAdminAction("dept_add", currentUser.hospitalId, trimmed, {});
      setMsg(`✅ Département "${trimmed}" ajouté.`);
      setTimeout(() => setMsg(""), 3000);
    } catch (err) {
      setMsg("❌ Erreur: " + err.message);
    }
  };

  const renameDepartment = async (oldName) => {
    const newName = window.prompt(`Nouveau nom pour "${oldName}" :`, oldName);
    if (!newName || !newName.trim() || newName.trim() === oldName) return;
    const trimmed = newName.trim();
    if (departments.some((d) => d.toLowerCase() === trimmed.toLowerCase())) {
      setMsg("❌ Un département porte déjà ce nom.");
      return;
    }
    try {
      const updated = departments.map((d) => (d === oldName ? trimmed : d));
      await updateDoc(doc(db, "hospitals", currentUser.hospitalId), { departments: updated });

      // Cascade: every doctor and every ticket currently tagged with the
      // old department name gets moved to the new one, so nothing is left
      // referencing a name that no longer appears anywhere in the UI.
      const [doctorsSnap, ticketsSnap] = await Promise.all([
        getDocs(query(collection(db, "users"), where("hospitalId", "==", currentUser.hospitalId), where("department", "==", oldName))),
        getDocs(query(collection(db, "tickets"), where("hospitalId", "==", currentUser.hospitalId), where("department", "==", oldName))),
      ]);
      await Promise.all([
        ...doctorsSnap.docs.map((d) => updateDoc(d.ref, { department: trimmed })),
        ...ticketsSnap.docs.map((d) => updateDoc(d.ref, { department: trimmed })),
      ]);

      setHospital((prev) => ({ ...prev, departments: updated }));
      await loadStaff(currentUser.hospitalId);
      await logAdminAction("dept_rename", currentUser.hospitalId, `${oldName} → ${trimmed}`, {
        affectedDoctors: doctorsSnap.size, affectedTickets: ticketsSnap.size,
      });
      setMsg(`✅ Département renommé "${oldName}" → "${trimmed}" (${doctorsSnap.size} médecin(s), ${ticketsSnap.size} ticket(s) mis à jour).`);
      setTimeout(() => setMsg(""), 5000);
    } catch (err) {
      setMsg("❌ Erreur lors du renommage: " + err.message);
    }
  };

  const deleteDepartment = async (name) => {
    if (!window.confirm(`Supprimer le département "${name}" ?\n\nLes médecins et tickets existants qui utilisent déjà ce nom ne seront PAS modifiés — ils garderont "${name}" pour l'historique. Ce nom ne sera simplement plus proposé pour les nouveaux tickets/médecins.`)) return;
    try {
      const updated = departments.filter((d) => d !== name);
      await updateDoc(doc(db, "hospitals", currentUser.hospitalId), { departments: updated });
      setHospital((prev) => ({ ...prev, departments: updated }));
      await logAdminAction("dept_delete", currentUser.hospitalId, name, {});
      setMsg(`✅ Département "${name}" supprimé de la liste active.`);
      setTimeout(() => setMsg(""), 3000);
    } catch (err) {
      setMsg("❌ Erreur: " + err.message);
    }
  };

  const [newDeptName, setNewDeptName] = useState("");
  const [broadcastForm, setBroadcastForm] = useState({ title: "", message: "", severity: "info" });
  const [broadcasting, setBroadcasting] = useState(false);

  const generatePassword = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    let out = "";
    for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
    setStaffForm((f) => ({ ...f, password: out }));
    setJustGeneratedPassword(true);
    setTimeout(() => setJustGeneratedPassword(false), 700);
  };

  const createStaff = async () => {
    const { firstName, lastName, email, password, role, department, room } = staffForm;
    if (!firstName || !lastName || !email || !password) {
      setMsg("❌ Veuillez remplir tous les champs obligatoires");
      return;
    }
    if (DEPARTMENT_SCOPED_ROLES.includes(role) && !department) {
      setMsg("❌ Veuillez sélectionner un département");
      return;
    }
    if (role === "doctor" && !room) {
      setMsg("❌ Veuillez spécifier le numéro de chambre du médecin");
      return;
    }
    setCreating(true);
    setMsg("");

    try {
      // Cloud Function: creates the real Firebase Auth login and the
      // Firestore profile server-side in one operation. No more secondary-
      // Firebase-app workaround needed to avoid replacing the admin's own
      // session — admin.auth().createUser() has no such side effect.
      const call = httpsCallable(functions, "createStaffAccount");
      await call({ firstName, lastName, email, password, role, hospitalId: currentUser.hospitalId, department, room });

      setMsg(`✅ Compte créé pour ${firstName} ${lastName}. (Mot de passe temporaire communiqué séparément: ${password})`);
      setStaffForm({ firstName: "", lastName: "", email: "", password: "", role: "accueil", department: "", room: "" });
      await loadStaff(currentUser.hospitalId);
    } catch (err) {
      console.error("Error creating staff:", err);
      if (err.code === "functions/already-exists") {
        setMsg("❌ Cet email est déjà utilisé.");
      } else {
        setMsg("❌ Erreur: " + (err.message || "Une erreur est survenue."));
      }
    }
    setCreating(false);
  };

  const disableUser = async (userId, user) => {
    try {
      // Cloud Function: also locks the person out at the Auth layer, not
      // just the app-level "disabled" check that used to run post-login.
      const call = httpsCallable(functions, "setStaffDisabled");
      await call({ userId, disabled: true });
      setMsg("✅ Utilisateur désactivé!");
      await loadStaff(currentUser.hospitalId);
      setTimeout(() => setMsg(""), 3000);
    } catch (err) { setMsg("❌ Erreur: " + (err.message || "Une erreur est survenue.")); }
  };

  const enableUser = async (userId, user) => {
    try {
      const call = httpsCallable(functions, "setStaffDisabled");
      await call({ userId, disabled: false });
      setMsg("✅ Utilisateur réactivé!");
      await loadStaff(currentUser.hospitalId);
      setTimeout(() => setMsg(""), 3000);
    } catch (err) { setMsg("❌ Erreur: " + (err.message || "Une erreur est survenue.")); }
  };

  const deleteUser = async (userId, user) => {
    if (!window.confirm(`Êtes-vous sûr de vouloir supprimer ${user.firstName} ${user.lastName}?`)) return;
    try {
      // Cloud Function: deletes BOTH the Firestore profile and the actual
      // Firebase Auth login — the client-only version could only ever
      // delete the profile half, leaving the person able to log in.
      const call = httpsCallable(functions, "deleteStaffAccount");
      await call({ userId });
      setMsg("✅ Utilisateur supprimé (profil et connexion).");
      await loadStaff(currentUser.hospitalId);
      setTimeout(() => setMsg(""), 5000);
    } catch (err) { setMsg("❌ Erreur: " + (err.message || "Une erreur est survenue.")); }
  };

  const startEdit = (user) => {
    setEditingUser(user.id);
    setEditForm({ firstName: user.firstName, lastName: user.lastName, department: user.department || "", room: user.room || "" });
  };

  // Live-loads a specific staff member's sessions (rules already permit
  // a hospital admin to read/revoke sessions for staff of their own
  // hospital) — this is the "employee lost their laptop" workflow: the
  // admin acts on the employee's behalf since the employee may not have
  // access to do it themselves.
  const openStaffSessions = (user) => {
    setStaffSessionsFor(user);
    setStaffSessions([]);
  };

  useEffect(() => {
    if (!staffSessionsFor) return;
    const q = query(collection(db, "sessions"), where("uid", "==", staffSessionsFor.id));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((s) => !s.revoked);
      list.sort((a, b) => new Date(b.lastActivityAt) - new Date(a.lastActivityAt));
      setStaffSessions(list);
    }, (e) => console.error("Error loading staff sessions:", e));
    return () => unsub();
  }, [staffSessionsFor]);

  const revokeStaffSession = async (sessionId) => {
    setRevokingStaffSession(sessionId);
    try {
      await updateDoc(doc(db, "sessions", sessionId), { revoked: true, revokedAt: new Date().toISOString(), revokedBy: currentUser.uid });
    } catch (e) {
      setMsg("❌ Erreur: " + e.message);
    }
    setRevokingStaffSession(null);
  };

  const revokeAllStaffSessions = async () => {
    if (!window.confirm(`Déconnecter tous les appareils de ${staffSessionsFor.firstName} ${staffSessionsFor.lastName} ?`)) return;
    setRevokingStaffSession("all");
    try {
      const batch = writeBatch(db);
      staffSessions.forEach((s) => {
        batch.update(doc(db, "sessions", s.id), { revoked: true, revokedAt: new Date().toISOString(), revokedBy: currentUser.uid });
      });
      await batch.commit();
    } catch (e) {
      setMsg("❌ Erreur: " + e.message);
    }
    setRevokingStaffSession(null);
  };

  // The registered device (#1) is separate from sessions (#10) — a
  // device can persist across many logins; revoking it stops it from
  // being able to log in again at all (a new/replacement device would
  // file its own fresh pending request), rather than just ending
  // whatever's currently open. A hospital admin can approve/revoke here
  // for anyone EXCEPT a fellow hospitaladmin — that tier is
  // superadmin-only (see Security Overview), matching the rules.
  useEffect(() => {
    if (!staffSessionsFor) { setStaffDevice(null); return; }
    const q = query(collection(db, "devices"), where("userId", "==", staffSessionsFor.id));
    const unsub = onSnapshot(q, (snap) => {
      if (snap.empty) { setStaffDevice(null); return; }
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      docs.sort((a, b) => new Date(b.registeredAt) - new Date(a.registeredAt));
      setStaffDevice(docs[0]);
    }, (e) => console.error("Error loading staff device:", e));
    return () => unsub();
  }, [staffSessionsFor]);

  // Hospital-wide pending device requests — lets the admin see and act
  // on every waiting request in one place. Excludes hospitaladmin-role
  // requests entirely (those are superadmin's to approve, and the rules
  // wouldn't let this update succeed anyway). Runs continuously
  // (not gated to the "devices" tab being open) so the tab-bar badge
  // count stays accurate no matter which tab the admin is currently on.
  useEffect(() => {
    if (!currentUser?.hospitalId) return;
    const q = query(
      collection(db, "devices"),
      where("hospitalId", "==", currentUser.hospitalId),
      where("status", "==", "pending")
    );
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((d) => d.role !== "hospitaladmin");
      list.sort((a, b) => new Date(a.registeredAt) - new Date(b.registeredAt));
      setPendingDevices(list);
    }, (e) => console.error("Error loading pending devices:", e));
    return () => unsub();
  }, [currentUser?.hospitalId]);

  // Already-approved devices for this hospital's staff — shown alongside
  // the pending list in the Appareils tab so approving and revoking live
  // in the same place, matching the pattern used in Super Admin's own
  // Appareils tab.
  useEffect(() => {
    if (!currentUser?.hospitalId) return;
    const q = query(
      collection(db, "devices"),
      where("hospitalId", "==", currentUser.hospitalId),
      where("status", "==", "active")
    );
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((d) => d.role !== "hospitaladmin");
      list.sort((a, b) => new Date(b.approvedAt || b.registeredAt) - new Date(a.approvedAt || a.registeredAt));
      setActiveDevices(list);
    }, (e) => console.error("Error loading active devices:", e));
    return () => unsub();
  }, [currentUser?.hospitalId]);

  const approvePendingDevice = async (device) => {
    setApprovingPendingId(device.id);
    try {
      await updateDoc(doc(db, "devices", device.id), { status: "active", approvedAt: new Date().toISOString(), approvedBy: currentUser.uid });
    } catch (e) {
      setMsg("❌ Erreur: " + e.message);
    }
    setApprovingPendingId(null);
  };

  const denyPendingDevice = async (device) => {
    setApprovingPendingId(device.id);
    try {
      await updateDoc(doc(db, "devices", device.id), { status: "revoked", revokedAt: new Date().toISOString(), revokedBy: currentUser.uid });
    } catch (e) {
      setMsg("❌ Erreur: " + e.message);
    }
    setApprovingPendingId(null);
  };

  // Revoke directly from the Appareils tab's "already approved" list —
  // distinct from revokeStaffDevice below, which operates on whichever
  // single staff member's Sessions modal happens to be open.
  const revokeActiveDeviceFromList = async (device) => {
    if (!window.confirm(`Révoquer l'appareil de ${device.userName || device.userEmail} ? Il/elle ne pourra plus se connecter depuis cet appareil.`)) return;
    setRevokingActiveDeviceId(device.id);
    try {
      await updateDoc(doc(db, "devices", device.id), { status: "revoked", revokedAt: new Date().toISOString(), revokedBy: currentUser.uid });
    } catch (e) {
      setMsg("❌ Erreur: " + e.message);
    }
    setRevokingActiveDeviceId(null);
  };

  const approveStaffDevice = async () => {
    if (!staffDevice) return;
    setRevokingDevice(true);
    try {
      await updateDoc(doc(db, "devices", staffDevice.id), { status: "active", approvedAt: new Date().toISOString(), approvedBy: currentUser.uid });
    } catch (e) {
      setMsg("❌ Erreur: " + e.message);
    }
    setRevokingDevice(false);
  };

  const revokeStaffDevice = async () => {
    if (!staffDevice) return;
    if (!window.confirm(`Révoquer l'appareil de ${staffSessionsFor.firstName} ${staffSessionsFor.lastName} ? Il/elle ne pourra plus se connecter depuis cet appareil.`)) return;
    setRevokingDevice(true);
    try {
      await updateDoc(doc(db, "devices", staffDevice.id), { status: "revoked", revokedAt: new Date().toISOString(), revokedBy: currentUser.uid });
    } catch (e) {
      setMsg("❌ Erreur: " + e.message);
    }
    setRevokingDevice(false);
  };

  const saveEdit = async (userId, user) => {
    try {
      await updateDoc(doc(db, "users", userId), editForm);
      await logAdminAction("update", userId, `${user.firstName} ${user.lastName}`, { changes: editForm });
      setMsg("✅ Utilisateur mis à jour!");
      setEditingUser(null);
      await loadStaff(currentUser.hospitalId);
      setTimeout(() => setMsg(""), 3000);
    } catch (err) { setMsg("❌ Erreur: " + err.message); }
  };

  // Independent of the rest of the Statistiques tab (which stays year-only
  // via generateAdminReport) — this is just a ticket count for whatever
  // day/month/year is selected, using getCountFromServer so a busy
  // hospital's full ticket history is never downloaded just to count it.
  useEffect(() => {
    if (!currentUser?.hospitalId) return;
    let start, end;
    if (montantPeriodType === "day") {
      start = new Date(montantDate + "T00:00:00");
      end = new Date(montantDate + "T23:59:59.999");
    } else if (montantPeriodType === "month") {
      const [y, m] = montantMonth.split("-").map(Number);
      start = new Date(y, m - 1, 1, 0, 0, 0);
      end = new Date(y, m, 0, 23, 59, 59, 999); // day 0 of next month = last day of this month
    } else {
      start = new Date(`${selectedYear}-01-01T00:00:00`);
      end = new Date(`${selectedYear}-12-31T23:59:59.999`);
    }
    setMontantLoading(true);
    const q = query(
      collection(db, "tickets"),
      where("hospitalId", "==", currentUser.hospitalId),
      where("createdAt", ">=", start.toISOString()),
      where("createdAt", "<=", end.toISOString())
    );
    getCountFromServer(q)
      .then((snap) => setMontantTicketCount(snap.data().count))
      .catch((e) => { console.error("Error counting tickets for montant:", e); setMontantTicketCount(null); })
      .finally(() => setMontantLoading(false));
  }, [currentUser?.hospitalId, montantPeriodType, montantDate, montantMonth, selectedYear]);

  const loadStatistics = async () => {
    setStatsLoading(true);
    try {
      // Three server-side aggregations run in parallel instead of
      // downloading every matching ticket to the browser and summing in
      // JS. generateAdminReport also covers the department breakdown, so
      // there's no separate client-side ticket fetch needed for this tab
      // at all anymore.
      const [reportResult, doctorResult, diseaseResult] = await Promise.all([
        httpsCallable(functions, "generateAdminReport")({ hospitalId: currentUser.hospitalId, year: Number(selectedYear) }),
        httpsCallable(functions, "getDoctorStatistics")({ hospitalId: currentUser.hospitalId, year: Number(selectedYear) }),
        httpsCallable(functions, "getDiseaseStatistics")({ hospitalId: currentUser.hospitalId, year: Number(selectedYear) }),
      ]);

      setStats({
        byDepartment: reportResult.data.byDepartment,
        byDoctor: doctorResult.data.doctors,
        diseases: diseaseResult.data.diseases,
        totals: reportResult.data.totals,
        priorityBreakdown: reportResult.data.priorityBreakdown,
      });
    } catch (error) {
      console.error("Error loading statistics:", error);
      // If this is a missing-index error, the full message (including the
      // Firestore-generated index-creation link) is preserved by the
      // Cloud Function — check Firebase Console → Functions → Logs for the
      // clickable version if it's truncated here.
      setMsg("❌ Erreur de chargement des statistiques: " + (error.message || "Une erreur est survenue."));
    }
    setStatsLoading(false);
  };

  const loadActivity = async () => {
    setActivityLoading(true);
    try {
      // Refresh staff first so the Actif/Hors ligne badges reflect the
      // doctors' current online field, not whatever was loaded on mount.
      await loadStaff(currentUser.hospitalId);

      // Doctor login/logout sessions for this hospital, most recent first.
      // Bounded at the Firestore query level (orderBy + limit) rather than
      // fetching every session ever recorded and slicing client-side — this
      // keeps read cost constant no matter how many sessions accumulate.
      // Requires a composite index: doctorSessions (hospitalId ASC, loginAt DESC).
      const sessQ = query(
        collection(db, "doctorSessions"),
        where("hospitalId", "==", currentUser.hospitalId),
        orderBy("loginAt", "desc"),
        limit(50)
      );
      const sessSnap = await getDocs(sessQ);
      setDoctorSessions(sessSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

      // Tickets that have a consultation timer on them (started via "Commencer").
      // orderBy on consultationStartedAt automatically excludes tickets that
      // never got a consultation started (the field is simply absent on
      // them), so no client-side filter is needed either.
      // Requires a composite index: tickets (hospitalId ASC, consultationStartedAt DESC).
      const ticketsQ = query(
        collection(db, "tickets"),
        where("hospitalId", "==", currentUser.hospitalId),
        orderBy("consultationStartedAt", "desc"),
        limit(50)
      );
      const ticketsSnap = await getDocs(ticketsQ);
      setConsultations(ticketsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (error) {
      console.error("Error loading activity:", error);
      const hint = error.code === "failed-precondition"
        ? " Un index Firestore composite est requis — ouvrez la console développeur (F12) pour le lien de création automatique."
        : "";
      setMsg("❌ Erreur de chargement de l'activité: " + error.message + hint);
    }
    setActivityLoading(false);
  };

  const loadLogs = async () => {
    setLogsLoading(true);
    try {
      const logsQuery = query(
        collection(db, "adminLogs"),
        where("hospitalId", "==", currentUser.hospitalId),
        orderBy("timestamp", "desc"),
        limit(100)
      );
      const logsSnap = await getDocs(logsQuery);
      setLogs(logsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (error) {
      console.error("Error loading logs:", error);
      // Same story here: equality filter (hospitalId) + orderBy on a
      // different field (timestamp) needs a composite index.
      const hint = error.code === "failed-precondition"
        ? " Un index Firestore composite est requis — ouvrez la console développeur (F12) pour le lien de création automatique."
        : "";
      setMsg("❌ Erreur de chargement de l'historique: " + error.message + hint);
    }
    setLogsLoading(false);
  };

  // "Search Everything" — five ways to find tickets, per the search type:
  //   ticket     → prefix match on ticketNumber (e.g. "P-4" finds P-412, P-489…)
  //   patient    → prefix match on patientName. NOTE: this app has no
  //                separate persistent patient-ID system — each ticket is a
  //                standalone visit record with just a name/age/sex on it,
  //                not a link to a reusable patient profile. So "Patient ID"
  //                search is implemented as a name search; if you want real
  //                cross-visit patient records with a stable ID, that's a
  //                bigger schema change (a separate `patients` collection)
  //                — happy to build that if it's actually needed.
  //   department → exact match, most recent first
  //   date       → all tickets created on the selected calendar day
  //   doctor     → pick a doctor from the (already-loaded) staff list, then
  //                see every ticket they've consulted on
  // Prefix search is case-sensitive (Firestore has no native case-insensitive
  // query) — it matches on however the name/ticket number was typed at intake.
  const performSearch = async () => {
    if (!currentUser?.hospitalId) return;
    setSearchLoading(true);
    setSearchRan(true);
    setSearchResults([]);
    try {
      const hid = currentUser.hospitalId;
      let q;

      if (searchType === "ticket") {
        const term = globalSearchTerm.trim();
        if (!term) { setSearchLoading(false); return; }
        q = query(
          collection(db, "tickets"),
          where("hospitalId", "==", hid),
          where("ticketNumber", ">=", term),
          where("ticketNumber", "<=", term + "\uf8ff"),
          orderBy("ticketNumber"),
          limit(50)
        );
      } else if (searchType === "patient") {
        const term = globalSearchTerm.trim();
        if (!term) { setSearchLoading(false); return; }
        q = query(
          collection(db, "tickets"),
          where("hospitalId", "==", hid),
          where("patientName", ">=", term),
          where("patientName", "<=", term + "\uf8ff"),
          orderBy("patientName"),
          limit(50)
        );
      } else if (searchType === "department") {
        if (!globalSearchTerm) { setSearchLoading(false); return; }
        q = query(
          collection(db, "tickets"),
          where("hospitalId", "==", hid),
          where("department", "==", globalSearchTerm),
          orderBy("createdAt", "desc"),
          limit(100)
        );
      } else if (searchType === "date") {
        if (!searchDate) { setSearchLoading(false); return; }
        const dayStart = new Date(`${searchDate}T00:00:00`);
        const dayEnd = new Date(`${searchDate}T23:59:59.999`);
        q = query(
          collection(db, "tickets"),
          where("hospitalId", "==", hid),
          where("createdAt", ">=", dayStart.toISOString()),
          where("createdAt", "<=", dayEnd.toISOString()),
          orderBy("createdAt", "desc"),
          limit(200)
        );
      } else if (searchType === "doctor") {
        if (!selectedDoctor) { setSearchLoading(false); return; }
        q = query(
          collection(db, "tickets"),
          where("hospitalId", "==", hid),
          where("consultationDoctorId", "==", selectedDoctor.id),
          orderBy("createdAt", "desc"),
          limit(50)
        );
      }

      const snap = await getDocs(q);
      setSearchResults(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (error) {
      console.error("Error searching:", error);
      const hint = error.code === "failed-precondition"
        ? " Un index Firestore composite est requis — ouvrez la console développeur (F12) pour le lien de création automatique."
        : "";
      setMsg("❌ Erreur de recherche: " + error.message + hint);
    }
    setSearchLoading(false);
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
      await call({ title: broadcastForm.title.trim(), message: broadcastForm.message.trim(), severity: broadcastForm.severity });
      setMsg("✅ Notification diffusée à votre personnel.");
      setBroadcastForm({ title: "", message: "", severity: "info" });
    } catch (e) {
      setMsg("❌ Erreur: " + (e.message || "Une erreur est survenue."));
    }
    setBroadcasting(false);
  };

  const handleLogout = async () => { await signOut(auth); nav("/"); };

  const getFilteredStaff = () => {
    let filtered = staff;
    if (staffSubTab === "active") filtered = filtered.filter((u) => !u.disabled);
    else if (staffSubTab === "disabled") filtered = filtered.filter((u) => u.disabled);
    if (searchTerm) {
      filtered = filtered.filter((u) =>
        u.firstName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        u.lastName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        u.email?.toLowerCase().includes(searchTerm.toLowerCase()));
    }
    if (filterRole !== "all") filtered = filtered.filter((u) => u.role === filterRole);
    return filtered;
  };

  const formatDuration = (totalSeconds) => {
    if (totalSeconds == null || Number.isNaN(totalSeconds)) return "—";
    const s = Math.max(0, Math.floor(totalSeconds));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
  };

  // Opens a formatted, letterhead-branded report in a new tab and triggers
  // the browser print dialog — the person can pick "Enregistrer en PDF" as
  // the destination to get a PDF, or send it straight to a printer.
  const printStatistics = () => {
    const w = window.open("", "_blank", "width=900,height=1000");
    if (!w) {
      setMsg("❌ Le navigateur a bloqué la fenêtre d'impression (pop-up).");
      return;
    }

    const deptRows = stats.byDepartment.map((d) => `
      <tr>
        <td>${d.name}</td><td>${d.total}</td><td>${d.waiting}</td><td>${d.ready}</td><td>${d.inProgress}</td><td>${d.completed}</td><td>${d.completionRate}%</td>
      </tr>`).join("");

    const doctorRows = stats.byDoctor.map((d) => `
      <tr>
        <td>${d.name}</td><td>${d.department}</td><td>${d.room}</td><td>${d.totalInDept}</td><td>${d.completed}</td><td>${d.completionRate}%</td>
      </tr>`).join("");

    const diseaseRows = stats.diseases.map((d) => `
      <tr>
        <td>${d.name}</td><td>${d.count}</td><td>${Object.entries(d.byDepartment).map(([dept, n]) => `${dept} (${n})`).join(", ")}</td>
      </tr>`).join("");

    const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8" />
<title>Statistiques — ${hospital?.name || ""}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; color: #1B2A1F; padding: 32px; }
  .flagbar { height: 6px; display: flex; margin-bottom: 24px; }
  .flagbar div { flex: 1; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  .eyebrow { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #5B6B63; }
  .motto { font-style: italic; font-size: 11px; color: #5B6B63; margin-bottom: 10px; }
  h2 { font-size: 15px; border-left: 4px solid #FCD116; padding-left: 8px; margin-top: 28px; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; }
  th, td { border: 1px solid #E6E2D8; padding: 8px 10px; text-align: left; }
  th { background: #1B2A1F; color: white; font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; }
  .meta { color: #5B6B63; font-size: 12px; margin-top: 4px; }
  .footer { margin-top: 36px; font-size: 11px; color: #5B6B63; text-align: center; border-top: 1px solid #E6E2D8; padding-top: 12px; }
</style>
</head><body>
  <div class="flagbar"><div style="background:#14B53A"></div><div style="background:#FCD116"></div><div style="background:#CE1126"></div></div>
  <div class="eyebrow">République du Mali</div>
  <div class="motto">Un Peuple — Un But — Une Foi</div>
  <h1>Ministère de la Santé — ${hospital?.name || ""}</h1>
  <div class="meta">Statistiques des tickets — Année ${selectedYear} · Généré le ${new Date().toLocaleString("fr-FR")}</div>
  ${hospital?.ticketPrice != null && stats.totals ? `<div class="meta" style="font-weight:700; font-size:14px; margin-top:8px;">Montant total : ${(hospital.ticketPrice * stats.totals.tickets).toLocaleString("fr-FR")} FCFA (${hospital.ticketPrice.toLocaleString("fr-FR")} FCFA × ${stats.totals.tickets} ticket${stats.totals.tickets === 1 ? "" : "s"})</div>` : ""}

  <h2>Par département</h2>
  <table>
    <thead><tr><th>Département</th><th>Total</th><th>Attente triage</th><th>Prêt</th><th>En cours</th><th>Complétés</th><th>Taux</th></tr></thead>
    <tbody>${deptRows || `<tr><td colspan="7">Aucune donnée</td></tr>`}</tbody>
  </table>

  <h2>Performance des médecins</h2>
  <table>
    <thead><tr><th>Médecin</th><th>Département</th><th>Chambre</th><th>Total Dépt.</th><th>Complétés</th><th>Taux</th></tr></thead>
    <tbody>${doctorRows || `<tr><td colspan="6">Aucune donnée</td></tr>`}</tbody>
  </table>

  <h2>Statistiques des maladies (diagnostics)</h2>
  <table>
    <thead><tr><th>Diagnostic</th><th>Cas</th><th>Répartition par département</th></tr></thead>
    <tbody>${diseaseRows || `<tr><td colspan="3">Aucun diagnostic enregistré</td></tr>`}</tbody>
  </table>

  <div class="footer">République du Mali — Ministère de la Santé · Système de gestion hospitalière</div>
</body></html>`;

    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };

  const getActionIcon = (action) => ({ create: "➕", disable: "🔒", enable: "🔓", delete: "🗑️", update: "✏️", dept_add: "🏥", dept_rename: "✏️", dept_delete: "🗑️" }[action] || "📝");
  const getActionColor = (action) => ({ create: COLORS.green, disable: COLORS.gold, enable: "#2E7D8C", delete: COLORS.red, update: "#2E5C8C", dept_add: COLORS.green, dept_rename: "#2E5C8C", dept_delete: COLORS.red }[action] || COLORS.slate);
  const getActionText = (action) => ({ create: "Créé", disable: "Désactivé", enable: "Réactivé", delete: "Supprimé", update: "Mis à jour", dept_add: "Département ajouté", dept_rename: "Département renommé", dept_delete: "Département supprimé" }[action] || action);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16, backgroundColor: COLORS.paper, fontFamily: FONT_BODY }}>
        <MaliFlag width={56} height={38} />
        <div style={{ fontSize: 16, color: COLORS.slate }}>Chargement…</div>
      </div>
    );
  }

  const filteredStaff = getFilteredStaff();
  const activeCount = staff.filter((u) => !u.disabled).length;
  const disabledCount = staff.filter((u) => u.disabled).length;
  const filteredLogs = filterAction === "all" ? logs : logs.filter((log) => log.action === filterAction);
  const waitingRoomLink = `${window.location.origin}/waiting/${currentUser?.hospitalId}`;
  const departments = hospital?.departments || [];

  return (
    <div className="mali-admin-panel" style={{ minHeight: "100vh", background: COLORS.paper, fontFamily: FONT_BODY }}>
      <style>{`
        .mali-admin-panel input,
        .mali-admin-panel select,
        .mali-admin-panel textarea {
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .mali-admin-panel input:focus,
        .mali-admin-panel select:focus,
        .mali-admin-panel textarea:focus {
          outline: none;
          border-color: ${COLORS.green} !important;
          box-shadow: 0 0 0 3px rgba(20,181,58,0.14);
        }
        .mali-admin-panel input:disabled,
        .mali-admin-panel select:disabled,
        .mali-admin-panel textarea:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .mali-admin-panel table tbody tr {
          transition: background-color 0.12s ease;
        }
        .mali-admin-panel table tbody tr:hover {
          background-color: ${COLORS.paper};
        }
        .mali-admin-panel button {
          transition: filter 0.12s ease, transform 0.12s ease, box-shadow 0.15s ease, background-color 0.15s ease;
        }
        .mali-admin-panel button:active:not(:disabled) {
          transform: translateY(1px);
        }
        .mali-admin-panel ::-webkit-scrollbar {
          height: 8px;
          width: 8px;
        }
        .mali-admin-panel ::-webkit-scrollbar-thumb {
          background: ${COLORS.line};
          border-radius: 8px;
        }
        .mali-admin-panel ::-webkit-scrollbar-thumb:hover {
          background: #C9C3B2;
        }
      `}</style>
      {/* Tricolor signature bar */}
      <div style={{ height: 6, display: "flex" }}>
        <div style={{ flex: 1, background: COLORS.green }} />
        <div style={{ flex: 1, background: COLORS.gold }} />
        <div style={{ flex: 1, background: COLORS.red }} />
      </div>

      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "0 24px" }}>

        {/* Official letterhead header */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "26px 0 22px 0", borderBottom: `1px solid ${COLORS.line}`, gap: 20,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <MaliFlag width={54} height={37} style={{ borderRadius: 3, boxShadow: "0 1px 3px rgba(0,0,0,0.18)" }} />
            <div>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 12, letterSpacing: "0.14em", color: COLORS.slate, textTransform: "uppercase" }}>
                République du Mali
              </div>
              <div style={{ fontFamily: FONT_DISPLAY, fontStyle: "italic", fontSize: 11, color: COLORS.slate, marginTop: 1 }}>
                Un Peuple — Un But — Une Foi
              </div>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 21, fontWeight: 700, color: COLORS.ink, marginTop: 6, letterSpacing: "0.01em" }}>
                Ministère de la Santé
              </div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: COLORS.slate, marginTop: 4 }}>
                {hospital?.name} <span style={{ color: COLORS.line }}>·</span> Espace Administration
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 13, color: COLORS.slate }}>Connecté en tant que</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.ink }}>{currentUser?.firstName} {currentUser?.lastName}</div>
            </div>
            <SessionsButton />
            <button onClick={() => setShowMfaSetup(true)} style={{
              padding: "10px 16px", backgroundColor: "transparent", color: "#6B4226", border: "1.5px solid #6B4226",
              borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13,
            }}>
              🔐 2FA
            </button>
            <button onClick={() => setShowChangePassword(true)} style={{
              padding: "10px 16px", backgroundColor: "transparent", color: "#6B4226", border: "1.5px solid #6B4226",
              borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13,
            }}>
              🔑 Mot de passe
            </button>
            <button onClick={handleLogout} style={{
              padding: "10px 20px", backgroundColor: "transparent", color: COLORS.red,
              border: `1.5px solid ${COLORS.red}`, borderRadius: 6, cursor: "pointer",
              fontSize: 14, fontWeight: 600, transition: "background-color 0.15s, color 0.15s",
            }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = COLORS.red; e.currentTarget.style.color = "#fff"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = COLORS.red; }}
            >
              Déconnexion
            </button>
          </div>
        </div>

        <div style={{ marginTop: 20 }}>
          <NotificationsBanner hospitalId={currentUser?.hospitalId} />
        </div>

        {msg && (
          <div style={{
            padding: "13px 18px", margin: "20px 0", borderRadius: 6, fontWeight: 500, fontSize: 14.5,
            backgroundColor: msg.startsWith("✅") ? COLORS.successBg : COLORS.dangerBg,
            color: msg.startsWith("✅") ? COLORS.successText : COLORS.dangerText,
            border: `1px solid ${msg.startsWith("✅") ? "#BEE3C5" : "#F1C3C9"}`,
          }}>
            {msg}
          </div>
        )}

        {/* Navigation menu */}
        <div style={{ marginTop: 22, marginBottom: 4 }}>
          <HamburgerMenu
            tabs={TABS}
            activeTab={activeTab}
            onSelect={setActiveTab}
            getBadge={(tab) => ({
              count: tab.key === "devices" ? pendingDevices.length : 0,
              warn: typeof tab.warn === "function" && tab.warn(departments.length),
            })}
            colors={COLORS}
          />
        </div>

        <div style={{ padding: "28px 0 50px 0" }}>

          {activeTab === "departments" && (
            <div style={{ maxWidth: 700 }}>
              <h2 style={{ color: COLORS.ink, margin: "0 0 8px", fontFamily: FONT_DISPLAY, fontSize: 22 }}>
                Départements de {hospital?.name}
              </h2>
              <p style={{ color: COLORS.slate, fontSize: 13.5, marginBottom: 22, lineHeight: 1.6 }}>
                Ces départements alimentent la création de tickets (accueil), l'assignation des médecins,
                et la recherche. Renommer un département met automatiquement à jour tous les médecins et
                tickets existants qui l'utilisent déjà. Supprimer un département ne touche pas l'historique —
                il n'est simplement plus proposé pour les nouveaux tickets ou médecins.
              </p>

              {departments.length === 0 && (
                <div style={{
                  padding: 18, marginBottom: 20, backgroundColor: COLORS.dangerBg, border: `1px solid #F1C3C9`,
                  borderRadius: 8, color: COLORS.dangerText, fontSize: 14, fontWeight: 500,
                }}>
                  ⚠️ Aucun département configuré. Tant qu'aucun département n'existe, l'accueil ne peut pas
                  créer de tickets et vous ne pouvez pas créer de comptes médecin. Ajoutez-en au moins un ci-dessous.
                </div>
              )}

              <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
                <input
                  value={newDeptName}
                  onChange={(e) => setNewDeptName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { addDepartment(newDeptName); setNewDeptName(""); } }}
                  placeholder="Nom du nouveau département (ex: Pédiatrie)"
                  style={{ ...fieldStyle, flex: 1, marginBottom: 0 }}
                />
                <button
                  onClick={() => { addDepartment(newDeptName); setNewDeptName(""); }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#119A31"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(20,181,58,0.3)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = COLORS.green; e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.transform = "translateY(0)"; }}
                  style={{ padding: "10px 20px", backgroundColor: COLORS.green, color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", transition: "background-color 0.15s, box-shadow 0.15s, transform 0.15s" }}
                >
                  + Ajouter
                </button>
              </div>

              {departments.length > 0 && (
                <div style={{ border: `1px solid ${COLORS.line}`, borderRadius: 10, overflow: "hidden" }}>
                  {departments.map((d, i) => (
                    <div key={d} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "14px 18px", backgroundColor: COLORS.card,
                      borderBottom: i < departments.length - 1 ? `1px solid ${COLORS.line}` : "none",
                    }}>
                      <span style={{ fontWeight: 700, color: COLORS.ink, fontSize: 15 }}>{d}</span>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => renameDepartment(d)} style={miniBtnStyle("#2E5C8C")}>Renommer</button>
                        <button onClick={() => deleteDepartment(d)} style={miniBtnStyle(COLORS.red)}>Supprimer</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "devices" && (
            <div style={{
              padding: 26, backgroundColor: COLORS.card, borderRadius: 10,
              border: `1px solid ${COLORS.line}`, borderTop: `4px solid #6B4226`,
              boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
            }}>
              <h2 style={{ color: COLORS.ink, marginTop: 0, marginBottom: 4, fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 700 }}>
                📱 Appareils — Personnel
              </h2>
              <p style={{ color: COLORS.slate, fontSize: 13, marginTop: 0, marginBottom: 24, maxWidth: 720 }}>
                Médecins, infirmiers, accueil et superviseurs ne peuvent pas se connecter tant que l'appareil
                utilisé n'est pas approuvé ici. Les administrateurs d'hôpital (hospitaladmin) ne sont pas
                gérés depuis cette page — leurs demandes sont approuvées uniquement par le Super Admin.
              </p>

              <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.slate, textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 10 }}>
                🔔 Demandes en attente {pendingDevices.length > 0 && `(${pendingDevices.length})`}
              </div>

              {pendingDevices.length === 0 ? (
                <div style={{ padding: "20px 18px", backgroundColor: COLORS.paper, borderRadius: 8, border: `1px solid ${COLORS.line}`, marginBottom: 30, textAlign: "center" }}>
                  <p style={{ fontSize: 13.5, color: COLORS.slate, margin: 0 }}>
                    Aucune demande en attente pour l'instant. Dès qu'un membre du personnel tente de se
                    connecter depuis un nouvel appareil, sa demande apparaîtra ici automatiquement.
                  </p>
                </div>
              ) : (
                <div style={{ display: "grid", gap: 8, marginBottom: 30 }}>
                  {pendingDevices.map((d) => (
                    <div key={d.id} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8,
                      padding: "12px 14px", backgroundColor: "#FDF3E3", borderRadius: 8, border: "1px solid #E8D5A8",
                    }}>
                      <div>
                        <div style={{ fontWeight: 700, color: COLORS.ink, fontSize: 13.5 }}>
                          {d.userName || d.userEmail} <span style={{ fontWeight: 400, color: COLORS.slate }}>({ROLE_LABELS[d.role] || d.role})</span>
                        </div>
                        <div style={{ fontSize: 11.5, color: COLORS.slate, marginTop: 2 }}>
                          {d.deviceLabel || "Appareil inconnu"} · demandé le {new Date(d.registeredAt).toLocaleDateString("fr-FR")} à {new Date(d.registeredAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => approvePendingDevice(d)} disabled={approvingPendingId === d.id} style={{
                          padding: "6px 14px", backgroundColor: COLORS.green, color: "white", border: "none",
                          borderRadius: 5, cursor: approvingPendingId === d.id ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 600,
                        }}>
                          {approvingPendingId === d.id ? "…" : "Approuver"}
                        </button>
                        <button onClick={() => denyPendingDevice(d)} disabled={approvingPendingId === d.id} style={{
                          padding: "6px 14px", backgroundColor: "transparent", color: COLORS.red, border: `1px solid ${COLORS.red}`,
                          borderRadius: 5, cursor: approvingPendingId === d.id ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 600,
                        }}>
                          Refuser
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.slate, textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 10 }}>
                ✅ Appareils déjà approuvés {activeDevices.length > 0 && `(${activeDevices.length})`}
              </div>
              {activeDevices.length === 0 ? (
                <p style={{ fontSize: 13.5, color: COLORS.slate }}>Aucun appareil approuvé pour l'instant.</p>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {activeDevices.map((d) => (
                    <div key={d.id} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8,
                      padding: "12px 14px", backgroundColor: COLORS.successBg, borderRadius: 8, border: "1px solid #BEE3C5",
                    }}>
                      <div>
                        <div style={{ fontWeight: 700, color: COLORS.ink, fontSize: 13.5 }}>
                          {d.userName || d.userEmail} <span style={{ fontWeight: 400, color: COLORS.slate }}>({ROLE_LABELS[d.role] || d.role})</span>
                        </div>
                        <div style={{ fontSize: 11.5, color: COLORS.slate, marginTop: 2 }}>
                          {d.deviceLabel || "Appareil inconnu"} · approuvé le {d.approvedAt ? new Date(d.approvedAt).toLocaleDateString("fr-FR") : "—"}
                        </div>
                      </div>
                      <button onClick={() => revokeActiveDeviceFromList(d)} disabled={revokingActiveDeviceId === d.id} style={{
                        padding: "6px 14px", backgroundColor: COLORS.red, color: "white", border: "none",
                        borderRadius: 5, cursor: revokingActiveDeviceId === d.id ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 600,
                      }}>
                        {revokingActiveDeviceId === d.id ? "…" : "Révoquer"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "logins" && (() => {
            const roleLabels = { hospitaladmin: "Admin. hôpital", doctor: "Médecin", nurse: "Infirmier·ère", accueil: "Accueil", supervisor: "Superviseur", pharmacy: "Pharmacie", lab: "Laboratoire" };
            const filtered = staff.filter((u) => {
              if (loginsSearch.trim()) {
                const term = loginsSearch.trim().toLowerCase();
                const name = `${u.firstName || ""} ${u.lastName || ""}`.toLowerCase();
                if (!name.includes(term) && !(u.email || "").toLowerCase().includes(term)) return false;
              }
              if (loginsRole !== "all" && u.role !== loginsRole) return false;
              if (loginsDepartment !== "all" && u.department !== loginsDepartment) return false;
              if (loginsDate && (!u.lastLoginAt || u.lastLoginAt.slice(0, 10) !== loginsDate)) return false;
              if (loginsStatus === "online" && !u.online) return false;
              if (loginsStatus === "offline" && u.online) return false;
              return true;
            });
            return (
              <div>
                <h2 style={{ color: COLORS.ink, margin: "0 0 4px 0", fontFamily: FONT_DISPLAY, fontSize: 22 }}>Connexions du personnel</h2>
                <p style={{ color: COLORS.slate, fontSize: 13, marginTop: 0, marginBottom: 20 }}>
                  Dernière connexion de chaque membre du personnel de {hospital?.name}. La date filtre sur le
                  jour de la DERNIÈRE connexion de chacun — pas un historique complet de toutes les connexions passées.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr 1fr 0.8fr", gap: 10, marginBottom: 18 }}>
                  <input
                    placeholder="🔍 Rechercher par nom ou email…"
                    value={loginsSearch}
                    onChange={(e) => setLoginsSearch(e.target.value)}
                    style={{ ...fieldStyle, marginBottom: 0 }}
                  />
                  <select value={loginsRole} onChange={(e) => setLoginsRole(e.target.value)} style={{ ...fieldStyle, marginBottom: 0 }}>
                    <option value="all">Tous les rôles</option>
                    <option value="doctor">Médecin</option>
                    <option value="nurse">Infirmier·ère</option>
                    <option value="accueil">Accueil</option>
                    <option value="supervisor">Superviseur</option>
                    <option value="pharmacy">Pharmacie</option>
                    <option value="lab">Laboratoire</option>
                  </select>
                  <select value={loginsDepartment} onChange={(e) => setLoginsDepartment(e.target.value)} style={{ ...fieldStyle, marginBottom: 0 }}>
                    <option value="all">Tous les départements</option>
                    {departments.map((d) => (<option key={d} value={d}>{d}</option>))}
                  </select>
                  <input
                    type="date"
                    value={loginsDate}
                    onChange={(e) => setLoginsDate(e.target.value)}
                    style={{ ...fieldStyle, marginBottom: 0 }}
                  />
                  <select value={loginsStatus} onChange={(e) => setLoginsStatus(e.target.value)} style={{ ...fieldStyle, marginBottom: 0 }}>
                    <option value="all">Tous</option>
                    <option value="online">🟢 En ligne</option>
                    <option value="offline">⚪ Hors ligne</option>
                  </select>
                </div>

                <div style={{ fontSize: 13, color: COLORS.slate, marginBottom: 10 }}>
                  {filtered.length} résultat{filtered.length !== 1 ? "s" : ""} sur {staff.length}
                </div>
                <div style={{ overflowX: "auto", border: `1px solid ${COLORS.line}`, borderRadius: 10 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", backgroundColor: COLORS.card }}>
                    <thead>
                      <tr style={{ backgroundColor: COLORS.ink, color: "white" }}>
                        {["Nom", "Rôle", "Département", "Dernière connexion", "Dernière déconnexion", "Statut"].map((h) => (
                          <th key={h} style={{ padding: "12px 14px", textAlign: "left", fontSize: 11.5, textTransform: "uppercase", letterSpacing: "0.03em" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.length === 0 ? (
                        <tr><td colSpan="6" style={{ padding: 30, textAlign: "center", color: COLORS.slate }}>Aucun résultat pour ce filtre.</td></tr>
                      ) : (
                        filtered.map((u) => (
                          <tr key={u.id} style={{ borderBottom: `1px solid ${COLORS.line}` }}>
                            <td style={{ padding: "10px 14px", fontWeight: 700, color: COLORS.ink, fontSize: 13 }}>{u.firstName} {u.lastName}</td>
                            <td style={{ padding: "10px 14px", fontSize: 12.5 }}>{roleLabels[u.role] || u.role}</td>
                            <td style={{ padding: "10px 14px", fontSize: 12.5, color: COLORS.slate }}>{u.department || "—"}</td>
                            <td style={{ padding: "10px 14px", fontSize: 12.5, color: COLORS.slate }}>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString("fr-FR") : "—"}</td>
                            <td style={{ padding: "10px 14px", fontSize: 12.5, color: COLORS.slate }}>{u.lastLogoutAt ? new Date(u.lastLogoutAt).toLocaleString("fr-FR") : "—"}</td>
                            <td style={{ padding: "10px 14px" }}>
                              <span style={{
                                padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 5,
                                backgroundColor: u.online ? COLORS.successBg : "#EDECE7", color: u.online ? COLORS.successText : COLORS.slate,
                              }}>
                                <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: u.online ? COLORS.successText : COLORS.slate }} />
                                {u.online ? "En ligne" : "Hors ligne"}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}

          {activeTab === "beds" && (
            <div>
              <h2 style={{ color: COLORS.ink, margin: "0 0 4px 0", fontFamily: FONT_DISPLAY, fontSize: 22 }}>Gestion des lits</h2>
              <p style={{ color: COLORS.slate, fontSize: 13, marginTop: 0, marginBottom: 20 }}>
                Une chambre appartient à un département et peut contenir plusieurs lits. Les superviseurs de département
                peuvent aussi créer des chambres, mais uniquement pour leur propre département.
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
                    <StatCard label="Occupés" value={occupied} accent={COLORS.dangerText} />
                  </div>
                );
              })()}

              <div style={{ padding: 20, marginBottom: 26, backgroundColor: COLORS.card, borderRadius: 10, border: `1px solid ${COLORS.line}`, borderTop: `4px solid ${COLORS.gold}` }}>
                <div style={{ fontWeight: 700, color: COLORS.ink, marginBottom: 14, fontSize: 14.5 }}>Créer une chambre</div>
                <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1.2fr 0.8fr auto", gap: 10 }}>
                  <input placeholder="Nom de la chambre (ex: Chambre 12)" value={newRoomForm.name} onChange={(e) => setNewRoomForm({ ...newRoomForm, name: e.target.value })} disabled={creatingRoom} style={fieldStyle2} />
                  <select value={newRoomForm.department} onChange={(e) => setNewRoomForm({ ...newRoomForm, department: e.target.value })} disabled={creatingRoom} style={fieldStyle2}>
                    <option value="">Département…</option>
                    {departments.map((d) => (<option key={d}>{d}</option>))}
                  </select>
                  <input type="number" min="1" placeholder="Nb. de lits" value={newRoomForm.numberOfBeds} onChange={(e) => setNewRoomForm({ ...newRoomForm, numberOfBeds: e.target.value })} disabled={creatingRoom} style={fieldStyle2} />
                  <button
                    onClick={createRoom}
                    disabled={creatingRoom}
                    onMouseEnter={(e) => { if (!e.currentTarget.disabled) { e.currentTarget.style.backgroundColor = "#119A31"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(20,181,58,0.3)"; e.currentTarget.style.transform = "translateY(-1px)"; } }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = COLORS.green; e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.transform = "translateY(0)"; }}
                    style={{
                      padding: "10px 20px", backgroundColor: COLORS.green, color: "white", border: "none",
                      borderRadius: 6, cursor: creatingRoom ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 13.5,
                      opacity: creatingRoom ? 0.7 : 1, whiteSpace: "nowrap", transition: "background-color 0.15s, box-shadow 0.15s, transform 0.15s",
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
                departments.filter((dept) => rooms.some((r) => r.department === dept)).map((dept) => (
                  <div key={dept} style={{ marginBottom: 26 }}>
                    <h3 style={sectionHeadingStyle}>{dept}</h3>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14, marginTop: 12 }}>
                      {rooms.filter((r) => r.department === dept).map((room) => {
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
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === "staff" && (
            <>
              {/* Create staff */}
              <div style={{
                marginBottom: 28, padding: 24, backgroundColor: COLORS.card, borderRadius: 10,
                border: `1px solid ${COLORS.line}`, borderTop: `4px solid ${COLORS.gold}`,
                boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
              }}>
                <h3 style={{ color: COLORS.ink, marginTop: 0, marginBottom: 18, fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700 }}>
                  Créer un compte — médecin ou accueil
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <input placeholder="Prénom" value={staffForm.firstName} onChange={(e) => setStaffForm({ ...staffForm, firstName: e.target.value })} disabled={creating} style={fieldStyle} />
                  <input placeholder="Nom" value={staffForm.lastName} onChange={(e) => setStaffForm({ ...staffForm, lastName: e.target.value })} disabled={creating} style={fieldStyle} />
                </div>
                <input placeholder="Email" type="email" value={staffForm.email} onChange={(e) => setStaffForm({ ...staffForm, email: e.target.value })} disabled={creating} style={fieldStyle} />
                <div style={{ marginBottom: 12 }}>
                  <div style={{
                    display: "flex", alignItems: "stretch", borderRadius: 8, overflow: "hidden",
                    border: `1.5px solid ${passwordFieldFocused ? COLORS.green : (justGeneratedPassword ? COLORS.gold : COLORS.line)}`,
                    boxShadow: passwordFieldFocused
                      ? "0 0 0 3px rgba(20,181,58,0.14)"
                      : justGeneratedPassword
                        ? "0 0 0 3px rgba(252,209,22,0.28)"
                        : "0 1px 2px rgba(0,0,0,0.03)",
                    backgroundColor: "#fff",
                    transition: "border-color 0.2s ease, box-shadow 0.2s ease",
                  }}>
                    <span style={{
                      display: "flex", alignItems: "center", paddingLeft: 13, paddingRight: 2,
                      color: COLORS.slate, fontSize: 14, opacity: 0.8,
                    }}>
                      🔒
                    </span>
                    <input
                      placeholder="Mot de passe temporaire"
                      value={staffForm.password}
                      onChange={(e) => setStaffForm({ ...staffForm, password: e.target.value })}
                      onFocus={() => setPasswordFieldFocused(true)}
                      onBlur={() => setPasswordFieldFocused(false)}
                      disabled={creating}
                      style={{
                        flex: 1, minWidth: 0, padding: "11px 10px", border: "none", outline: "none",
                        fontSize: 14.5, fontFamily: "'SFMono-Regular', 'Consolas', 'Menlo', monospace",
                        letterSpacing: "0.03em", color: COLORS.ink, backgroundColor: "transparent",
                        boxSizing: "border-box",
                      }}
                    />
                    <button
                      type="button"
                      onClick={generatePassword}
                      disabled={creating}
                      title="Générer un mot de passe temporaire sécurisé"
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = "#EABF0C";
                        const icon = e.currentTarget.querySelector("[data-gen-icon]");
                        if (icon) icon.style.transform = "rotate(-18deg) scale(1.12)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = COLORS.gold;
                        const icon = e.currentTarget.querySelector("[data-gen-icon]");
                        if (icon) icon.style.transform = "rotate(0deg) scale(1)";
                      }}
                      style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "0 18px",
                        backgroundColor: COLORS.gold, color: COLORS.ink, border: "none",
                        borderLeft: `1.5px solid ${passwordFieldFocused ? COLORS.green : COLORS.line}`,
                        cursor: creating ? "not-allowed" : "pointer",
                        fontWeight: 700, fontSize: 13, fontFamily: FONT_BODY, whiteSpace: "nowrap",
                        letterSpacing: "0.02em", transition: "background-color 0.15s, border-color 0.2s",
                      }}
                    >
                      <span data-gen-icon style={{ display: "inline-block", fontSize: 16, transition: "transform 0.3s ease" }}>
                        🪄
                      </span>
                      Générer
                    </button>
                  </div>
                  <div style={{ fontSize: 11.5, color: COLORS.slate, marginTop: 5, paddingLeft: 2 }}>
                    Utilisez le mot de passe généré ou saisissez le vôtre — communiquez-le à la personne séparément, en dehors de l'application.
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: staffForm.role === "doctor" ? "1fr 1fr 1fr" : DEPARTMENT_SCOPED_ROLES.includes(staffForm.role) ? "1fr 1fr" : "1fr", gap: 12 }}>
                  <select value={staffForm.role} onChange={(e) => setStaffForm({ ...staffForm, role: e.target.value })} disabled={creating} style={fieldStyle}>
                    <option value="accueil">Accueil</option>
                    <option value="nurse">Infirmier·ère</option>
                    <option value="doctor">Médecin</option>
                    <option value="supervisor">Superviseur de département</option>
                    <option value="pharmacy">Personnel Pharmacie</option>
                    <option value="lab">Personnel Laboratoire</option>
                  </select>
                  {staffForm.role === "doctor" && (
                    <>
                      {departments.length === 0 ? (
                        <div style={{ fontSize: 12.5, color: COLORS.dangerText, alignSelf: "center" }}>
                          Aucun département configuré — voir l'onglet Départements.
                        </div>
                      ) : (
                        <select value={staffForm.department} onChange={(e) => setStaffForm({ ...staffForm, department: e.target.value })} disabled={creating} style={fieldStyle}>
                          {departments.map((d) => (<option key={d}>{d}</option>))}
                        </select>
                      )}
                      <input placeholder="Chambre (ex: 201)" value={staffForm.room} onChange={(e) => setStaffForm({ ...staffForm, room: e.target.value })} disabled={creating} style={fieldStyle} />
                    </>
                  )}
                  {(staffForm.role === "nurse" || staffForm.role === "supervisor") && (
                    departments.length === 0 ? (
                      <div style={{ fontSize: 12.5, color: COLORS.dangerText, alignSelf: "center" }}>
                        Aucun département configuré — voir l'onglet Départements.
                      </div>
                    ) : (
                      <select value={staffForm.department} onChange={(e) => setStaffForm({ ...staffForm, department: e.target.value })} disabled={creating} style={fieldStyle}>
                        {departments.map((d) => (<option key={d}>{d}</option>))}
                      </select>
                    )
                  )}
                  {/* pharmacy/lab: no department field — they serve the whole
                      hospital, not one department */}
                </div>
                <button
                  onClick={createStaff}
                  disabled={creating || (DEPARTMENT_SCOPED_ROLES.includes(staffForm.role) && departments.length === 0)}
                  onMouseEnter={(e) => { if (!e.currentTarget.disabled) { e.currentTarget.style.backgroundColor = "#119A31"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(20,181,58,0.32)"; e.currentTarget.style.transform = "translateY(-1px)"; } }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = COLORS.green; e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.transform = "translateY(0)"; }}
                  style={{
                    width: "100%", padding: 14, backgroundColor: COLORS.green, color: "white", border: "none",
                    borderRadius: 6, cursor: (creating || (DEPARTMENT_SCOPED_ROLES.includes(staffForm.role) && departments.length === 0)) ? "not-allowed" : "pointer", fontSize: 15.5, fontWeight: 700,
                    marginTop: 10, opacity: (creating || (DEPARTMENT_SCOPED_ROLES.includes(staffForm.role) && departments.length === 0)) ? 0.7 : 1, letterSpacing: "0.01em",
                    transition: "background-color 0.15s, box-shadow 0.15s, transform 0.15s",
                  }}>
                  {creating ? "Création en cours…" : "Créer le compte"}
                </button>
              </div>

              {/* Sub-tabs */}
              <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
                {[{ key: "all", label: `Tous (${staff.length})` }, { key: "active", label: `Actifs (${activeCount})` }, { key: "disabled", label: `Désactivés (${disabledCount})` }].map((tab) => (
                  <button key={tab.key} onClick={() => setStaffSubTab(tab.key)} style={{
                    padding: "9px 18px", borderRadius: 20, cursor: "pointer", fontSize: 13.5, fontWeight: 600,
                    border: `1px solid ${staffSubTab === tab.key ? COLORS.green : COLORS.line}`,
                    backgroundColor: staffSubTab === tab.key ? COLORS.green : COLORS.card,
                    color: staffSubTab === tab.key ? "#fff" : COLORS.slate,
                    transition: "all 0.15s",
                  }}>
                    {tab.label}
                  </button>
                ))}
              </div>

              <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
                <input type="text" placeholder="Rechercher par nom ou email…" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} style={{ ...fieldStyle, flex: 1, marginBottom: 0 }} />
                <select value={filterRole} onChange={(e) => setFilterRole(e.target.value)} style={{ ...fieldStyle, width: 200, marginBottom: 0 }}>
                  <option value="all">Tous les rôles</option>
                  <option value="doctor">Médecin</option>
                  <option value="nurse">Infirmier·ère</option>
                  <option value="accueil">Accueil</option>
                  <option value="supervisor">Superviseur</option>
                  <option value="pharmacy">Pharmacie</option>
                  <option value="lab">Laboratoire</option>
                </select>
              </div>

              <div style={{ overflowX: "auto", border: `1px solid ${COLORS.line}`, borderRadius: 10 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", backgroundColor: COLORS.card }}>
                  <thead>
                    <tr style={{ backgroundColor: COLORS.ink, color: "white" }}>
                      {["Nom", "Email", "Rôle", "Département", "Chambre", "Statut", "Actions"].map((h) => (
                        <th key={h} style={{ padding: "14px 16px", textAlign: "left", fontSize: 12.5, letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStaff.length === 0 ? (
                      <tr><td colSpan="7" style={{ padding: 36, textAlign: "center", color: COLORS.slate }}>Aucun utilisateur trouvé</td></tr>
                    ) : (
                      filteredStaff.map((user) => (
                        <tr key={user.id} style={{ borderBottom: `1px solid ${COLORS.line}`, backgroundColor: user.disabled ? "#FCF3F3" : "white" }}>
                          <td style={{ padding: "13px 16px" }}>
                            {editingUser === user.id ? (
                              <div style={{ display: "flex", gap: 5 }}>
                                <input value={editForm.firstName} onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })} style={{ width: 80, padding: 5, borderRadius: 4, border: `1px solid ${COLORS.line}` }} />
                                <input value={editForm.lastName} onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })} style={{ width: 80, padding: 5, borderRadius: 4, border: `1px solid ${COLORS.line}` }} />
                              </div>
                            ) : (<strong style={{ color: COLORS.ink }}>{user.firstName} {user.lastName}</strong>)}
                          </td>
                          <td style={{ padding: "13px 16px", fontSize: 14, color: COLORS.slate }}>{user.email}</td>
                          <td style={{ padding: "13px 16px" }}>
                            <span style={{
                              padding: "4px 11px", borderRadius: 20, fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em",
                              backgroundColor: (ROLE_BADGE_COLORS[user.role] || ROLE_BADGE_COLORS.accueil).bg,
                              color: (ROLE_BADGE_COLORS[user.role] || ROLE_BADGE_COLORS.accueil).text,
                            }}>{ROLE_LABELS[user.role] || user.role}</span>
                          </td>
                          <td style={{ padding: "13px 16px", color: COLORS.ink }}>
                            {editingUser === user.id && DEPARTMENT_SCOPED_ROLES.includes(user.role) ? (
                              <select value={editForm.department} onChange={(e) => setEditForm({ ...editForm, department: e.target.value })} style={{ padding: 5, width: "100%", borderRadius: 4, border: `1px solid ${COLORS.line}` }}>
                                {/* If this staff member's current department was since deleted
                                    from the active list, still show it (marked as removed) so it
                                    doesn't silently disappear from the dropdown — the admin can
                                    see it and consciously choose to reassign it. */}
                                {editForm.department && !departments.includes(editForm.department) && (
                                  <option value={editForm.department}>{editForm.department} (supprimé)</option>
                                )}
                                {departments.map((d) => (<option key={d}>{d}</option>))}
                              </select>
                            ) : (user.department || "—")}
                          </td>
                          <td style={{ padding: "13px 16px", color: COLORS.ink }}>
                            {editingUser === user.id && user.role === "doctor" ? (
                              <input value={editForm.room} onChange={(e) => setEditForm({ ...editForm, room: e.target.value })} style={{ padding: 5, width: 60, borderRadius: 4, border: `1px solid ${COLORS.line}` }} />
                            ) : (user.room || "—")}
                          </td>
                          <td style={{ padding: "13px 16px" }}>
                            <span style={{
                              padding: "4px 11px", borderRadius: 20, fontSize: 12, fontWeight: 700,
                              backgroundColor: user.disabled ? COLORS.dangerBg : COLORS.successBg,
                              color: user.disabled ? COLORS.dangerText : COLORS.successText,
                            }}>
                              {user.disabled ? "Désactivé" : "Actif"}
                            </span>
                          </td>
                          <td style={{ padding: "10px 16px" }}>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              {editingUser === user.id ? (
                                <>
                                  <button onClick={() => saveEdit(user.id, user)} style={miniBtnStyle(COLORS.green)}>Sauver</button>
                                  <button onClick={() => setEditingUser(null)} style={miniBtnStyle(COLORS.slate)}>Annuler</button>
                                </>
                              ) : (
                                <>
                                  {user.disabled ? (
                                    <button onClick={() => enableUser(user.id, user)} style={miniBtnStyle("#2E7D8C")}>Réactiver</button>
                                  ) : (
                                    <button onClick={() => disableUser(user.id, user)} style={miniBtnStyle("#B8860B")}>Désactiver</button>
                                  )}
                                  <button onClick={() => startEdit(user)} style={miniBtnStyle("#2E5C8C")}>Modifier</button>
                                  <button onClick={() => openStaffSessions(user)} style={miniBtnStyle("#6B4226")}>Sessions</button>
                                  <button onClick={() => deleteUser(user.id, user)} style={miniBtnStyle(COLORS.red)}>Supprimer</button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {activeTab === "activity" && (
            <div>
              {activityLoading ? (
                <div style={{ textAlign: "center", padding: 50, color: COLORS.slate }}>Chargement de l'activité…</div>
              ) : (
                <>
                  <h3 style={sectionHeadingStyle}>Statut des médecins</h3>
                  <div style={{ overflowX: "auto", border: `1px solid ${COLORS.line}`, borderRadius: 10, marginBottom: 32 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", backgroundColor: COLORS.card }}>
                      <thead><tr style={{ backgroundColor: COLORS.ink, color: "white" }}>
                        {["Médecin", "Département", "Chambre", "Statut", "Dernière connexion", "Dernière déconnexion"].map((h) => (
                          <th key={h} style={{ padding: "14px 16px", textAlign: "left", fontSize: 12.5, textTransform: "uppercase", letterSpacing: "0.04em" }}>{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {staff.filter((u) => u.role === "doctor").length === 0 ? (
                          <tr><td colSpan="6" style={{ padding: 36, textAlign: "center", color: COLORS.slate }}>Aucun médecin trouvé</td></tr>
                        ) : staff.filter((u) => u.role === "doctor").map((physician) => (
                          <tr key={physician.id} style={{ borderBottom: `1px solid ${COLORS.line}` }}>
                            <td style={{ padding: "13px 16px", fontWeight: 700, color: COLORS.ink }}>Dr. {physician.firstName} {physician.lastName}</td>
                            <td style={{ padding: "13px 16px" }}>{physician.department || "—"}</td>
                            <td style={{ padding: "13px 16px" }}>{physician.room || "—"}</td>
                            <td style={{ padding: "13px 16px" }}>
                              <span style={{
                                padding: "4px 11px", borderRadius: 20, fontSize: 12, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6,
                                backgroundColor: physician.online ? COLORS.successBg : "#EDECE7",
                                color: physician.online ? COLORS.successText : COLORS.slate,
                              }}>
                                <span style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: physician.online ? COLORS.successText : COLORS.slate, display: "inline-block" }} />
                                {physician.online ? "Actif" : "Hors ligne"}
                              </span>
                            </td>
                            <td style={{ padding: "13px 16px", fontSize: 13, color: COLORS.slate }}>{physician.lastLoginAt ? new Date(physician.lastLoginAt).toLocaleString("fr-FR") : "—"}</td>
                            <td style={{ padding: "13px 16px", fontSize: 13, color: COLORS.slate }}>{physician.lastLogoutAt ? new Date(physician.lastLogoutAt).toLocaleString("fr-FR") : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
                    <h3 style={{ ...sectionHeadingStyle, marginBottom: 0 }}>Durée des consultations</h3>
                    <input
                      type="date"
                      value={consultationDateFilter}
                      onChange={(e) => setConsultationDateFilter(e.target.value)}
                      style={{ padding: "7px 10px", borderRadius: 6, border: `1px solid ${COLORS.line}`, fontSize: 13 }}
                    />
                  </div>
                  <div style={{ overflowX: "auto", border: `1px solid ${COLORS.line}`, borderRadius: 10, marginBottom: 28 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", backgroundColor: COLORS.card, fontSize: 12.5 }}>
                      <thead><tr style={{ backgroundColor: COLORS.ink, color: "white" }}>
                        {["Patient", "Ticket", "Médecin", "Dépt.", "Début", "Statut", "Durée"].map((h) => (
                          <th key={h} style={{ padding: "6px 10px", textAlign: "left", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.03em" }}>{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {consultations.length === 0 ? (
                          <tr><td colSpan="7" style={{ padding: 20, textAlign: "center", color: COLORS.slate }}>Aucune consultation ce jour-là</td></tr>
                        ) : consultations.map((t) => {
                          const isInProgress = t.status === "in-progress";
                          const elapsed = isInProgress
                            ? Math.floor((nowTick - new Date(t.consultationStartedAt).getTime()) / 1000)
                            : t.consultationDurationSeconds;
                          return (
                            <tr key={t.id} style={{ borderBottom: `1px solid ${COLORS.line}` }}>
                              <td style={{ padding: "4px 10px", fontWeight: 600, color: COLORS.ink }}>{t.patientName || "—"}</td>
                              <td style={{ padding: "4px 10px" }}>{t.ticketNumber || "—"}</td>
                              <td style={{ padding: "4px 10px" }}>{t.consultationDoctorName || "—"}</td>
                              <td style={{ padding: "4px 10px" }}>{t.department || "—"}</td>
                              <td style={{ padding: "4px 10px", color: COLORS.slate }}>{new Date(t.consultationStartedAt).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                              <td style={{ padding: "4px 10px" }}>
                                <span style={{
                                  padding: "2px 8px", borderRadius: 20, fontSize: 10.5, fontWeight: 700,
                                  backgroundColor: isInProgress ? "#E8F0FB" : COLORS.successBg,
                                  color: isInProgress ? "#2E5C8C" : COLORS.successText,
                                }}>
                                  {isInProgress ? "En cours" : "Terminée"}
                                </span>
                              </td>
                              <td style={{ padding: "4px 10px", fontFamily: "monospace", fontWeight: 700, color: isInProgress ? "#2E5C8C" : COLORS.ink }}>
                                {isInProgress ? `⏱ ${formatDuration(elapsed)}` : formatDuration(elapsed)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
                    <h3 style={{ ...sectionHeadingStyle, marginBottom: 0 }}>Historique des connexions</h3>
                    <input
                      type="date"
                      value={sessionDateFilter}
                      onChange={(e) => setSessionDateFilter(e.target.value)}
                      style={{ padding: "7px 10px", borderRadius: 6, border: `1px solid ${COLORS.line}`, fontSize: 13 }}
                    />
                  </div>
                  <div style={{ overflowX: "auto", border: `1px solid ${COLORS.line}`, borderRadius: 10, maxHeight: 340, overflowY: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", backgroundColor: COLORS.card, fontSize: 12.5 }}>
                      <thead style={{ position: "sticky", top: 0 }}><tr style={{ backgroundColor: COLORS.ink, color: "white" }}>
                        {["Médecin", "Première connexion", "Dernière déconnexion", "Temps total ce jour"].map((h) => (
                          <th key={h} style={{ padding: "6px 10px", textAlign: "left", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.03em" }}>{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {(() => {
                          // One row per doctor per day, not one row per
                          // session — a doctor logging in/out several
                          // times the same day would otherwise repeat
                          // their name down the whole table.
                          const dayMatches = doctorSessions.filter((s) => s.loginAt.slice(0, 10) === sessionDateFilter);
                          const byDoctor = {};
                          dayMatches.forEach((s) => {
                            if (!byDoctor[s.doctorId]) byDoctor[s.doctorId] = { doctorName: s.doctorName, sessions: [] };
                            byDoctor[s.doctorId].sessions.push(s);
                          });
                          const rows = Object.values(byDoctor).map((group) => {
                            const sorted = [...group.sessions].sort((a, b) => new Date(a.loginAt) - new Date(b.loginAt));
                            const firstLogin = sorted[0].loginAt;
                            const stillOpen = sorted[sorted.length - 1].logoutAt == null;
                            const lastLogout = stillOpen ? null : sorted[sorted.length - 1].logoutAt;
                            const totalSeconds = sorted.reduce((sum, s) => {
                              const end = s.logoutAt ? new Date(s.logoutAt).getTime() : nowTick;
                              return sum + Math.round((end - new Date(s.loginAt).getTime()) / 1000);
                            }, 0);
                            return { doctorName: group.doctorName, firstLogin, lastLogout, stillOpen, totalSeconds };
                          }).sort((a, b) => a.doctorName.localeCompare(b.doctorName));

                          if (rows.length === 0) {
                            return <tr><td colSpan="4" style={{ padding: 20, textAlign: "center", color: COLORS.slate }}>Aucune session ce jour-là</td></tr>;
                          }
                          return rows.map((r) => (
                            <tr key={r.doctorName} style={{ borderBottom: `1px solid ${COLORS.line}` }}>
                              <td style={{ padding: "5px 10px", fontWeight: 600, color: COLORS.ink }}>{r.doctorName}</td>
                              <td style={{ padding: "5px 10px", color: COLORS.slate }}>{new Date(r.firstLogin).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</td>
                              <td style={{ padding: "5px 10px", color: COLORS.slate }}>
                                {r.stillOpen ? <span style={{ color: COLORS.successText, fontWeight: 700 }}>En cours</span> : new Date(r.lastLogout).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                              </td>
                              <td style={{ padding: "5px 10px", fontFamily: "monospace", fontSize: 12 }}>
                                {Math.floor(r.totalSeconds / 3600)}h{String(Math.floor((r.totalSeconds % 3600) / 60)).padStart(2, "0")}
                              </td>
                            </tr>
                          ));
                        })()}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === "statistics" && (
            <div>
              <div style={{ marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2 style={{ color: COLORS.ink, margin: 0, fontFamily: FONT_DISPLAY, fontSize: 22 }}>Statistiques des tickets — {hospital?.name}</h2>
                <select value={selectedYear} onChange={(e) => setSelectedYear(e.target.value)} style={fieldStyle2}>
                  {[2024, 2025, 2026, 2027].map((year) => (<option key={year} value={year}>{year}</option>))}
                </select>
              </div>
              {statsLoading ? (
                <div style={{ textAlign: "center", padding: 50, color: COLORS.slate }}>Chargement des statistiques…</div>
              ) : (
                <>
                  <h3 style={sectionHeadingStyle}>Par département</h3>
                  <div style={{ overflowX: "auto", border: `1px solid ${COLORS.line}`, borderRadius: 10, marginBottom: 32 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", backgroundColor: COLORS.card }}>
                      <thead><tr style={{ backgroundColor: COLORS.ink, color: "white" }}>
                        {["Département", "Total", "Attente triage", "Prêt", "En cours", "Complétés", "Taux"].map((h) => (
                          <th key={h} style={{ padding: "14px 16px", textAlign: "left", fontSize: 12.5, textTransform: "uppercase", letterSpacing: "0.04em" }}>{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {stats.byDepartment.length === 0 ? (
                          <tr><td colSpan="7" style={{ padding: 36, textAlign: "center", color: COLORS.slate }}>Aucune donnée pour {selectedYear}</td></tr>
                        ) : stats.byDepartment.map((dept) => (
                          <tr key={dept.name} style={{ borderBottom: `1px solid ${COLORS.line}` }}>
                            <td style={{ padding: "13px 16px", fontWeight: 700, color: COLORS.ink }}>{dept.name}</td>
                            <td style={{ padding: "13px 16px" }}>{dept.total}</td>
                            <td style={{ padding: "13px 16px", color: "#6c757d", fontWeight: 600 }}>{dept.waiting}</td>
                            <td style={{ padding: "13px 16px", color: "#B8860B", fontWeight: 600 }}>{dept.ready}</td>
                            <td style={{ padding: "13px 16px", color: "#2E7D8C", fontWeight: 600 }}>{dept.inProgress}</td>
                            <td style={{ padding: "13px 16px", color: COLORS.successText, fontWeight: 600 }}>{dept.completed}</td>
                            <td style={{ padding: "13px 16px", fontWeight: 700 }}>{dept.completionRate}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <h3 style={sectionHeadingStyle}>Performance des médecins</h3>
                  <div style={{ overflowX: "auto", border: `1px solid ${COLORS.line}`, borderRadius: 10, marginBottom: 32 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", backgroundColor: COLORS.card }}>
                      <thead><tr style={{ backgroundColor: COLORS.ink, color: "white" }}>
                        {["Médecin", "Département", "Chambre", "Total Dépt.", "Complétés", "Taux", "Durée moy."].map((h) => (
                          <th key={h} style={{ padding: "14px 16px", textAlign: "left", fontSize: 12.5, textTransform: "uppercase", letterSpacing: "0.04em" }}>{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {stats.byDoctor.length === 0 ? (
                          <tr><td colSpan="7" style={{ padding: 36, textAlign: "center", color: COLORS.slate }}>Aucun médecin trouvé</td></tr>
                        ) : stats.byDoctor.map((doctor) => (
                          <tr key={doctor.id} style={{ borderBottom: `1px solid ${COLORS.line}` }}>
                            <td style={{ padding: "13px 16px", fontWeight: 700, color: COLORS.ink }}>{doctor.name}</td>
                            <td style={{ padding: "13px 16px" }}>{doctor.department}</td>
                            <td style={{ padding: "13px 16px" }}>{doctor.room}</td>
                            <td style={{ padding: "13px 16px" }}>{doctor.totalInDept}</td>
                            <td style={{ padding: "13px 16px", color: COLORS.successText, fontWeight: 700 }}>{doctor.completed}</td>
                            <td style={{ padding: "13px 16px", fontWeight: 700 }}>{doctor.completionRate}%</td>
                            <td style={{ padding: "13px 16px", color: COLORS.slate }}>{doctor.avgConsultationMinutes != null ? `${doctor.avgConsultationMinutes} min` : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <h3 style={sectionHeadingStyle}>Statistiques des maladies (diagnostics)</h3>
                  <p style={{ fontSize: 12.5, color: COLORS.slate, marginTop: -8, marginBottom: 14 }}>
                    {stats.totals ? `${stats.totals.completed} consultation(s) complétée(s), dont ${stats.diseases.reduce((s, d) => s + d.count, 0)} avec un diagnostic enregistré.` : ""}
                  </p>
                  <div style={{ overflowX: "auto", border: `1px solid ${COLORS.line}`, borderRadius: 10, marginBottom: 24 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", backgroundColor: COLORS.card }}>
                      <thead><tr style={{ backgroundColor: COLORS.ink, color: "white" }}>
                        {["Diagnostic", "Cas", "Répartition par département"].map((h) => (
                          <th key={h} style={{ padding: "14px 16px", textAlign: "left", fontSize: 12.5, textTransform: "uppercase", letterSpacing: "0.04em" }}>{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {stats.diseases.length === 0 ? (
                          <tr><td colSpan="3" style={{ padding: 36, textAlign: "center", color: COLORS.slate }}>Aucun diagnostic enregistré pour {selectedYear}</td></tr>
                        ) : stats.diseases.map((d) => (
                          <tr key={d.name} style={{ borderBottom: `1px solid ${COLORS.line}` }}>
                            <td style={{ padding: "13px 16px", fontWeight: 700, color: COLORS.ink }}>{d.name}</td>
                            <td style={{ padding: "13px 16px", fontWeight: 700, color: COLORS.successText }}>{d.count}</td>
                            <td style={{ padding: "13px 16px", fontSize: 12.5, color: COLORS.slate }}>
                              {Object.entries(d.byDepartment).map(([dept, n]) => `${dept} (${n})`).join(" · ")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {hospital?.ticketPrice != null && (
                    <div style={{
                      padding: 22, marginBottom: 18, backgroundColor: COLORS.ink, borderRadius: 10,
                    }}>
                      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
                        {[{ key: "day", label: "Jour" }, { key: "month", label: "Mois" }, { key: "year", label: "Année" }].map((opt) => (
                          <button
                            key={opt.key}
                            type="button"
                            onClick={() => setMontantPeriodType(opt.key)}
                            style={{
                              padding: "6px 14px", borderRadius: 20, cursor: "pointer", fontSize: 12.5, fontWeight: 600,
                              border: `1px solid ${montantPeriodType === opt.key ? COLORS.green : "rgba(255,255,255,0.3)"}`,
                              backgroundColor: montantPeriodType === opt.key ? COLORS.green : "transparent",
                              color: montantPeriodType === opt.key ? "#fff" : "rgba(255,255,255,0.75)",
                            }}
                          >
                            {opt.label}
                          </button>
                        ))}
                        {montantPeriodType === "day" && (
                          <input type="date" value={montantDate} onChange={(e) => setMontantDate(e.target.value)}
                            style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.3)", backgroundColor: "transparent", color: "white", fontSize: 12.5 }} />
                        )}
                        {montantPeriodType === "month" && (
                          <input type="month" value={montantMonth} onChange={(e) => setMontantMonth(e.target.value)}
                            style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.3)", backgroundColor: "transparent", color: "white", fontSize: 12.5 }} />
                        )}
                        {montantPeriodType === "year" && (
                          <select value={selectedYear} onChange={(e) => setSelectedYear(e.target.value)}
                            style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.3)", backgroundColor: COLORS.ink, color: "white", fontSize: 12.5 }}>
                            {[2024, 2025, 2026, 2027].map((y) => (<option key={y} value={y}>{y}</option>))}
                          </select>
                        )}
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 14 }}>
                        <div>
                          <div style={{ color: "rgba(255,255,255,0.65)", fontSize: 12.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                            Montant total {montantPeriodType === "day" ? `— ${new Date(montantDate + "T00:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}` : montantPeriodType === "month" ? `— ${new Date(montantMonth + "-01T00:00:00").toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}` : `— ${selectedYear}`}
                          </div>
                          <div style={{ color: "white", fontSize: 28, fontWeight: 700, fontFamily: FONT_DISPLAY, marginTop: 4 }}>
                            {montantLoading ? "…" : montantTicketCount != null ? `${(hospital.ticketPrice * montantTicketCount).toLocaleString("fr-FR")} FCFA` : "—"}
                          </div>
                        </div>
                        <div style={{ color: "rgba(255,255,255,0.8)", fontSize: 13, textAlign: "right" }}>
                          {hospital.ticketPrice.toLocaleString("fr-FR")} FCFA × {montantTicketCount ?? "—"} ticket{montantTicketCount === 1 ? "" : "s"}
                        </div>
                      </div>
                    </div>
                  )}

                  <div style={{
                    padding: 18, backgroundColor: COLORS.card, borderRadius: 10, border: `1px solid ${COLORS.line}`,
                    display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12,
                  }}>
                    <div>
                      <div style={{ fontWeight: 700, color: COLORS.ink, fontSize: 14.5 }}>Rapport administratif complet</div>
                      <div style={{ fontSize: 12.5, color: COLORS.slate, marginTop: 2 }}>
                        Total tickets: {stats.totals?.tickets ?? "—"} · Non présentés: {stats.totals?.noShow ?? "—"} · Durée moy. consultation: {stats.totals?.avgConsultationMinutes != null ? `${stats.totals.avgConsultationMinutes} min` : "—"}
                        {stats.priorityBreakdown && (
                          <> · 🔴 {stats.priorityBreakdown.emergency || 0} · 🟠 {stats.priorityBreakdown.urgent || 0} · 🟢 {stats.priorityBreakdown.normal || 0}</>
                        )}
                      </div>
                    </div>
                    <button onClick={printStatistics} style={{
                      padding: "10px 18px", backgroundColor: COLORS.ink, color: "white", border: "none",
                      borderRadius: 6, cursor: "pointer", fontSize: 13.5, fontWeight: 600, fontFamily: FONT_BODY, whiteSpace: "nowrap",
                    }}>
                      📄 Imprimer le rapport
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === "logs" && (
            <div>
              <div style={{ marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2 style={{ color: COLORS.ink, margin: 0, fontFamily: FONT_DISPLAY, fontSize: 22 }}>Historique des actions</h2>
                <select value={filterAction} onChange={(e) => setFilterAction(e.target.value)} style={fieldStyle2}>
                  <option value="all">Toutes les actions</option>
                  <option value="create">Créations</option>
                  <option value="disable">Désactivations</option>
                  <option value="enable">Réactivations</option>
                  <option value="delete">Suppressions</option>
                  <option value="update">Modifications</option>
                  <option value="dept_add">Départements ajoutés</option>
                  <option value="dept_rename">Départements renommés</option>
                  <option value="dept_delete">Départements supprimés</option>
                </select>
              </div>
              {logsLoading ? (
                <div style={{ textAlign: "center", padding: 50, color: COLORS.slate }}>Chargement…</div>
              ) : (
                <div style={{ overflowX: "auto", border: `1px solid ${COLORS.line}`, borderRadius: 10 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", backgroundColor: COLORS.card }}>
                    <thead><tr style={{ backgroundColor: COLORS.ink, color: "white" }}>
                      {["Date / Heure", "Action", "Utilisateur cible", "Détails"].map((h) => (
                        <th key={h} style={{ padding: "14px 16px", textAlign: "left", fontSize: 12.5, textTransform: "uppercase", letterSpacing: "0.04em" }}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {filteredLogs.length === 0 ? (
                        <tr><td colSpan="4" style={{ padding: 36, textAlign: "center", color: COLORS.slate }}>Aucun historique trouvé</td></tr>
                      ) : filteredLogs.map((log) => (
                        <tr key={log.id} style={{ borderBottom: `1px solid ${COLORS.line}` }}>
                          <td style={{ padding: "13px 16px", fontSize: 13, color: COLORS.slate }}>{new Date(log.timestamp).toLocaleString("fr-FR")}</td>
                          <td style={{ padding: "13px 16px" }}>
                            <span style={{ padding: "4px 11px", borderRadius: 20, backgroundColor: getActionColor(log.action), color: "white", fontSize: 12, fontWeight: 700 }}>
                              {getActionIcon(log.action)} {getActionText(log.action)}
                            </span>
                          </td>
                          <td style={{ padding: "13px 16px", fontWeight: 700, color: COLORS.ink }}>{log.targetUserName}</td>
                          <td style={{ padding: "13px 16px", fontSize: 13, color: COLORS.slate }}>
                            {log.details?.role && <div>Rôle : {log.details.role}</div>}
                            {log.details?.email && <div>Email : {log.details.email}</div>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === "search" && (
            <div>
              <h2 style={{ color: COLORS.ink, margin: "0 0 20px", fontFamily: FONT_DISPLAY, fontSize: 22 }}>
                Recherche
              </h2>

              {/* Search type selector */}
              <div style={{ display: "flex", gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
                {[
                  { key: "ticket", label: "Ticket #" },
                  { key: "patient", label: "Patient / ID patient" },
                  { key: "department", label: "Département" },
                  { key: "date", label: "Date" },
                  { key: "doctor", label: "Médecin" },
                ].map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => {
                      setSearchType(opt.key);
                      setGlobalSearchTerm("");
                      setSearchDate("");
                      setDoctorFilter("");
                      setSelectedDoctor(null);
                      setSearchResults([]);
                      setSearchRan(false);
                    }}
                    style={{
                      padding: "9px 18px", borderRadius: 20, cursor: "pointer", fontSize: 13.5, fontWeight: 600,
                      border: `1px solid ${searchType === opt.key ? COLORS.green : COLORS.line}`,
                      backgroundColor: searchType === opt.key ? COLORS.green : COLORS.card,
                      color: searchType === opt.key ? "#fff" : COLORS.slate,
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Per-type input row */}
              <div style={{
                display: "flex", gap: 10, marginBottom: 24, padding: 20, backgroundColor: COLORS.card,
                borderRadius: 10, border: `1px solid ${COLORS.line}`, alignItems: "flex-end", flexWrap: "wrap",
              }}>
                {(searchType === "ticket" || searchType === "patient") && (
                  <>
                    <div style={{ flex: 1, minWidth: 240 }}>
                      <div style={{ fontSize: 12.5, color: COLORS.slate, marginBottom: 6, fontWeight: 600 }}>
                        {searchType === "ticket" ? "Numéro de ticket (ex: P-4)" : "Nom du patient (ex: Diallo)"}
                      </div>
                      <input
                        value={globalSearchTerm}
                        onChange={(e) => setGlobalSearchTerm(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && performSearch()}
                        placeholder={searchType === "ticket" ? "Rechercher par numéro…" : "Rechercher par nom…"}
                        style={fieldStyle2}
                      />
                    </div>
                    {searchType === "patient" && (
                      <div style={{ fontSize: 12, color: COLORS.slate, maxWidth: 260, lineHeight: 1.5 }}>
                        Cette application ne conserve pas de dossier patient permanent avec un identifiant fixe —
                        chaque ticket est une visite indépendante. La recherche se fait donc par nom.
                      </div>
                    )}
                  </>
                )}

                {searchType === "department" && (
                  <div style={{ minWidth: 240 }}>
                    <div style={{ fontSize: 12.5, color: COLORS.slate, marginBottom: 6, fontWeight: 600 }}>Département</div>
                    {departments.length === 0 ? (
                      <div style={{ fontSize: 13, color: COLORS.slate }}>Aucun département configuré. Voir l'onglet Départements.</div>
                    ) : (
                      <select value={globalSearchTerm} onChange={(e) => setGlobalSearchTerm(e.target.value)} style={fieldStyle2}>
                        <option value="">Sélectionner…</option>
                        {departments.map((d) => (<option key={d}>{d}</option>))}
                      </select>
                    )}
                  </div>
                )}

                {searchType === "date" && (
                  <div style={{ minWidth: 240 }}>
                    <div style={{ fontSize: 12.5, color: COLORS.slate, marginBottom: 6, fontWeight: 600 }}>Date</div>
                    <input type="date" value={searchDate} onChange={(e) => setSearchDate(e.target.value)} style={fieldStyle2} />
                  </div>
                )}

                {searchType === "doctor" && (
                  <div style={{ flex: 1, minWidth: 280 }}>
                    <div style={{ fontSize: 12.5, color: COLORS.slate, marginBottom: 6, fontWeight: 600 }}>
                      {selectedDoctor ? "Médecin sélectionné" : "Tapez un nom pour filtrer"}
                    </div>
                    {selectedDoctor ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{
                          padding: "8px 14px", borderRadius: 20, backgroundColor: "#E8F0FB", color: "#2E5C8C",
                          fontWeight: 700, fontSize: 13.5,
                        }}>
                          Dr. {selectedDoctor.firstName} {selectedDoctor.lastName} — {selectedDoctor.department}
                        </span>
                        <button onClick={() => { setSelectedDoctor(null); setSearchResults([]); setSearchRan(false); }} style={miniBtnStyle(COLORS.slate)}>
                          Changer
                        </button>
                      </div>
                    ) : (
                      <>
                        <input
                          value={doctorFilter}
                          onChange={(e) => setDoctorFilter(e.target.value)}
                          placeholder="Nom du médecin…"
                          style={fieldStyle2}
                        />
                        {doctorFilter.trim() && (
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                            {staff
                              .filter((u) => u.role === "doctor")
                              .filter((u) => `${u.firstName} ${u.lastName}`.toLowerCase().includes(doctorFilter.toLowerCase()))
                              .slice(0, 8)
                              .map((doc) => (
                                <button
                                  key={doc.id}
                                  onClick={() => setSelectedDoctor(doc)}
                                  style={{
                                    padding: "7px 13px", borderRadius: 20, cursor: "pointer", fontSize: 12.5, fontWeight: 600,
                                    border: `1px solid ${COLORS.line}`, backgroundColor: COLORS.paper, color: COLORS.ink,
                                  }}
                                >
                                  Dr. {doc.firstName} {doc.lastName} ({doc.department || "—"})
                                </button>
                              ))}
                            {staff.filter((u) => u.role === "doctor" && `${u.firstName} ${u.lastName}`.toLowerCase().includes(doctorFilter.toLowerCase())).length === 0 && (
                              <span style={{ fontSize: 12.5, color: COLORS.slate }}>Aucun médecin trouvé</span>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                <button
                  onClick={performSearch}
                  disabled={searchLoading}
                  style={{
                    padding: "12px 26px", backgroundColor: COLORS.green, color: "white", border: "none",
                    borderRadius: 6, cursor: searchLoading ? "not-allowed" : "pointer", fontSize: 14, fontWeight: 700,
                    opacity: searchLoading ? 0.7 : 1,
                  }}
                >
                  {searchLoading ? "Recherche…" : "🔍 Rechercher"}
                </button>
              </div>

              {/* Results */}
              {searchLoading ? (
                <div style={{ textAlign: "center", padding: 50, color: COLORS.slate }}>Recherche en cours…</div>
              ) : !searchRan ? (
                <div style={{ padding: 40, textAlign: "center", color: COLORS.slate, border: `1.5px dashed ${COLORS.line}`, borderRadius: 10 }}>
                  Choisissez un critère ci-dessus et lancez une recherche.
                </div>
              ) : searchResults.length === 0 ? (
                <div style={{ padding: 40, textAlign: "center", color: COLORS.slate, border: `1.5px dashed ${COLORS.line}`, borderRadius: 10 }}>
                  Aucun résultat trouvé.
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 13, color: COLORS.slate, marginBottom: 10 }}>
                    {searchResults.length} résultat{searchResults.length > 1 ? "s" : ""}
                    {searchResults.length >= 50 ? " (limité aux 50–200 plus récents selon le critère)" : ""}
                  </div>
                  <div style={{ overflowX: "auto", border: `1px solid ${COLORS.line}`, borderRadius: 10 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", backgroundColor: COLORS.card }}>
                      <thead>
                        <tr style={{ backgroundColor: COLORS.ink, color: "white" }}>
                          {["Ticket #", "Patient", "Priorité", "Département", "Statut", "Médecin", "Créé le"].map((h) => (
                            <th key={h} style={{ padding: "14px 16px", textAlign: "left", fontSize: 12.5, textTransform: "uppercase", letterSpacing: "0.04em" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {searchResults.map((t) => {
                          const p = PRIORITY_CONFIG[t.priority] || PRIORITY_CONFIG.normal;
                          return (
                            <tr key={t.id} style={{ borderBottom: `1px solid ${COLORS.line}` }}>
                              <td style={{ padding: "13px 16px", fontWeight: 700, color: COLORS.ink }}>{t.ticketNumber || "—"}</td>
                              <td style={{ padding: "13px 16px" }}>{t.patientName || "—"}</td>
                              <td style={{ padding: "13px 16px" }}>
                                <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11.5, fontWeight: 700, color: p.color, backgroundColor: p.bg }}>
                                  {p.emoji} {p.label}
                                </span>
                              </td>
                              <td style={{ padding: "13px 16px" }}>{t.department || "—"}</td>
                              <td style={{ padding: "13px 16px" }}>
                                {t.status === "waiting" ? "Attente triage" : t.status === "ready" ? "Prêt pour médecin" : t.status === "in-progress" ? "En cours" : t.status === "completed" ? "Complété" : t.status === "no-show" ? "Non présenté" : t.status || "—"}
                              </td>
                              <td style={{ padding: "13px 16px" }}>{t.consultationDoctorName || "—"}</td>
                              <td style={{ padding: "13px 16px", fontSize: 13, color: COLORS.slate }}>
                                {t.createdAt ? new Date(t.createdAt).toLocaleString("fr-FR") : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === "notifications" && (
            <div style={{ maxWidth: 620 }}>
              <h2 style={{ color: COLORS.ink, margin: "0 0 8px", fontFamily: FONT_DISPLAY, fontSize: 22 }}>
                Diffuser une notification
              </h2>
              <p style={{ color: COLORS.slate, fontSize: 13.5, marginBottom: 22, lineHeight: 1.6 }}>
                Visible instantanément dans le tableau de bord de chaque membre de votre personnel
                (médecins, infirmiers, accueil) — pas d'email ni de SMS, uniquement dans l'application.
              </p>
              <div style={{
                padding: 24, backgroundColor: COLORS.card, borderRadius: 10,
                border: `1px solid ${COLORS.line}`, borderTop: `4px solid ${COLORS.gold}`,
              }}>
                <input placeholder="Titre" value={broadcastForm.title} onChange={(e) => setBroadcastForm({ ...broadcastForm, title: e.target.value })} disabled={broadcasting} style={fieldStyle} />
                <textarea placeholder="Message" value={broadcastForm.message} onChange={(e) => setBroadcastForm({ ...broadcastForm, message: e.target.value })} disabled={broadcasting} style={{ ...fieldStyle, minHeight: 90, fontFamily: FONT_BODY }} />
                <select value={broadcastForm.severity} onChange={(e) => setBroadcastForm({ ...broadcastForm, severity: e.target.value })} disabled={broadcasting} style={fieldStyle}>
                  <option value="info">ℹ️ Information</option>
                  <option value="warning">⚠️ Avertissement</option>
                  <option value="urgent">🚨 Urgent</option>
                </select>
                <button
                  onClick={sendBroadcast}
                  disabled={broadcasting}
                  onMouseEnter={(e) => { if (!e.currentTarget.disabled) { e.currentTarget.style.backgroundColor = "#119A31"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(20,181,58,0.32)"; e.currentTarget.style.transform = "translateY(-1px)"; } }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = COLORS.green; e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.transform = "translateY(0)"; }}
                  style={{
                    width: "100%", padding: 14, backgroundColor: COLORS.green, color: "white", border: "none",
                    borderRadius: 6, cursor: broadcasting ? "not-allowed" : "pointer", fontSize: 15, fontWeight: 700,
                    opacity: broadcasting ? 0.7 : 1,
                  }}>
                  {broadcasting ? "Diffusion en cours…" : "📢 Diffuser au personnel"}
                </button>
              </div>
            </div>
          )}

          {activeTab === "display" && (
            <div style={{ maxWidth: 620, margin: "20px auto", textAlign: "center", padding: 36, backgroundColor: COLORS.card, borderRadius: 10, border: `1px solid ${COLORS.line}`, borderTop: `4px solid ${COLORS.green}` }}>
              <h2 style={{ color: COLORS.ink, fontFamily: FONT_DISPLAY, fontSize: 21, marginTop: 0 }}>Lien de la salle d'attente</h2>
              <p style={{ color: COLORS.slate, fontSize: 14.5, lineHeight: 1.6 }}>
                Ouvrez ce lien sur l'écran TV de la salle d'attente. Aucune connexion n'est requise —
                il ne montre que les files de <strong style={{ color: COLORS.ink }}>{hospital?.name}</strong>.
              </p>
              <div style={{ padding: 16, background: COLORS.paper, borderRadius: 8, border: `1.5px dashed ${COLORS.line}`, fontFamily: "monospace", fontSize: 13.5, wordBreak: "break-all", color: COLORS.ink }}>
                {waitingRoomLink}
              </div>
              <button
                onClick={() => { navigator.clipboard.writeText(waitingRoomLink); setMsg("✅ Lien copié !"); setTimeout(() => setMsg(""), 2000); }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#119A31"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(20,181,58,0.32)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = COLORS.green; e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.transform = "translateY(0)"; }}
                style={{ marginTop: 18, padding: "12px 26px", backgroundColor: COLORS.green, color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 14.5 }}
              >
                Copier le lien
              </button>
            </div>
          )}
        </div>

        <div style={{ borderTop: `1px solid ${COLORS.line}`, padding: "18px 0", textAlign: "center", fontSize: 12.5, color: COLORS.slate }}>
          République du Mali — Ministère de la Santé · Système de gestion hospitalière
        </div>
      </div>

      {staffSessionsFor && (
        <div
          onClick={() => setStaffSessionsFor(null)}
          style={{ position: "fixed", inset: 0, backgroundColor: "rgba(27,42,31,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 1000 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: "#fff", borderRadius: 14, width: "min(520px, 100%)", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.35)", borderTop: "6px solid #6B4226" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "22px 28px 0" }}>
              <h2 style={{ margin: 0, fontFamily: FONT_DISPLAY, fontSize: 19, color: COLORS.ink }}>
                Sessions — {staffSessionsFor.firstName} {staffSessionsFor.lastName}
              </h2>
              <button onClick={() => setStaffSessionsFor(null)} aria-label="Fermer" style={{ width: 34, height: 34, borderRadius: "50%", border: "none", backgroundColor: COLORS.paper, color: COLORS.ink, fontSize: 17, fontWeight: 700, cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ padding: "20px 28px 26px" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.slate, textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 10 }}>
                Appareil enregistré
              </div>
              {staffDevice ? (
                <div style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8,
                  padding: "12px 14px", backgroundColor: "#F5EFE6", borderRadius: 8, border: "1px solid #D9C9AA", marginBottom: 22,
                }}>
                  <div>
                    <div style={{ fontWeight: 700, color: COLORS.ink, fontSize: 13.5 }}>
                      {staffDevice.deviceLabel || "Appareil inconnu"}
                      {" "}
                      <span style={{
                        fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 20, marginLeft: 4,
                        backgroundColor: staffDevice.status === "active" ? COLORS.successBg : staffDevice.status === "revoked" ? COLORS.dangerBg : "#FDF3E3",
                        color: staffDevice.status === "active" ? COLORS.successText : staffDevice.status === "revoked" ? COLORS.dangerText : "#8A5A00",
                      }}>
                        {staffDevice.status === "active" ? "Actif" : staffDevice.status === "revoked" ? "Révoqué" : "En attente"}
                      </span>
                    </div>
                    <div style={{ fontSize: 11.5, color: COLORS.slate, marginTop: 2 }}>
                      Enregistré le {new Date(staffDevice.registeredAt).toLocaleDateString("fr-FR")}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {staffDevice.status !== "active" && staffDevice.role !== "hospitaladmin" && (
                      <button onClick={approveStaffDevice} disabled={revokingDevice} style={{
                        padding: "6px 14px", backgroundColor: COLORS.green, color: "white", border: "none",
                        borderRadius: 5, cursor: revokingDevice ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 600,
                      }}>
                        {revokingDevice ? "…" : "Approuver"}
                      </button>
                    )}
                    {staffDevice.status !== "revoked" && staffDevice.role !== "hospitaladmin" && (
                      <button onClick={revokeStaffDevice} disabled={revokingDevice} style={{
                        padding: "6px 14px", backgroundColor: COLORS.red, color: "white", border: "none",
                        borderRadius: 5, cursor: revokingDevice ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 600,
                      }}>
                        {revokingDevice ? "…" : "Révoquer"}
                      </button>
                    )}
                    {staffDevice.role === "hospitaladmin" && (
                      <span style={{ fontSize: 11.5, color: COLORS.slate, fontStyle: "italic" }}>Géré par le Super Admin</span>
                    )}
                  </div>
                </div>
              ) : (
                <p style={{ fontSize: 13, color: COLORS.slate, marginBottom: 22 }}>Aucune demande d'appareil pour l'instant — une demande sera créée automatiquement à la prochaine tentative de connexion.</p>
              )}

              <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.slate, textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 10 }}>
                Sessions actives
              </div>
              {staffSessions.length === 0 ? (
                <p style={{ color: COLORS.slate, fontSize: 14 }}>Aucune session active pour cet utilisateur.</p>
              ) : (
                <div style={{ display: "grid", gap: 8, marginBottom: 18 }}>
                  {staffSessions.map((s) => (
                    <div key={s.id} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8,
                      padding: "12px 14px", backgroundColor: COLORS.paper, borderRadius: 8, border: `1px solid ${COLORS.line}`,
                    }}>
                      <div>
                        <div style={{ fontWeight: 700, color: COLORS.ink, fontSize: 13.5 }}>{s.deviceLabel || "Appareil inconnu"}</div>
                        <div style={{ fontSize: 11.5, color: COLORS.slate, marginTop: 2 }}>
                          Dernière activité : {(() => {
                            const diffMs = Date.now() - new Date(s.lastActivityAt).getTime();
                            const mins = Math.floor(diffMs / 60000);
                            if (mins < 1) return "à l'instant";
                            if (mins < 60) return `il y a ${mins} min`;
                            const hours = Math.floor(mins / 60);
                            if (hours < 24) return `il y a ${hours}h`;
                            return `il y a ${Math.floor(hours / 24)} jour(s)`;
                          })()}
                        </div>
                      </div>
                      <button onClick={() => revokeStaffSession(s.id)} disabled={revokingStaffSession === s.id} style={{
                        padding: "6px 14px", backgroundColor: COLORS.red, color: "white", border: "none",
                        borderRadius: 5, cursor: revokingStaffSession === s.id ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 600,
                      }}>
                        {revokingStaffSession === s.id ? "…" : "Révoquer"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {staffSessions.length > 0 && (
                <button onClick={revokeAllStaffSessions} disabled={revokingStaffSession === "all"} style={{
                  width: "100%", padding: 12, backgroundColor: "transparent", color: COLORS.red, border: `1.5px solid ${COLORS.red}`,
                  borderRadius: 8, cursor: revokingStaffSession === "all" ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 13.5,
                  opacity: revokingStaffSession === "all" ? 0.6 : 1,
                }}>
                  {revokingStaffSession === "all" ? "Déconnexion en cours…" : "Déconnecter tous les appareils"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {showMfaSetup && (
        <MfaSetup
          onClose={() => setShowMfaSetup(false)}
          onEnrolled={() => { setShowMfaSetup(false); setMsg("✅ Double authentification activée."); }}
        />
      )}
      {showChangePassword && (
        <ChangePassword onClose={() => setShowChangePassword(false)} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared inline style helpers                                        */
/* ------------------------------------------------------------------ */
const fieldStyle = {
  width: "100%",
  padding: "10px 12px",
  marginBottom: 12,
  borderRadius: "6px",
  border: `1px solid ${COLORS.line}`,
  fontSize: 14,
  boxSizing: "border-box",
  fontFamily: FONT_BODY,
  color: COLORS.ink,
  backgroundColor: "#fff",
};

const fieldStyle2 = {
  padding: "10px 14px",
  borderRadius: "6px",
  border: `1px solid ${COLORS.line}`,
  fontSize: 14,
  fontFamily: FONT_BODY,
  color: COLORS.ink,
  backgroundColor: "#fff",
};

const miniBtnStyle = (color) => ({
  padding: "6px 12px",
  backgroundColor: color,
  color: "white",
  border: "none",
  borderRadius: 5,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
});

const sectionHeadingStyle = {
  color: COLORS.ink,
  fontFamily: FONT_DISPLAY,
  fontSize: 17,
  marginBottom: 12,
  borderLeft: `4px solid ${COLORS.gold}`,
  paddingLeft: 10,
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