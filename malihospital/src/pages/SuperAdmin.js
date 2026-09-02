import { useState, useEffect } from "react";
import ChangePassword from "./ChangePassword";
import SessionsButton from "../components/SessionsButton";
import MfaSetup from "../components/MfaSetup";
import { db, auth, functions } from "../firebase";
import {
  collection,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  setDoc,
  addDoc,
  query,
  orderBy,
  where,
  limit,
  onSnapshot,
  getCountFromServer,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import NotificationsBanner from "../components/NotificationsBanner";
import HamburgerMenu from "../components/HamburgerMenu";
import { VILLES } from "../constants/villes";
import { PHARMACIES_SEED } from "../constants/pharmaciesSeed";

const COLORS = {
  green: "#14B53A",
  gold: "#FCD116",
  red: "#CE1126",
  ink: "#161C1A",
  slate: "#5C6862",
  paper: "#F6F5F1",
  card: "#FFFFFF",
  line: "#E3E0D6",
  successBg: "#E9F7EC",
  successText: "#1E7B34",
  dangerBg: "#FBEAEC",
  dangerText: "#A31221",
  warnBg: "#FDF3E3",
  warnText: "#8A5A00",
};

const FONT_DISPLAY = "'Georgia', 'Iowan Old Style', 'Times New Roman', serif";
const FONT_BODY = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

const TABS = [
  { key: "security", label: "🔐 Sécurité" },
  { key: "devices", label: "📱 Appareils" },
  { key: "logins", label: "🕐 Connexions" },
  { key: "hospitals", label: "🏥 Hôpitaux" },
  { key: "facilities", label: "💊 Pharmacies & Laboratoires" },
  { key: "notifications", label: "📢 Notifications" },
];

function NationalSeal({ size = 60 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="47" fill="none" stroke={COLORS.green} strokeWidth="6" />
      <circle cx="50" cy="50" r="38" fill="none" stroke={COLORS.gold} strokeWidth="6" />
      <circle cx="50" cy="50" r="29" fill={COLORS.red} />
      <rect x="44" y="27" width="12" height="46" rx="2" fill="#fff" />
      <rect x="27" y="44" width="46" height="12" rx="2" fill="#fff" />
    </svg>
  );
}

export default function SuperAdmin() {
  const [activeTab, setActiveTab] = useState("security");
  const [currentUser, setCurrentUser] = useState(null);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [hospitals, setHospitals] = useState([]);
  const [securityStats, setSecurityStats] = useState({ activeSessions: null, failedLoginsToday: null, lockedAccounts: null, disabledAccounts: null, eventsToday: null });
  const [recentEvents, setRecentEvents] = useState([]);
  const [showDisabledList, setShowDisabledList] = useState(false);
  const [showLockedList, setShowLockedList] = useState(false);
  const [lockedAccountsList, setLockedAccountsList] = useState([]);
  const [loadingLockedList, setLoadingLockedList] = useState(false);
  const [unlockingEmail, setUnlockingEmail] = useState(null);
  const [showFailedLoginsList, setShowFailedLoginsList] = useState(false);
  const [failedLoginsList, setFailedLoginsList] = useState([]);
  const [loadingFailedLoginsList, setLoadingFailedLoginsList] = useState(false);
  const [failedLoginsDateFilter, setFailedLoginsDateFilter] = useState(new Date().toISOString().slice(0, 10));
  const [showHospitalDetail, setShowHospitalDetail] = useState(null); // hospital object, or null
  const [hospitalDetailStaff, setHospitalDetailStaff] = useState([]);
  const [hospitalDetailSessions, setHospitalDetailSessions] = useState([]);
  const [loadingHospitalDetail, setLoadingHospitalDetail] = useState(false);
  const [showAddAdminForm, setShowAddAdminForm] = useState(false);
  const [addAdminForm, setAddAdminForm] = useState({ firstName: "", lastName: "", email: "", password: "" });
  const [addingAdmin, setAddingAdmin] = useState(false);
  const [editingAdminId, setEditingAdminId] = useState(null);
  const [editAdminForm, setEditAdminForm] = useState({ firstName: "", lastName: "" });
  const [deletingAdminId, setDeletingAdminId] = useState(null);
  const [allUsersList, setAllUsersList] = useState([]);
  const [loadingAllUsers, setLoadingAllUsers] = useState(false);
  const [loginsSearch, setLoginsSearch] = useState("");
  const [loginsHospitalId, setLoginsHospitalId] = useState("all");
  const [loginsRole, setLoginsRole] = useState("all");
  const [loginsDepartment, setLoginsDepartment] = useState("all");
  const [loginsDate, setLoginsDate] = useState("");
  const [loginsStatus, setLoginsStatus] = useState("all");
  const [showMfaSetup, setShowMfaSetup] = useState(false);
  const [pendingHospitalAdminDevices, setPendingHospitalAdminDevices] = useState([]);
  const [approvingHADeviceId, setApprovingHADeviceId] = useState(null);
  const [activeHospitalAdminDevices, setActiveHospitalAdminDevices] = useState([]);
  const [disabledUsersList, setDisabledUsersList] = useState([]);
  const [loadingDisabledList, setLoadingDisabledList] = useState(false);
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [triggeringBackup, setTriggeringBackup] = useState(false);
  const [enablingTotp, setEnablingTotp] = useState(false);
  const [totpMsg, setTotpMsg] = useState("");
  const [backupMsg, setBackupMsg] = useState("");
  const [sessionsDateFilter, setSessionsDateFilter] = useState(new Date().toISOString().slice(0, 10));
  const [allSessions, setAllSessions] = useState([]);
  const [loadingAllSessions, setLoadingAllSessions] = useState(false);
  const [revokingPlatformSession, setRevokingPlatformSession] = useState(null);
  const [eventsDateFilter, setEventsDateFilter] = useState(new Date().toISOString().slice(0, 10));
  const [pharmacies, setPharmacies] = useState([]);
  const [labs, setLabs] = useState([]);
  const [facilityForm, setFacilityForm] = useState({ facilityType: "pharmacy", name: "", address: "", ville: "", commune: "", quartier: "", phone: "", adminFirstName: "", adminLastName: "", adminEmail: "", adminPassword: "" });
  const [creatingFacility, setCreatingFacility] = useState(false);
  const [bulkTogglingType, setBulkTogglingType] = useState(null);
  const [showAddFacilityForm, setShowAddFacilityForm] = useState(false);
  const [addFacilityTab, setAddFacilityTab] = useState("fromList");
  const [addFromListFilter, setAddFromListFilter] = useState({ search: "", ville: "", commune: "", quartier: "" });
  const [addingSingleName, setAddingSingleName] = useState(null);
  const [facilityListFilter, setFacilityListFilter] = useState({ search: "", ville: "", commune: "", quartier: "" });
  const [pharmacyImportOpen, setPharmacyImportOpen] = useState(false);
  const [pharmacyImportText, setPharmacyImportText] = useState("");
  const [pharmacyImportPreview, setPharmacyImportPreview] = useState([]);
  const [importingPharmacyBulk, setImportingPharmacyBulk] = useState(false);
  const [labImportOpen, setLabImportOpen] = useState(false);
  const [labImportText, setLabImportText] = useState("");
  const [labImportPreview, setLabImportPreview] = useState([]);
  const [importingLabBulk, setImportingLabBulk] = useState(false);
  const [importingSeed, setImportingSeed] = useState(false);
  const [selectedFacilityIds, setSelectedFacilityIds] = useState({ pharmacy: [], lab: [] });
  const [facilityJumpTo, setFacilityJumpTo] = useState({ pharmacy: "", lab: "" });
  const [claimingFacility, setClaimingFacility] = useState(null);
  const [claimForm, setClaimForm] = useState({ adminFirstName: "", adminLastName: "", adminEmail: "", adminPassword: "" });
  const [submittingClaim, setSubmittingClaim] = useState(false);
  const [claimError, setClaimError] = useState("");
  const [managingStaffFor, setManagingStaffFor] = useState(null);
  const [facilityStaffList, setFacilityStaffList] = useState([]);
  const [newFacilityStaffForm, setNewFacilityStaffForm] = useState({ firstName: "", lastName: "", email: "", password: "" });
  const [creatingFacilityStaff, setCreatingFacilityStaff] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [creating, setCreating] = useState(false);
  const [broadcastForm, setBroadcastForm] = useState({ title: "", message: "", severity: "info", targetHospitalId: "" });
  const [broadcasting, setBroadcasting] = useState(false);

  const [form, setForm] = useState({
    hospitalName: "",
    hospitalAddress: "",
    ticketPrice: "",
    adminFirstName: "",
    adminLastName: "",
    adminEmail: "",
    adminPassword: "",
  });

  const nav = useNavigate();

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    // Explicit UTC day boundary, not local-time setHours(0,0,0,0) — the
    // date PICKED (eventsDateFilter etc.) is always a UTC calendar date
    // (from toISOString().slice(0,10)), so the boundary used to filter
    // has to be computed the same way, or the two silently drift apart
    // whenever the browser's local timezone isn't UTC+0.
    const todayIso = new Date().toISOString().slice(0, 10) + "T00:00:00.000Z";
    const now = new Date().toISOString();

    Promise.all([
      getCountFromServer(query(collection(db, "sessions"), where("revoked", "==", false))),
      getCountFromServer(query(collection(db, "securityEvents"), where("type", "==", "failed_login"), where("timestamp", ">=", todayIso))),
      getCountFromServer(query(collection(db, "loginAttempts"), where("lockedUntil", ">", now))),
      getCountFromServer(query(collection(db, "users"), where("disabled", "==", true))),
      getCountFromServer(query(collection(db, "securityEvents"), where("timestamp", ">=", todayIso))),
    ]).then(([sessionsSnap, failedSnap, lockedSnap, disabledSnap, eventsSnap]) => {
      setSecurityStats({
        activeSessions: sessionsSnap.data().count,
        failedLoginsToday: failedSnap.data().count,
        lockedAccounts: lockedSnap.data().count,
        disabledAccounts: disabledSnap.data().count,
        eventsToday: eventsSnap.data().count,
      });
    }).catch((e) => console.error("Error loading security stats:", e));
  }, []);

  useEffect(() => {
    const dayStart = new Date(eventsDateFilter + "T00:00:00").toISOString();
    const dayEnd = new Date(eventsDateFilter + "T23:59:59.999").toISOString();
    const q = query(
      collection(db, "securityEvents"),
      where("timestamp", ">=", dayStart),
      where("timestamp", "<=", dayEnd),
      orderBy("timestamp", "desc")
    );
    const unsub = onSnapshot(q, (snap) => {
      setRecentEvents(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, (e) => { console.error("Error loading recent security events:", e); setMsg("❌ Erreur (événements): " + e.message); });
    return () => unsub();
  }, [eventsDateFilter]);

  useEffect(() => {
    const q = query(collection(db, "devices"), where("role", "==", "hospitaladmin"), where("status", "==", "pending"));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => new Date(a.registeredAt) - new Date(b.registeredAt));
      setPendingHospitalAdminDevices(list);
    }, (e) => console.error("Error loading pending hospital admin devices:", e));
    return () => unsub();
  }, []);

  useEffect(() => {
    const q = query(collection(db, "devices"), where("role", "==", "hospitaladmin"), where("status", "==", "active"));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => new Date(b.approvedAt || b.registeredAt) - new Date(a.approvedAt || a.registeredAt));
      setActiveHospitalAdminDevices(list);
    }, (e) => console.error("Error loading active hospital admin devices:", e));
    return () => unsub();
  }, []);

  // Platform-wide staff list for the Connexions tab — fetched once when
  // the tab is first opened (not live), same reasoning as the platform
  // sessions view: this is a look-up an admin opens occasionally, not
  // something that needs a permanent listener running. Includes every
  // staff role across every hospital; hospital name is resolved
  // client-side from the already-loaded `hospitals` list rather than
  // storing a denormalized name on each user doc.
  useEffect(() => {
    if (activeTab !== "logins" || allUsersList.length > 0) return;
    setLoadingAllUsers(true);
    getDocs(query(collection(db, "users"), where("role", "in", ["doctor", "nurse", "accueil", "supervisor", "hospitaladmin", "pharmacy", "lab"])))
      .then((snap) => setAllUsersList(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
      .catch((e) => { console.error("Error loading all users:", e); setMsg("❌ Erreur (connexions): " + e.message); })
      .finally(() => setLoadingAllUsers(false));
  }, [activeTab, allUsersList.length]);

  const enableTotp = async () => {
    if (!window.confirm("Activer le TOTP pour l'ensemble du projet ? Ceci n'a besoin d'être fait qu'une seule fois.")) return;
    setEnablingTotp(true);
    setTotpMsg("");
    try {
      const call = httpsCallable(functions, "enableTotpMfa");
      const result = await call();
      setTotpMsg("✅ " + result.data.message);
    } catch (e) {
      setTotpMsg("❌ " + e.message);
    }
    setEnablingTotp(false);
  };

  const triggerBackup = async () => {
    if (!window.confirm("Lancer une sauvegarde complète maintenant ?")) return;
    setTriggeringBackup(true);
    setBackupMsg("");
    try {
      const call = httpsCallable(functions, "triggerBackup");
      const result = await call();
      setBackupMsg("✅ " + result.data.message);
    } catch (e) {
      setBackupMsg("❌ " + e.message);
    }
    setTriggeringBackup(false);
  };

  const approveHospitalAdminDevice = async (device) => {
    setApprovingHADeviceId(device.id);
    try {
      await updateDoc(doc(db, "devices", device.id), { status: "active", approvedAt: new Date().toISOString(), approvedBy: auth.currentUser.uid });
    } catch (e) {
      setMsg("❌ Erreur: " + e.message);
    }
    setApprovingHADeviceId(null);
  };

  const denyHospitalAdminDevice = async (device) => {
    setApprovingHADeviceId(device.id);
    try {
      await updateDoc(doc(db, "devices", device.id), { status: "revoked", revokedAt: new Date().toISOString(), revokedBy: auth.currentUser.uid });
    } catch (e) {
      setMsg("❌ Erreur: " + e.message);
    }
    setApprovingHADeviceId(null);
  };

  const revokeHospitalAdminDevice = async (device) => {
    if (!window.confirm(`Révoquer l'appareil de ${device.userName || device.userEmail} ? Il/elle ne pourra plus se connecter depuis cet appareil.`)) return;
    setApprovingHADeviceId(device.id);
    try {
      await updateDoc(doc(db, "devices", device.id), { status: "revoked", revokedAt: new Date().toISOString(), revokedBy: auth.currentUser.uid });
    } catch (e) {
      setMsg("❌ Erreur: " + e.message);
    }
    setApprovingHADeviceId(null);
  };

  const toggleDisabledList = async () => {
    const opening = !showDisabledList;
    setShowDisabledList(opening);
    if (opening && disabledUsersList.length === 0) {
      setLoadingDisabledList(true);
      try {
        const snap = await getDocs(query(collection(db, "users"), where("disabled", "==", true)));
        setDisabledUsersList(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (e) {
        console.error("Error loading disabled users:", e);
      }
      setLoadingDisabledList(false);
    }
  };

  const toggleLockedList = async () => {
    const opening = !showLockedList;
    setShowLockedList(opening);
    if (opening) {
      setLoadingLockedList(true);
      try {
        const now = new Date().toISOString();
        const snap = await getDocs(query(collection(db, "loginAttempts"), where("lockedUntil", ">", now)));
        setLockedAccountsList(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (e) {
        console.error("Error loading locked accounts:", e);
        setMsg("❌ Erreur (comptes bloqués): " + e.message);
      }
      setLoadingLockedList(false);
    }
  };

  // Failed logins scoped to a specific chosen day (not just today's
  // running count) — separate from the "Événements récents" feed below,
  // which mixes every event type together; this is a focused view of
  // just failed_login events, filterable by date, with the same
  // block/unblock action already wired up for the events feed.
  const loadFailedLoginsForDate = async (dateStr) => {
    setLoadingFailedLoginsList(true);
    try {
      const dayStart = new Date(dateStr + "T00:00:00").toISOString();
      const dayEnd = new Date(dateStr + "T23:59:59.999").toISOString();
      const snap = await getDocs(query(
        collection(db, "securityEvents"),
        where("type", "==", "failed_login"),
        where("timestamp", ">=", dayStart),
        where("timestamp", "<=", dayEnd),
        orderBy("timestamp", "desc")
      ));
      setFailedLoginsList(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error("Error loading failed logins for date:", e);
      setMsg("❌ Erreur (échecs de connexion): " + e.message);
    }
    setLoadingFailedLoginsList(false);
  };

  const toggleFailedLoginsList = () => {
    const opening = !showFailedLoginsList;
    setShowFailedLoginsList(opening);
    if (opening) loadFailedLoginsForDate(failedLoginsDateFilter);
  };

  // Hospital detail modal — pulls staff (grouped by role) and active
  // sessions for one specific hospital, fetched fresh each time the
  // modal opens rather than kept live, since this is a look-up view an
  // admin opens occasionally rather than something that needs to update
  // in real time while open.
  const openHospitalDetail = async (hospital) => {
    setShowHospitalDetail(hospital);
    setLoadingHospitalDetail(true);
    setHospitalDetailStaff([]);
    setHospitalDetailSessions([]);
    setShowAddAdminForm(false);
    setAddAdminForm({ firstName: "", lastName: "", email: "", password: "" });
    setEditingAdminId(null);
    try {
      const [staffSnap, sessionsSnap] = await Promise.all([
        getDocs(query(collection(db, "users"), where("hospitalId", "==", hospital.id))),
        getDocs(query(collection(db, "sessions"), where("hospitalId", "==", hospital.id), where("revoked", "==", false))),
      ]);
      setHospitalDetailStaff(staffSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setHospitalDetailSessions(sessionsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error("Error loading hospital detail:", e);
    }
    setLoadingHospitalDetail(false);
  };

  // Refreshes just the staff list within an already-open detail modal —
  // used after add/edit/delete so the modal doesn't need to be closed
  // and reopened to see the result.
  const refreshHospitalDetailStaff = async (hospitalId) => {
    try {
      const staffSnap = await getDocs(query(collection(db, "users"), where("hospitalId", "==", hospitalId)));
      setHospitalDetailStaff(staffSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error("Error refreshing hospital staff:", e);
    }
  };

  const addHospitalAdmin = async () => {
    const { firstName, lastName, email, password } = addAdminForm;
    if (!firstName || !lastName || !email || !password) {
      return setMsg("❌ Veuillez remplir tous les champs.");
    }
    if (password.length < 6) return setMsg("❌ Le mot de passe doit contenir au moins 6 caractères.");
    setAddingAdmin(true);
    setMsg("");
    try {
      const call = httpsCallable(functions, "addHospitalAdmin");
      const result = await call({ hospitalId: showHospitalDetail.id, firstName, lastName, email, password });
      setMsg(`✅ ${result.data.message} (Mot de passe temporaire: ${password})`);
      setShowAddAdminForm(false);
      setAddAdminForm({ firstName: "", lastName: "", email: "", password: "" });
      await refreshHospitalDetailStaff(showHospitalDetail.id);
    } catch (e) {
      setMsg("❌ Erreur: " + (e.message || "Une erreur est survenue."));
    }
    setAddingAdmin(false);
  };

  const startEditAdmin = (admin) => {
    setEditingAdminId(admin.id);
    setEditAdminForm({ firstName: admin.firstName, lastName: admin.lastName });
  };

  // Direct Firestore write rather than a Cloud Function — superadmin
  // already has unrestricted update permission on any user doc, and this
  // only touches name fields, nothing sensitive enough to need
  // server-side validation.
  const saveEditAdmin = async (adminId) => {
    try {
      await updateDoc(doc(db, "users", adminId), { firstName: editAdminForm.firstName, lastName: editAdminForm.lastName });
      setEditingAdminId(null);
      await refreshHospitalDetailStaff(showHospitalDetail.id);
      setMsg("✅ Administrateur mis à jour.");
    } catch (e) {
      setMsg("❌ Erreur: " + e.message);
    }
  };

  const removeHospitalAdmin = async (admin) => {
    if (!window.confirm(`Supprimer l'administrateur ${admin.firstName} ${admin.lastName} ? Cette action est irréversible.`)) return;
    setDeletingAdminId(admin.id);
    try {
      const call = httpsCallable(functions, "deleteHospitalAdmin");
      const result = await call({ userId: admin.id });
      setMsg(`✅ ${result.data.message}`);
      await refreshHospitalDetailStaff(showHospitalDetail.id);
    } catch (e) {
      setMsg("❌ Erreur: " + (e.message || "Une erreur est survenue."));
    }
    setDeletingAdminId(null);
  };

  const unlockAccount = async (email) => {
    if (!window.confirm(`Débloquer immédiatement le compte ${email} ?`)) return;
    setUnlockingEmail(email);
    try {
      const call = httpsCallable(functions, "clearLoginAttempts");
      await call({ email });
      setLockedAccountsList((prev) => prev.filter((a) => a.id !== email));
      try {
        await addDoc(collection(db, "securityEvents"), {
          type: "account_unlocked",
          email,
          actorId: auth.currentUser.uid,
          actorEmail: currentUser?.email || auth.currentUser.email,
          timestamp: new Date().toISOString(),
        });
      } catch (logErr) {
        console.warn("Could not log unlock event (non-fatal):", logErr.message);
      }
      setMsg(`✅ Compte ${email} débloqué.`);
    } catch (e) {
      setMsg("❌ Erreur: " + e.message);
    }
    setUnlockingEmail(null);
  };

  // Smart toggle used directly from a "⚠️ Échec de connexion" row in
  // Événements récents — checks the account's actual current lock state
  // first, then either blocks or unblocks it, so one button correctly
  // handles both directions rather than needing separate buttons whose
  // labels could go stale.
  const toggleBlockFromEvent = async (email) => {
    setUnlockingEmail(email);
    try {
      const ref = doc(db, "loginAttempts", email);
      const snap = await getDoc(ref);
      const isCurrentlyLocked = snap.exists() && snap.data().lockedUntil && new Date(snap.data().lockedUntil) > new Date();

      if (isCurrentlyLocked) {
        if (!window.confirm(`Débloquer le compte ${email} ?`)) { setUnlockingEmail(null); return; }
        const call = httpsCallable(functions, "clearLoginAttempts");
        await call({ email });
        await addDoc(collection(db, "securityEvents"), {
          type: "account_unlocked", email, actorId: auth.currentUser.uid,
          actorEmail: currentUser?.email || auth.currentUser.email, timestamp: new Date().toISOString(),
        }).catch((e) => console.warn("Could not log unlock event (non-fatal):", e.message));
        setMsg(`✅ Compte ${email} débloqué.`);
      } else {
        if (!window.confirm(`Bloquer le compte ${email} pendant 2 heures ?`)) { setUnlockingEmail(null); return; }
        // Same shape the automatic 2-wrong-passwords lock already
        // writes — nothing downstream needs to know this one was
        // triggered manually rather than by real failed attempts.
        await setDoc(ref, {
          failedCount: 2,
          lockedUntil: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
          lastAttemptAt: new Date().toISOString(),
        }, { merge: true });
        await addDoc(collection(db, "securityEvents"), {
          type: "account_locked", email, actorId: auth.currentUser.uid,
          actorEmail: currentUser?.email || auth.currentUser.email, timestamp: new Date().toISOString(), manual: true,
        }).catch((e) => console.warn("Could not log lock event (non-fatal):", e.message));
        setMsg(`✅ Compte ${email} bloqué pour 2 heures.`);
      }
    } catch (e) {
      setMsg("❌ Erreur: " + e.message);
    }
    setUnlockingEmail(null);
  };

  const loadAllSessionsForDate = async (dateStr) => {
    setLoadingAllSessions(true);
    try {
      const dayStart = new Date(dateStr + "T00:00:00").toISOString();
      const dayEnd = new Date(dateStr + "T23:59:59.999").toISOString();
      const snap = await getDocs(query(
        collection(db, "sessions"),
        where("lastActivityAt", ">=", dayStart),
        where("lastActivityAt", "<=", dayEnd)
      ));
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => new Date(b.lastActivityAt) - new Date(a.lastActivityAt));
      setAllSessions(list);
    } catch (e) {
      console.error("Error loading platform sessions:", e);
      setMsg("❌ Erreur (sessions): " + e.message);
    }
    setLoadingAllSessions(false);
  };

  const toggleAllSessions = () => {
    const opening = !showAllSessions;
    setShowAllSessions(opening);
    if (opening) loadAllSessionsForDate(sessionsDateFilter);
  };

  const revokePlatformSession = async (sessionId) => {
    setRevokingPlatformSession(sessionId);
    try {
      await updateDoc(doc(db, "sessions", sessionId), { revoked: true, revokedAt: new Date().toISOString(), revokedBy: "superadmin" });
      setAllSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, revoked: true } : s)));
    } catch (e) {
      setMsg("❌ Erreur: " + e.message);
    }
    setRevokingPlatformSession(null);
  };

  const load = async () => {
    if (!auth.currentUser) return nav("/");
    try {
      const meSnap = await getDoc(doc(db, "users", auth.currentUser.uid));
      setCurrentUser(meSnap.data());
      await loadHospitals();
      await loadFacilities();
    } catch (e) {
      console.error(e);
      setMsg("❌ Erreur de chargement: " + e.message);
    }
    setLoading(false);
  };

  const loadHospitals = async () => {
    const snap = await getDocs(query(collection(db, "hospitals"), orderBy("createdAt", "desc")));
    setHospitals(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  };

  const loadFacilities = async () => {
    const [pharmSnap, labSnap] = await Promise.all([
      getDocs(query(collection(db, "pharmacies"), orderBy("createdAt", "desc"))),
      getDocs(query(collection(db, "labs"), orderBy("createdAt", "desc"))),
    ]);
    setPharmacies(pharmSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    setLabs(labSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
  };

  const parseImportText = (text) => {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    return lines.map((line) => {
      const parts = line.includes("\t") ? line.split("\t") : line.split(",");
      const [name, address, commune, ville, phone, responsiblePerson] = parts.map((p) => (p || "").trim());
      return { name, address, commune, ville, phone, responsiblePerson };
    });
  };

  const parsePharmacyImport = () => setPharmacyImportPreview(parseImportText(pharmacyImportText));
  const parseLabImport = () => setLabImportPreview(parseImportText(labImportText));

  const submitPharmacyImport = async () => {
    const validRows = pharmacyImportPreview.filter((r) => r.name && r.ville);
    if (validRows.length === 0) return setMsg("❌ Aucune ligne valide à importer (nom et ville obligatoires).");
    setImportingPharmacyBulk(true);
    setMsg("");
    try {
      const call = httpsCallable(functions, "bulkImportPharmacies");
      const result = await call({ facilityType: "pharmacy", rows: validRows });
      setMsg(`✅ ${result.data.message}`);
      setPharmacyImportText("");
      setPharmacyImportPreview([]);
      await loadFacilities();
    } catch (e) {
      setMsg("❌ Erreur: " + e.message);
    }
    setImportingPharmacyBulk(false);
  };

  const submitLabImport = async () => {
    const validRows = labImportPreview.filter((r) => r.name && r.ville);
    if (validRows.length === 0) return setMsg("❌ Aucune ligne valide à importer (nom et ville obligatoires).");
    setImportingLabBulk(true);
    setMsg("");
    try {
      const call = httpsCallable(functions, "bulkImportPharmacies");
      const result = await call({ facilityType: "lab", rows: validRows });
      setMsg(`✅ ${result.data.message}`);
      setLabImportText("");
      setLabImportPreview([]);
      await loadFacilities();
    } catch (e) {
      setMsg("❌ Erreur: " + e.message);
    }
    setImportingLabBulk(false);
  };

  const openClaimForm = (facilityType, facility) => {
    setClaimingFacility({ facilityType, facilityId: facility.id, name: facility.name });
    setClaimForm({ adminFirstName: "", adminLastName: "", adminEmail: "", adminPassword: "" });
    setClaimError("");
  };

  const submitClaim = async () => {
    const { adminFirstName, adminLastName, adminEmail, adminPassword } = claimForm;
    if (!adminFirstName || !adminLastName || !adminEmail || !adminPassword) {
      return setClaimError("Veuillez remplir tous les champs.");
    }
    if (adminPassword.length < 6) return setClaimError("Le mot de passe doit contenir au moins 6 caractères.");
    setSubmittingClaim(true);
    setClaimError("");
    try {
      const call = httpsCallable(functions, "claimFacility");
      const result = await call({
        facilityType: claimingFacility.facilityType,
        facilityId: claimingFacility.facilityId,
        adminFirstName, adminLastName, adminEmail, adminPassword,
      });
      setMsg(`✅ ${result.data.message} (Mot de passe temporaire: ${adminPassword})`);
      setClaimingFacility(null);
      await loadFacilities();
    } catch (e) {
      setClaimError(e.message || "Une erreur est survenue.");
    }
    setSubmittingClaim(false);
  };

  const createFacility = async () => {
    const { facilityType, name, address, ville, commune, quartier, phone, adminFirstName, adminLastName, adminEmail, adminPassword } = facilityForm;
    if (!name.trim()) return setMsg("❌ Le nom est obligatoire.");
    if (!ville) return setMsg("❌ La ville est obligatoire.");
    if (!adminFirstName || !adminLastName || !adminEmail || !adminPassword) {
      return setMsg("❌ Les informations de l'administrateur de l'établissement sont obligatoires.");
    }
    if (adminPassword.length < 6) {
      return setMsg("❌ Le mot de passe doit contenir au moins 6 caractères.");
    }

    setCreatingFacility(true);
    setMsg("");
    try {
      const call = httpsCallable(functions, "createFacility");
      await call({ facilityType, name: name.trim(), address, ville, commune, quartier, phone, adminFirstName, adminLastName, adminEmail, adminPassword });
      setMsg(`✅ ${facilityType === "pharmacy" ? "Pharmacie" : "Laboratoire"} créé(e) avec son administrateur. (Mot de passe temporaire: ${adminPassword})`);
      setFacilityForm({ facilityType, name: "", address: "", ville: "", commune: "", quartier: "", phone: "", adminFirstName: "", adminLastName: "", adminEmail: "", adminPassword: "" });
      await loadFacilities();
    } catch (e) {
      setMsg("❌ Erreur: " + (e.message || "Une erreur est survenue."));
    }
    setCreatingFacility(false);
  };

  const toggleFacilityActive = async (facilityType, facility) => {
    try {
      const call = httpsCallable(functions, "setFacilityActive");
      await call({ facilityType, facilityId: facility.id, active: !facility.active });
      await loadFacilities();
    } catch (e) {
      setMsg("❌ Erreur: " + (e.message || "Une erreur est survenue."));
    }
  };

  const bulkToggleFacilities = async (facilityType, active) => {
    const label = facilityType === "pharmacy" ? "pharmacies" : "laboratoires";
    if (!window.confirm(`${active ? "Activer" : "Désactiver"} TOUTES les ${label} d'un coup ? Cette action affecte tous les établissements de ce type.`)) return;
    setBulkTogglingType(facilityType);
    setMsg("");
    try {
      const call = httpsCallable(functions, "bulkSetFacilitiesActive");
      const result = await call({ facilityType, active });
      setMsg(`✅ ${result.data.message}`);
      await loadFacilities();
    } catch (e) {
      setMsg("❌ Erreur: " + (e.message || "Une erreur est survenue."));
    }
    setBulkTogglingType(null);
  };

  const toggleSelectedFacilities = async (facilityType, active) => {
    const ids = selectedFacilityIds[facilityType];
    if (ids.length === 0) return;
    setBulkTogglingType(facilityType);
    setMsg("");
    try {
      const call = httpsCallable(functions, "bulkSetFacilitiesActive");
      const result = await call({ facilityType, active, facilityIds: ids });
      setMsg(`✅ ${result.data.message}`);
      setSelectedFacilityIds((prev) => ({ ...prev, [facilityType]: [] }));
      await loadFacilities();
    } catch (e) {
      setMsg("❌ Erreur: " + (e.message || "Une erreur est survenue."));
    }
    setBulkTogglingType(null);
  };

  const toggleFacilitySelection = (facilityType, facilityId) => {
    setSelectedFacilityIds((prev) => {
      const current = prev[facilityType];
      const next = current.includes(facilityId) ? current.filter((id) => id !== facilityId) : [...current, facilityId];
      return { ...prev, [facilityType]: next };
    });
  };

  const selectAllVisible = (facilityType, visibleIds) => {
    setSelectedFacilityIds((prev) => ({ ...prev, [facilityType]: visibleIds }));
  };
  const clearSelection = (facilityType) => {
    setSelectedFacilityIds((prev) => ({ ...prev, [facilityType]: [] }));
  };

  const importSeedPharmacies = async () => {
    if (!window.confirm(`Importer les ${PHARMACIES_SEED.length} pharmacies fournies ?`)) return;
    setImportingSeed(true);
    setMsg("");
    try {
      const call = httpsCallable(functions, "bulkImportPharmacies");
      const result = await call({ facilityType: "pharmacy", rows: PHARMACIES_SEED });
      setMsg(`✅ ${result.data.message}`);
      await loadFacilities();
    } catch (e) {
      setMsg("❌ Erreur: " + (e.message || "Une erreur est survenue."));
    }
    setImportingSeed(false);
  };

  const addSingleSeedPharmacy = async (row) => {
    setAddingSingleName(row.name);
    setMsg("");
    try {
      const call = httpsCallable(functions, "bulkImportPharmacies");
      const result = await call({ facilityType: "pharmacy", rows: [row] });
      setMsg(`✅ ${result.data.message}`);
      await loadFacilities();
    } catch (e) {
      setMsg("❌ Erreur: " + (e.message || "Une erreur est survenue."));
    }
    setAddingSingleName(null);
  };

  const addFilteredSeedPharmacies = async (rows) => {
    if (rows.length === 0) return;
    if (!window.confirm(`Ajouter ces ${rows.length} pharmacie(s) ?`)) return;
    setImportingSeed(true);
    setMsg("");
    try {
      const call = httpsCallable(functions, "bulkImportPharmacies");
      const result = await call({ facilityType: "pharmacy", rows });
      setMsg(`✅ ${result.data.message}`);
      await loadFacilities();
    } catch (e) {
      setMsg("❌ Erreur: " + (e.message || "Une erreur est survenue."));
    }
    setImportingSeed(false);
  };

  const openFacilityStaffPanel = async (facilityType, facility) => {
    setManagingStaffFor({ facilityType, facilityId: facility.id, facilityName: facility.name });
    setNewFacilityStaffForm({ firstName: "", lastName: "", email: "", password: "" });
    try {
      const snap = await getDocs(query(
        collection(db, "users"),
        where("facilityType", "==", facilityType),
        where("facilityId", "==", facility.id)
      ));
      setFacilityStaffList(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      setMsg("❌ Erreur de chargement du personnel: " + (e.message || "Une erreur est survenue."));
    }
  };

  const closeFacilityStaffPanel = () => {
    setManagingStaffFor(null);
    setFacilityStaffList([]);
  };

  const createNewFacilityStaff = async () => {
    const { firstName, lastName, email, password } = newFacilityStaffForm;
    if (!firstName || !lastName || !email || !password) {
      return setMsg("❌ Veuillez remplir tous les champs.");
    }
    setCreatingFacilityStaff(true);
    setMsg("");
    try {
      const call = httpsCallable(functions, "createFacilityStaff");
      await call({ facilityType: managingStaffFor.facilityType, facilityId: managingStaffFor.facilityId, firstName, lastName, email, password });
      setMsg(`✅ Compte créé pour ${firstName} ${lastName}. (Mot de passe temporaire: ${password})`);
      await openFacilityStaffPanel(managingStaffFor.facilityType, { id: managingStaffFor.facilityId, name: managingStaffFor.facilityName });
    } catch (e) {
      setMsg("❌ Erreur: " + (e.message || "Une erreur est survenue."));
    }
    setCreatingFacilityStaff(false);
  };

  const toggleFacilityStaffDisabled = async (userId, disabled) => {
    try {
      const call = httpsCallable(functions, "setFacilityStaffDisabled");
      await call({ userId, disabled });
      await openFacilityStaffPanel(managingStaffFor.facilityType, { id: managingStaffFor.facilityId, name: managingStaffFor.facilityName });
    } catch (e) {
      setMsg("❌ Erreur: " + (e.message || "Une erreur est survenue."));
    }
  };

  const deleteFacilityStaffMember = async (userId, name) => {
    if (!window.confirm(`Supprimer ${name} ?`)) return;
    try {
      const call = httpsCallable(functions, "deleteFacilityStaff");
      await call({ userId });
      await openFacilityStaffPanel(managingStaffFor.facilityType, { id: managingStaffFor.facilityId, name: managingStaffFor.facilityName });
    } catch (e) {
      setMsg("❌ Erreur: " + (e.message || "Une erreur est survenue."));
    }
  };

  const deleteFacility = async (facilityType, facility) => {
    const typed = window.prompt(
      `⚠️ Cette action est IRRÉVERSIBLE.\n\nElle supprimera "${facility.name}" et tout son personnel — y compris leurs connexions Firebase Auth réelles.\n\nTapez le nom exact pour confirmer:`
    );
    if (typed === null) return;
    setMsg("");
    try {
      const call = httpsCallable(functions, "deleteFacility");
      const result = await call({ facilityType, facilityId: facility.id, confirmName: typed });
      setMsg(`✅ ${result.data.message}`);
      await loadFacilities();
    } catch (e) {
      if (e.code === "functions/failed-precondition") {
        setMsg("❌ Suppression annulée — le nom saisi ne correspond pas.");
      } else {
        setMsg("❌ Erreur: " + (e.message || "Une erreur est survenue."));
      }
    }
  };

  const generatePassword = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    let out = "";
    for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
    setForm((f) => ({ ...f, adminPassword: out }));
  };

  const createHospital = async () => {
    const { hospitalName, hospitalAddress, ticketPrice, adminFirstName, adminLastName, adminEmail, adminPassword } = form;
    if (!hospitalName || !adminFirstName || !adminLastName || !adminEmail || !adminPassword) {
      setMsg("❌ Veuillez remplir tous les champs obligatoires");
      return;
    }
    if (ticketPrice === "" || Number(ticketPrice) < 0 || !Number.isFinite(Number(ticketPrice))) {
      setMsg("❌ Veuillez indiquer un prix de ticket valide (0 ou plus)");
      return;
    }
    if (adminPassword.length < 6) {
      setMsg("❌ Le mot de passe doit contenir au moins 6 caractères");
      return;
    }

    setCreating(true);
    setMsg("");

    try {
      const call = httpsCallable(functions, "createHospital");
      const result = await call({ hospitalName, hospitalAddress, ticketPrice: Number(ticketPrice), adminFirstName, adminLastName, adminEmail, adminPassword });

      setMsg(`✅ ${result.data.message} L'administrateur devra configurer les départements de l'hôpital avant de pouvoir créer des tickets ou des comptes médecin. (Mot de passe temporaire communiqué séparément: ${adminPassword})`);
      setForm({ hospitalName: "", hospitalAddress: "", ticketPrice: "", adminFirstName: "", adminLastName: "", adminEmail: "", adminPassword: "" });
      await loadHospitals();
    } catch (e) {
      console.error("Error creating hospital:", e);
      if (e.code === "functions/already-exists") {
        setMsg("❌ Cet email administrateur est déjà utilisé par un autre compte.");
      } else {
        setMsg("❌ Erreur: " + (e.message || "Une erreur est survenue."));
      }
    }
    setCreating(false);
  };

  const toggleHospitalActive = async (hospital) => {
    try {
      const call = httpsCallable(functions, "setHospitalActive");
      await call({ hospitalId: hospital.id, active: !hospital.active });
      await loadHospitals();
    } catch (e) {
      setMsg("❌ Erreur: " + (e.message || "Une erreur est survenue."));
    }
  };

  const deleteHospital = async (hospital) => {
    const typed = window.prompt(
      `⚠️ Cette action est IRRÉVERSIBLE.\n\nElle supprimera "${hospital.name}", tous ses comptes (administrateur, médecins, accueil) — y compris leurs connexions Firebase Auth réelles —, tous ses tickets et tous ses appels.\n\nTapez le nom exact de l'hôpital pour confirmer:`
    );
    if (typed === null) return;

    setMsg("");
    try {
      const call = httpsCallable(functions, "deleteHospital");
      const result = await call({ hospitalId: hospital.id, confirmName: typed });
      setMsg(`✅ ${result.data.message}`);
      await loadHospitals();
    } catch (e) {
      console.error("Error deleting hospital:", e);
      if (e.code === "functions/failed-precondition") {
        setMsg("❌ Suppression annulée — le nom saisi ne correspond pas.");
      } else {
        setMsg("❌ Erreur lors de la suppression: " + (e.message || "Une erreur est survenue."));
      }
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
      await call({
        hospitalId: broadcastForm.targetHospitalId || null,
        title: broadcastForm.title.trim(),
        message: broadcastForm.message.trim(),
        severity: broadcastForm.severity,
      });
      setMsg("✅ Notification diffusée.");
      setBroadcastForm({ title: "", message: "", severity: "info", targetHospitalId: "" });
    } catch (e) {
      setMsg("❌ Erreur: " + (e.message || "Une erreur est survenue."));
    }
    setBroadcasting(false);
  };

  const logout = async () => {
    await signOut(auth);
    nav("/");
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16, backgroundColor: COLORS.paper, fontFamily: FONT_BODY }}>
        <NationalSeal size={54} />
        <div style={{ fontSize: 16, color: COLORS.slate }}>Chargement…</div>
      </div>
    );
  }

  const activeCount = hospitals.filter((h) => h.active).length;
  const disabledCount = hospitals.filter((h) => !h.active).length;

  const tabBadges = {
    security: null,
    devices: pendingHospitalAdminDevices.length || null,
    hospitals: null,
    facilities: null,
    notifications: null,
  };

  return (
    <div style={{ minHeight: "100vh", background: COLORS.paper, fontFamily: FONT_BODY }}>
      <div style={{ height: 6, display: "flex" }}>
        <div style={{ flex: 1, background: COLORS.green }} />
        <div style={{ flex: 1, background: COLORS.gold }} />
        <div style={{ flex: 1, background: COLORS.red }} />
      </div>

      <div style={{ background: COLORS.ink }}>
        <div style={{ maxWidth: 1300, margin: "0 auto", padding: "26px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <NationalSeal size={58} />
            <div>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 12, letterSpacing: "0.14em", color: "rgba(255,255,255,0.62)", textTransform: "uppercase" }}>
                République du Mali
              </div>
              <div style={{ fontFamily: FONT_DISPLAY, fontStyle: "italic", fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 1 }}>
                Un Peuple — Un But — Une Foi
              </div>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 700, color: "#fff", marginTop: 6 }}>
                Ministère de la Santé
              </div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: "rgba(255,255,255,0.7)", marginTop: 4, letterSpacing: "0.02em" }}>
                Direction Nationale des Établissements Hospitaliers — Super Administration
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.55)" }}>Connecté en tant que</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#fff" }}>{currentUser?.firstName} {currentUser?.lastName}</div>
            </div>
            <SessionsButton />
            <button onClick={() => setShowMfaSetup(true)} style={{
              padding: "10px 16px", backgroundColor: "transparent", color: "#fff",
              border: "1.5px solid rgba(255,255,255,0.4)", borderRadius: 6, cursor: "pointer",
              fontSize: 13, fontWeight: 600,
            }}>
              🔐 2FA
            </button>
            <button onClick={() => setShowChangePassword(true)} style={{
              padding: "10px 16px", backgroundColor: "transparent", color: "#6B4226", border: "1.5px solid #6B4226",
              borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13,
            }}>
              🔑 Mot de passe
            </button>
            <button onClick={logout} style={{
              padding: "10px 20px", backgroundColor: "transparent", color: "#fff",
              border: "1.5px solid rgba(255,255,255,0.4)", borderRadius: 6, cursor: "pointer",
              fontSize: 14, fontWeight: 600, transition: "all 0.15s",
            }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = COLORS.red; e.currentTarget.style.borderColor = COLORS.red; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.4)"; }}
            >
              Déconnexion
            </button>
          </div>
        </div>

        <div style={{ maxWidth: 1300, margin: "0 auto", padding: "14px 24px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <HamburgerMenu
            tabs={TABS}
            activeTab={activeTab}
            onSelect={setActiveTab}
            getBadge={(tab) => ({ count: tabBadges[tab.key] || 0 })}
            colors={COLORS}
            dark
          />
        </div>
      </div>

      <div style={{ maxWidth: 1300, margin: "0 auto", padding: "28px 24px 50px" }}>

        <NotificationsBanner hospitalId={null} />

        {msg && (
          <div style={{
            padding: "13px 18px", marginBottom: 22, borderRadius: 6, fontWeight: 500, fontSize: 14.5,
            backgroundColor: msg.startsWith("✅") ? COLORS.successBg : COLORS.dangerBg,
            color: msg.startsWith("✅") ? COLORS.successText : COLORS.dangerText,
            border: `1px solid ${msg.startsWith("✅") ? "#BEE3C5" : "#F1C3C9"}`,
          }}>
            {msg}
          </div>
        )}

        {activeTab === "devices" && (
        <div style={{
          padding: 26, backgroundColor: COLORS.card, borderRadius: 10,
          border: `1px solid ${COLORS.line}`, borderTop: `4px solid #8A5A00`,
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        }}>
          <h2 style={{ color: COLORS.ink, marginTop: 0, marginBottom: 4, fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 700 }}>
            📱 Appareils — Administrateurs d'hôpital
          </h2>
          <p style={{ color: COLORS.slate, fontSize: 13, marginTop: 0, marginBottom: 24, maxWidth: 720 }}>
            Un compte hospitaladmin ne peut pas se connecter tant que l'appareil utilisé n'est pas approuvé
            ici. C'est délibéré : un hospitaladmin ne peut jamais approuver son propre appareil ni celui d'un
            autre hospitaladmin — seul le Super Admin le peut. Les demandes des autres membres du personnel
            (médecins, infirmiers, accueil, superviseurs) sont approuvées directement par leur propre
            administrateur d'hôpital, dans son Panneau Admin.
          </p>

          <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.slate, textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 10 }}>
            🔔 Demandes en attente {pendingHospitalAdminDevices.length > 0 && `(${pendingHospitalAdminDevices.length})`}
          </div>

          {pendingHospitalAdminDevices.length === 0 ? (
            <div style={{ padding: "20px 18px", backgroundColor: COLORS.paper, borderRadius: 8, border: `1px solid ${COLORS.line}`, marginBottom: 30, textAlign: "center" }}>
              <p style={{ fontSize: 13.5, color: COLORS.slate, margin: 0 }}>
                Aucune demande en attente pour l'instant. Dès qu'un administrateur d'hôpital tente de se
                connecter depuis un nouvel appareil, sa demande apparaîtra ici automatiquement.
              </p>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 8, marginBottom: 30 }}>
              {pendingHospitalAdminDevices.map((d) => (
                <div key={d.id} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8,
                  padding: "12px 14px", backgroundColor: "#FDF3E3", borderRadius: 8, border: "1px solid #E8D5A8",
                }}>
                  <div>
                    <div style={{ fontWeight: 700, color: COLORS.ink, fontSize: 13.5 }}>{d.userName || d.userEmail}</div>
                    <div style={{ fontSize: 11.5, color: COLORS.slate, marginTop: 2 }}>
                      {d.deviceLabel || "Appareil inconnu"} · demandé le {new Date(d.registeredAt).toLocaleDateString("fr-FR")}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => approveHospitalAdminDevice(d)} disabled={approvingHADeviceId === d.id} style={{
                      padding: "6px 14px", backgroundColor: COLORS.green, color: "white", border: "none",
                      borderRadius: 5, cursor: approvingHADeviceId === d.id ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 600,
                    }}>
                      {approvingHADeviceId === d.id ? "…" : "Approuver"}
                    </button>
                    <button onClick={() => denyHospitalAdminDevice(d)} disabled={approvingHADeviceId === d.id} style={{
                      padding: "6px 14px", backgroundColor: "transparent", color: COLORS.red, border: `1px solid ${COLORS.red}`,
                      borderRadius: 5, cursor: approvingHADeviceId === d.id ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 600,
                    }}>
                      Refuser
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.slate, textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 10 }}>
            ✅ Appareils déjà approuvés {activeHospitalAdminDevices.length > 0 && `(${activeHospitalAdminDevices.length})`}
          </div>
          {activeHospitalAdminDevices.length === 0 ? (
            <p style={{ fontSize: 13.5, color: COLORS.slate }}>Aucun appareil approuvé pour l'instant.</p>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {activeHospitalAdminDevices.map((d) => (
                <div key={d.id} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8,
                  padding: "12px 14px", backgroundColor: COLORS.successBg, borderRadius: 8, border: "1px solid #BEE3C5",
                }}>
                  <div>
                    <div style={{ fontWeight: 700, color: COLORS.ink, fontSize: 13.5 }}>{d.userName || d.userEmail}</div>
                    <div style={{ fontSize: 11.5, color: COLORS.slate, marginTop: 2 }}>
                      {d.deviceLabel || "Appareil inconnu"} · approuvé le {d.approvedAt ? new Date(d.approvedAt).toLocaleDateString("fr-FR") : "—"}
                    </div>
                  </div>
                  <button onClick={() => revokeHospitalAdminDevice(d)} disabled={approvingHADeviceId === d.id} style={{
                    padding: "6px 14px", backgroundColor: COLORS.red, color: "white", border: "none",
                    borderRadius: 5, cursor: approvingHADeviceId === d.id ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 600,
                  }}>
                    {approvingHADeviceId === d.id ? "…" : "Révoquer"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        )}

        {activeTab === "logins" && (
        <div style={{
          padding: 26, backgroundColor: COLORS.card, borderRadius: 10,
          border: `1px solid ${COLORS.line}`, borderTop: `4px solid #2E5C8C`,
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        }}>
          <h2 style={{ color: COLORS.ink, marginTop: 0, marginBottom: 4, fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 700 }}>
            🕐 Connexions — tout le personnel
          </h2>
          <p style={{ color: COLORS.slate, fontSize: 13, marginTop: 0, marginBottom: 20, maxWidth: 720 }}>
            Dernière connexion de chaque membre du personnel, tous hôpitaux confondus. La date filtre sur
            le jour de la DERNIÈRE connexion de chacun — pas un historique complet de toutes les connexions passées.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr 1fr 1fr 0.8fr", gap: 10, marginBottom: 18 }}>
            <input
              placeholder="🔍 Rechercher par nom ou email…"
              value={loginsSearch}
              onChange={(e) => setLoginsSearch(e.target.value)}
              style={{ ...fieldStyle, marginBottom: 0 }}
            />
            <select value={loginsHospitalId} onChange={(e) => setLoginsHospitalId(e.target.value)} style={{ ...fieldStyle, marginBottom: 0 }}>
              <option value="all">Tous les hôpitaux</option>
              {hospitals.map((h) => (<option key={h.id} value={h.id}>{h.name}</option>))}
            </select>
            <select value={loginsRole} onChange={(e) => setLoginsRole(e.target.value)} style={{ ...fieldStyle, marginBottom: 0 }}>
              <option value="all">Tous les rôles</option>
              <option value="hospitaladmin">Administrateur d'hôpital</option>
              <option value="doctor">Médecin</option>
              <option value="nurse">Infirmier·ère</option>
              <option value="accueil">Accueil</option>
              <option value="supervisor">Superviseur</option>
              <option value="pharmacy">Pharmacie</option>
              <option value="lab">Laboratoire</option>
            </select>
            <input
              placeholder="Département…"
              value={loginsDepartment}
              onChange={(e) => setLoginsDepartment(e.target.value)}
              style={{ ...fieldStyle, marginBottom: 0 }}
            />
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

          {loadingAllUsers ? (
            <p style={{ fontSize: 13, color: COLORS.slate }}>Chargement…</p>
          ) : (() => {
            const filtered = allUsersList.filter((u) => {
              if (loginsSearch.trim()) {
                const term = loginsSearch.trim().toLowerCase();
                const name = `${u.firstName || ""} ${u.lastName || ""}`.toLowerCase();
                if (!name.includes(term) && !(u.email || "").toLowerCase().includes(term)) return false;
              }
              if (loginsHospitalId !== "all" && u.hospitalId !== loginsHospitalId) return false;
              if (loginsRole !== "all" && u.role !== loginsRole) return false;
              if (loginsDepartment.trim() && !(u.department || "").toLowerCase().includes(loginsDepartment.trim().toLowerCase())) return false;
              if (loginsDate && (!u.lastLoginAt || u.lastLoginAt.slice(0, 10) !== loginsDate)) return false;
              if (loginsStatus === "online" && !u.online) return false;
              if (loginsStatus === "offline" && u.online) return false;
              return true;
            });
            const roleLabels = { hospitaladmin: "Admin. hôpital", doctor: "Médecin", nurse: "Infirmier·ère", accueil: "Accueil", supervisor: "Superviseur", pharmacy: "Pharmacie", lab: "Laboratoire" };
            return (
              <>
                <div style={{ fontSize: 13, color: COLORS.slate, marginBottom: 10 }}>
                  {filtered.length} résultat{filtered.length !== 1 ? "s" : ""} sur {allUsersList.length}
                </div>
                <div style={{ overflowX: "auto", border: `1px solid ${COLORS.line}`, borderRadius: 10 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", backgroundColor: COLORS.card }}>
                    <thead>
                      <tr style={{ backgroundColor: COLORS.ink, color: "white" }}>
                        {["Nom", "Rôle", "Hôpital", "Département", "Dernière connexion", "Dernière déconnexion", "Statut"].map((h) => (
                          <th key={h} style={{ padding: "12px 14px", textAlign: "left", fontSize: 11.5, textTransform: "uppercase", letterSpacing: "0.03em" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.length === 0 ? (
                        <tr><td colSpan="7" style={{ padding: 30, textAlign: "center", color: COLORS.slate }}>Aucun résultat pour ce filtre.</td></tr>
                      ) : (
                        filtered.map((u) => {
                          const hosp = hospitals.find((h) => h.id === u.hospitalId);
                          return (
                            <tr key={u.id} style={{ borderBottom: `1px solid ${COLORS.line}` }}>
                              <td style={{ padding: "10px 14px", fontWeight: 700, color: COLORS.ink, fontSize: 13 }}>{u.firstName} {u.lastName}</td>
                              <td style={{ padding: "10px 14px", fontSize: 12.5 }}>{roleLabels[u.role] || u.role}</td>
                              <td style={{ padding: "10px 14px", fontSize: 12.5, color: COLORS.slate }}>{hosp ? hosp.name : "—"}</td>
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
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            );
          })()}
        </div>
        )}

        {activeTab === "security" && (
        <div style={{
          padding: 26, backgroundColor: COLORS.card, borderRadius: 10,
          border: `1px solid ${COLORS.line}`, borderTop: `4px solid #6B4226`,
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 18 }}>
            <h2 style={{ color: COLORS.ink, margin: 0, fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 700 }}>
              Aperçu sécurité
            </h2>
            <div style={{ textAlign: "right" }}>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={enableTotp} disabled={enablingTotp} style={{
                  padding: "9px 16px", backgroundColor: "transparent", color: "#6B4226", border: "1.5px solid #6B4226",
                  borderRadius: 6, cursor: enablingTotp ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 13,
                  opacity: enablingTotp ? 0.7 : 1,
                }}>
                  {enablingTotp ? "Activation…" : "🔐 Activer TOTP (une fois)"}
                </button>
                <button onClick={triggerBackup} disabled={triggeringBackup} style={{
                  padding: "9px 16px", backgroundColor: "#6B4226", color: "white", border: "none",
                  borderRadius: 6, cursor: triggeringBackup ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 13,
                  opacity: triggeringBackup ? 0.7 : 1,
                }}>
                  {triggeringBackup ? "Lancement…" : "💾 Sauvegarder maintenant"}
                </button>
              </div>
              {totpMsg && <div style={{ fontSize: 11.5, color: COLORS.slate, marginTop: 6, maxWidth: 320, textAlign: "right" }}>{totpMsg}</div>}
              {backupMsg && <div style={{ fontSize: 11.5, color: COLORS.slate, marginTop: 6, maxWidth: 280, textAlign: "right" }}>{backupMsg}</div>}
            </div>
          </div>

          {(() => {
            const alerts = [];
            if (securityStats.failedLoginsToday >= 10) {
              alerts.push(`⚠️ ${securityStats.failedLoginsToday} échecs de connexion aujourd'hui — nettement plus que d'habitude.`);
            }
            if (securityStats.lockedAccounts >= 3) {
              alerts.push(`🔒 ${securityStats.lockedAccounts} comptes actuellement bloqués simultanément.`);
            }
            if (securityStats.eventsToday >= 30) {
              alerts.push(`📊 ${securityStats.eventsToday} événements de sécurité aujourd'hui — volume inhabituel, vérifiez le journal ci-dessous.`);
            }
            if (alerts.length === 0) return null;
            return (
              <div style={{
                marginBottom: 20, padding: "14px 18px", backgroundColor: "#FBEAEC", borderRadius: 10,
                border: "1px solid #E8B8BE", borderLeft: "4px solid #A31221",
              }}>
                <div style={{ fontWeight: 700, color: "#A31221", fontSize: 13.5, marginBottom: 6 }}>
                  Activité inhabituelle détectée
                </div>
                {alerts.map((a, i) => (
                  <div key={i} style={{ fontSize: 13, color: COLORS.ink, marginTop: i > 0 ? 4 : 0 }}>{a}</div>
                ))}
              </div>
            );
          })()}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: (showDisabledList || showLockedList) ? 12 : 24 }}>
            <StatCard label="Sessions actives" value={securityStats.activeSessions ?? "…"} accent="#2E5C8C" />
            <StatCard label="Échecs de connexion" value={securityStats.failedLoginsToday ?? "…"} accent="#B8860B" onClick={toggleFailedLoginsList} />
            <StatCard label="Comptes bloqués" value={securityStats.lockedAccounts ?? "…"} accent={COLORS.red} onClick={toggleLockedList} />
            <StatCard label="Comptes désactivés" value={securityStats.disabledAccounts ?? "…"} accent={COLORS.slate} onClick={toggleDisabledList} />
            <StatCard label="Événements aujourd'hui" value={securityStats.eventsToday ?? "…"} accent={COLORS.green} />
          </div>

          {showLockedList && (
            <div style={{ marginBottom: 24, padding: 16, backgroundColor: COLORS.paper, borderRadius: 8, border: `1px solid ${COLORS.line}` }}>
              {loadingLockedList ? (
                <p style={{ fontSize: 13, color: COLORS.slate, margin: 0 }}>Chargement…</p>
              ) : lockedAccountsList.length === 0 ? (
                <p style={{ fontSize: 13, color: COLORS.slate, margin: 0 }}>Aucun compte bloqué pour l'instant.</p>
              ) : (
                <div style={{ display: "grid", gap: 6 }}>
                  {lockedAccountsList.map((a) => (
                    <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, padding: "8px 12px", backgroundColor: "#fff", borderRadius: 6, border: `1px solid ${COLORS.line}`, fontSize: 13 }}>
                      <div>
                        <strong style={{ color: COLORS.ink }}>{a.id}</strong>
                        <div style={{ fontSize: 11.5, color: COLORS.slate, marginTop: 2 }}>
                          {a.failedCount || 0} tentative(s) échouée(s) · bloqué jusqu'à {a.lockedUntil ? new Date(a.lockedUntil).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—"}
                        </div>
                      </div>
                      <button onClick={() => unlockAccount(a.id)} disabled={unlockingEmail === a.id} style={{
                        padding: "5px 12px", backgroundColor: COLORS.green, color: "white", border: "none",
                        borderRadius: 5, cursor: unlockingEmail === a.id ? "not-allowed" : "pointer", fontSize: 11.5, fontWeight: 600,
                      }}>
                        {unlockingEmail === a.id ? "…" : "Débloquer"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {showFailedLoginsList && (
            <div style={{ marginBottom: 24, padding: 16, backgroundColor: COLORS.paper, borderRadius: 8, border: `1px solid ${COLORS.line}` }}>
              <input
                type="date"
                value={failedLoginsDateFilter}
                onChange={(e) => { setFailedLoginsDateFilter(e.target.value); loadFailedLoginsForDate(e.target.value); }}
                style={{ padding: "8px 12px", borderRadius: 6, border: `1px solid ${COLORS.line}`, fontSize: 13, marginBottom: 14 }}
              />
              {loadingFailedLoginsList ? (
                <p style={{ fontSize: 13, color: COLORS.slate, margin: 0 }}>Chargement…</p>
              ) : failedLoginsList.length === 0 ? (
                <p style={{ fontSize: 13, color: COLORS.slate, margin: 0 }}>Aucun échec de connexion ce jour-là.</p>
              ) : (
                <div style={{ display: "grid", gap: 6 }}>
                  {failedLoginsList.map((ev) => (
                    <div key={ev.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, padding: "8px 12px", backgroundColor: "#fff", borderRadius: 6, border: `1px solid ${COLORS.line}`, fontSize: 13 }}>
                      <div>
                        <strong style={{ color: COLORS.ink }}>{ev.email || "—"}</strong>
                        <div style={{ fontSize: 11.5, color: COLORS.slate, marginTop: 2 }}>
                          {new Date(ev.timestamp).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                        </div>
                      </div>
                      {ev.email && (
                        <button onClick={() => toggleBlockFromEvent(ev.email)} disabled={unlockingEmail === ev.email} style={{
                          padding: "5px 12px", backgroundColor: "transparent", color: COLORS.red, border: `1px solid ${COLORS.red}`,
                          borderRadius: 5, cursor: unlockingEmail === ev.email ? "not-allowed" : "pointer", fontSize: 11.5, fontWeight: 600,
                        }}>
                          {unlockingEmail === ev.email ? "…" : "Bloquer / débloquer"}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {showDisabledList && (
            <div style={{ marginBottom: 24, padding: 16, backgroundColor: COLORS.paper, borderRadius: 8, border: `1px solid ${COLORS.line}` }}>
              {loadingDisabledList ? (
                <p style={{ fontSize: 13, color: COLORS.slate, margin: 0 }}>Chargement…</p>
              ) : disabledUsersList.length === 0 ? (
                <p style={{ fontSize: 13, color: COLORS.slate, margin: 0 }}>Aucun compte désactivé.</p>
              ) : (
                <div style={{ display: "grid", gap: 6 }}>
                  {disabledUsersList.map((u) => (
                    <div key={u.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", backgroundColor: "#fff", borderRadius: 6, border: `1px solid ${COLORS.line}`, fontSize: 13 }}>
                      <span><strong style={{ color: COLORS.ink }}>{u.firstName} {u.lastName}</strong> — {u.email}</span>
                      <span style={{ color: COLORS.slate }}>{u.role}{u.facilityName ? ` · ${u.facilityName}` : ""}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: showAllSessions ? 12 : 0, marginTop: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.slate, textTransform: "uppercase", letterSpacing: "0.03em" }}>
              Sessions — toute la plateforme
            </div>
            <button onClick={toggleAllSessions} style={{ background: "none", border: "none", color: "#2E5C8C", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
              {showAllSessions ? "Masquer ▴" : "Afficher ▾"}
            </button>
          </div>

          {showAllSessions && (
            <div style={{ marginBottom: 24 }}>
              <p style={{ fontSize: 12.5, color: COLORS.slate, marginTop: 4, marginBottom: 10 }}>
                Toutes les sessions de tout le personnel, sur tout le territoire — filtrées par date pour rester lisibles.
              </p>
              <input
                type="date"
                value={sessionsDateFilter}
                onChange={(e) => { setSessionsDateFilter(e.target.value); loadAllSessionsForDate(e.target.value); }}
                style={{ padding: "8px 12px", borderRadius: 6, border: `1px solid ${COLORS.line}`, fontSize: 13, marginBottom: 14 }}
              />
              {loadingAllSessions ? (
                <p style={{ fontSize: 13, color: COLORS.slate }}>Chargement…</p>
              ) : allSessions.length === 0 ? (
                <p style={{ fontSize: 13, color: COLORS.slate }}>Aucune activité ce jour-là.</p>
              ) : (
                <div style={{ display: "grid", gap: 6, maxHeight: 420, overflowY: "auto" }}>
                  {allSessions.map((s) => {
                    const hosp = hospitals.find((h) => h.id === s.hospitalId);
                    return (
                      <div key={s.id} style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8,
                        padding: "10px 14px", backgroundColor: s.revoked ? "#FCF3F3" : COLORS.paper, borderRadius: 8, border: `1px solid ${COLORS.line}`,
                      }}>
                        <div>
                          <div style={{ fontWeight: 700, color: COLORS.ink, fontSize: 13.5 }}>
                            {s.displayName || s.email} {s.revoked && <span style={{ color: COLORS.dangerText, fontSize: 11 }}>(révoquée)</span>}
                          </div>
                          <div style={{ fontSize: 11.5, color: COLORS.slate, marginTop: 2 }}>
                            {s.deviceLabel || "Appareil inconnu"} · {hosp ? hosp.name : "—"} · {new Date(s.lastActivityAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                          </div>
                          {(s.city || s.country || s.ipAddress) && (
                            <div style={{ fontSize: 11, color: "#8A7F6C", marginTop: 2 }}>
                              📍 {[s.city, s.country].filter(Boolean).join(", ") || "Lieu inconnu"}{s.ipAddress ? ` · ${s.ipAddress}` : ""}
                            </div>
                          )}
                        </div>
                        {!s.revoked && (
                          <button onClick={() => revokePlatformSession(s.id)} disabled={revokingPlatformSession === s.id} style={{
                            padding: "5px 12px", backgroundColor: COLORS.red, color: "white", border: "none",
                            borderRadius: 5, cursor: revokingPlatformSession === s.id ? "not-allowed" : "pointer", fontSize: 11.5, fontWeight: 600,
                          }}>
                            {revokingPlatformSession === s.id ? "…" : "Révoquer"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.slate, textTransform: "uppercase", letterSpacing: "0.03em" }}>
              Événements récents
            </div>
            <input
              type="date"
              value={eventsDateFilter}
              onChange={(e) => setEventsDateFilter(e.target.value)}
              style={{ padding: "7px 10px", borderRadius: 6, border: `1px solid ${COLORS.line}`, fontSize: 13 }}
            />
          </div>
          {recentEvents.length === 0 ? (
            <p style={{ fontSize: 13.5, color: COLORS.slate }}>Aucun événement ce jour-là.</p>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {recentEvents.map((ev) => {
                const meta = {
                  failed_login:     { icon: "⚠️", label: "Échec de connexion" },
                  account_locked:   { icon: "🔒", label: "Compte bloqué" },
                  account_unlocked: { icon: "🔓", label: "Compte débloqué manuellement" },
                  account_disabled: { icon: "🚫", label: "Compte désactivé" },
                  account_enabled:  { icon: "✅", label: "Compte réactivé" },
                  new_session:      { icon: "🖥️", label: "Nouvelle connexion" },
                }[ev.type] || { icon: "📋", label: ev.type };
                const diffMs = Date.now() - new Date(ev.timestamp).getTime();
                const mins = Math.floor(diffMs / 60000);
                const ago = mins < 1 ? "à l'instant" : mins < 60 ? `il y a ${mins} min` : `il y a ${Math.floor(mins / 60)}h`;
                return (
                  <div key={ev.id} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8,
                    padding: "10px 14px", backgroundColor: COLORS.paper, borderRadius: 8, border: `1px solid ${COLORS.line}`, fontSize: 13,
                  }}>
                    <div>
                      <span style={{ marginRight: 8 }}>{meta.icon}</span>
                      <strong style={{ color: COLORS.ink }}>{meta.label}</strong>
                      {(ev.email || ev.actorEmail) && <span style={{ color: COLORS.slate }}> — {ev.email || ev.actorEmail}</span>}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {ev.type === "failed_login" && ev.email && (
                        <button onClick={() => toggleBlockFromEvent(ev.email)} disabled={unlockingEmail === ev.email} style={{
                          padding: "4px 10px", backgroundColor: "transparent", color: COLORS.red, border: `1px solid ${COLORS.red}`,
                          borderRadius: 5, cursor: unlockingEmail === ev.email ? "not-allowed" : "pointer", fontSize: 11, fontWeight: 600,
                        }}>
                          {unlockingEmail === ev.email ? "…" : "Bloquer / débloquer"}
                        </button>
                      )}
                      <span style={{ color: COLORS.slate, fontSize: 12 }}>{ago}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        )}

        {activeTab === "hospitals" && (
        <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 30 }}>
          <StatCard label="Hôpitaux enregistrés" value={hospitals.length} accent={COLORS.ink} />
          <StatCard label="Établissements actifs" value={activeCount} accent={COLORS.green} />
          <StatCard label="Établissements désactivés" value={disabledCount} accent={COLORS.red} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 420px) 1fr", gap: 24, alignItems: "start" }}>

          <div style={{
            padding: 26, backgroundColor: COLORS.card, borderRadius: 10,
            border: `1px solid ${COLORS.line}`, borderTop: `4px solid ${COLORS.red}`,
            boxShadow: "0 1px 2px rgba(0,0,0,0.04)", position: "sticky", top: 24,
          }}>
            <h2 style={{ color: COLORS.ink, marginTop: 0, marginBottom: 4, fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 700 }}>
              Enregistrer un hôpital
            </h2>
            <p style={{ color: COLORS.slate, fontSize: 13, marginTop: 0, marginBottom: 18 }}>
              Crée l'établissement et son compte administrateur.
            </p>

            <input placeholder="Nom de l'hôpital" value={form.hospitalName} onChange={(e) => setForm({ ...form, hospitalName: e.target.value })} disabled={creating} style={fieldStyle} />
            <input placeholder="Adresse (optionnel)" value={form.hospitalAddress} onChange={(e) => setForm({ ...form, hospitalAddress: e.target.value })} disabled={creating} style={fieldStyle} />
            <input
              type="number" min="0" step="1"
              placeholder="Prix du ticket (FCFA)"
              value={form.ticketPrice}
              onChange={(e) => setForm({ ...form, ticketPrice: e.target.value })}
              disabled={creating}
              style={fieldStyle}
            />

            <div style={{ fontSize: 12.5, fontWeight: 700, color: COLORS.slate, textTransform: "uppercase", letterSpacing: "0.05em", margin: "18px 0 10px" }}>
              Administrateur de l'hôpital
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <input placeholder="Prénom" value={form.adminFirstName} onChange={(e) => setForm({ ...form, adminFirstName: e.target.value })} disabled={creating} style={fieldStyle} />
              <input placeholder="Nom" value={form.adminLastName} onChange={(e) => setForm({ ...form, adminLastName: e.target.value })} disabled={creating} style={fieldStyle} />
            </div>
            <input placeholder="Email de l'administrateur" type="email" value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} disabled={creating} style={fieldStyle} />

            <div style={{ display: "flex", alignItems: "stretch", gap: 10, marginBottom: 14 }}>
              <input
                placeholder="Mot de passe temporaire"
                value={form.adminPassword}
                onChange={(e) => setForm({ ...form, adminPassword: e.target.value })}
                disabled={creating}
                style={{ ...fieldStyle, flex: 1, marginBottom: 0, padding: "12px 14px", height: 46 }}
              />
              
            </div>
            <button onClick={generatePassword} disabled={creating} style={{ ...secondaryBtnStyle, height: 46, padding: "0 20px", display: "flex", alignItems: "center", gap: 6 }}>
                🎲 Générer
              </button>

            <button onClick={createHospital} disabled={creating} style={{
              width: "100%", padding: 14, backgroundColor: COLORS.ink, color: "white", border: "none",
              borderRadius: 6, cursor: creating ? "not-allowed" : "pointer", fontSize: 15, fontWeight: 700,
              marginTop: 4, opacity: creating ? 0.7 : 1,
            }}>
              {creating ? "Création en cours…" : "Créer l'hôpital et son administrateur"}
            </button>
          </div>

          <div>
            <h2 style={{ color: COLORS.ink, fontFamily: FONT_DISPLAY, fontSize: 19, marginTop: 0, marginBottom: 14, borderLeft: `4px solid ${COLORS.gold}`, paddingLeft: 10 }}>
              Hôpitaux enregistrés ({hospitals.length})
            </h2>
            <div style={{ overflowX: "auto", border: `1px solid ${COLORS.line}`, borderRadius: 10 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", backgroundColor: COLORS.card }}>
                <thead>
                  <tr style={{ backgroundColor: COLORS.ink, color: "white" }}>
                    {["Nom", "Adresse", "Prix ticket", "Créé le", "Statut", "Salle d'attente", "Actions"].map((h) => (
                      <th key={h} style={{ padding: "14px 16px", textAlign: "left", fontSize: 12.5, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {hospitals.length === 0 ? (
                    <tr><td colSpan="7" style={{ padding: 36, textAlign: "center", color: COLORS.slate }}>Aucun hôpital créé</td></tr>
                  ) : (
                    hospitals.map((h) => (
                      <tr key={h.id} style={{ borderBottom: `1px solid ${COLORS.line}`, backgroundColor: h.active ? "white" : "#FCF3F3" }}>
                        <td
                          onClick={() => openHospitalDetail(h)}
                          style={{ padding: "13px 16px", fontWeight: 700, color: "#2E5C8C", cursor: "pointer", textDecoration: "underline" }}
                        >
                          {h.name}
                        </td>
                        <td style={{ padding: "13px 16px", color: COLORS.slate }}>{h.address || "—"}</td>
                        <td style={{ padding: "13px 16px", color: COLORS.slate }}>{h.ticketPrice != null ? `${h.ticketPrice.toLocaleString("fr-FR")} FCFA` : "—"}</td>
                        <td style={{ padding: "13px 16px", fontSize: 13, color: COLORS.slate }}>{new Date(h.createdAt).toLocaleString("fr-FR")}</td>
                        <td style={{ padding: "13px 16px" }}>
                          <span style={{
                            padding: "4px 11px", borderRadius: 20, fontWeight: 700, fontSize: 12,
                            backgroundColor: h.active ? COLORS.successBg : COLORS.dangerBg,
                            color: h.active ? COLORS.successText : COLORS.dangerText,
                          }}>
                            {h.active ? "Actif" : "Désactivé"}
                          </span>
                        </td>
                        <td style={{ padding: "13px 16px", fontSize: 12 }}>
                          <code style={{ background: COLORS.paper, padding: "3px 7px", borderRadius: 4, border: `1px solid ${COLORS.line}` }}>
                            /waiting/{h.id}
                          </code>
                        </td>
                        <td style={{ padding: "10px 16px" }}>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <button onClick={() => toggleHospitalActive(h)} style={miniBtnStyle(h.active ? "#B8860B" : "#2E7D8C")}>
                              {h.active ? "Désactiver" : "Réactiver"}
                            </button>
                            <button onClick={() => deleteHospital(h)} style={miniBtnStyle(COLORS.red)}>
                              Supprimer
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 13, color: COLORS.slate, marginTop: 14, lineHeight: 1.6 }}>
              Désactiver un hôpital bloque la connexion de son administrateur, de ses médecins et de son
              personnel d'accueil (vérifié à chaque chargement de leur tableau de bord).
            </p>
          </div>
        </div>
        </>
        )}

        {activeTab === "facilities" && (
        <>
        <div style={{
          padding: 26, backgroundColor: COLORS.card, borderRadius: 10,
          border: `1px solid ${COLORS.line}`, borderTop: `4px solid ${COLORS.gold}`,
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 4 }}>
            <div>
              <h2 style={{ color: COLORS.ink, margin: 0, fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 700 }}>
                Pharmacies & Laboratoires
              </h2>
              <p style={{ color: COLORS.slate, fontSize: 13, marginTop: 6, marginBottom: 0, maxWidth: 640 }}>
                Établissements indépendants, visibles par tous les médecins de tous les hôpitaux — filtrés par
                localisation du patient au moment de la prescription.
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {pharmacies.length < PHARMACIES_SEED.length && (
                <button onClick={importSeedPharmacies} disabled={importingSeed} style={{
                  padding: "9px 18px", backgroundColor: "#0F7A6E", color: "white", border: "none",
                  borderRadius: 6, cursor: importingSeed ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 13.5,
                  opacity: importingSeed ? 0.7 : 1, whiteSpace: "nowrap",
                }}>
                  {importingSeed ? "Import…" : `📥 Importer les ${PHARMACIES_SEED.length} pharmacies fournies`}
                </button>
              )}
              <button onClick={() => setShowAddFacilityForm((v) => !v)} style={{
                padding: "9px 18px", backgroundColor: showAddFacilityForm ? "#6c757d" : COLORS.green, color: "white", border: "none",
                borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 13.5, whiteSpace: "nowrap",
              }}>
                {showAddFacilityForm ? "✕ Fermer" : "+ Ajouter un établissement"}
              </button>
            </div>
          </div>

          {showAddFacilityForm && (
            <div style={{ marginTop: 20, padding: 20, backgroundColor: COLORS.paper, borderRadius: 10, border: `1px solid ${COLORS.line}` }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 18, borderBottom: `2px solid ${COLORS.line}` }}>
                {[{ key: "fromList", label: `Depuis la liste fournie (${PHARMACIES_SEED.length})` }, { key: "manual", label: "Nouvel établissement" }].map((tab) => (
                  <button key={tab.key} onClick={() => setAddFacilityTab(tab.key)}
                    style={{
                      padding: "9px 16px", border: "none", background: "none", cursor: "pointer",
                      fontSize: 13.5, fontWeight: addFacilityTab === tab.key ? 700 : 500,
                      color: addFacilityTab === tab.key ? COLORS.green : COLORS.slate,
                      borderBottom: addFacilityTab === tab.key ? `3px solid ${COLORS.green}` : "3px solid transparent",
                      marginBottom: -2,
                    }}>
                    {tab.label}
                  </button>
                ))}
              </div>

              {addFacilityTab === "fromList" && (() => {
                const existingNames = new Set(pharmacies.map((p) => p.name));
                const notYetAdded = PHARMACIES_SEED.filter((row) => !existingNames.has(row.name));
                const filtered = notYetAdded.filter((row) => {
                  if (addFromListFilter.search.trim() && !row.name.toLowerCase().includes(addFromListFilter.search.trim().toLowerCase())) return false;
                  if (addFromListFilter.ville && row.ville !== addFromListFilter.ville) return false;
                  if (addFromListFilter.commune && row.commune !== addFromListFilter.commune) return false;
                  if (addFromListFilter.quartier && row.address !== addFromListFilter.quartier) return false;
                  return true;
                });
                return (
                  <div>
                    <p style={{ fontSize: 12.5, color: COLORS.slate, marginTop: 0, marginBottom: 14 }}>
                      {notYetAdded.length} sur {PHARMACIES_SEED.length} restent à ajouter — celles déjà présentes dans votre liste ne sont plus affichées ici.
                    </p>
                    <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
                      <input
                        placeholder="🔍 Rechercher par nom…"
                        value={addFromListFilter.search}
                        onChange={(e) => setAddFromListFilter({ ...addFromListFilter, search: e.target.value })}
                        style={{ ...fieldStyle, marginBottom: 0 }}
                      />
                      <select
                        value={addFromListFilter.ville}
                        onChange={(e) => setAddFromListFilter({ ...addFromListFilter, ville: e.target.value, commune: "" })}
                        style={{ ...fieldStyle, marginBottom: 0 }}
                      >
                        <option value="">Toutes les villes</option>
                        {[...new Set(PHARMACIES_SEED.map((r) => r.ville))].sort().map((v) => (<option key={v}>{v}</option>))}
                      </select>
                      <select
                        value={addFromListFilter.commune}
                        onChange={(e) => setAddFromListFilter({ ...addFromListFilter, commune: e.target.value })}
                        disabled={!addFromListFilter.ville}
                        style={{ ...fieldStyle, marginBottom: 0 }}
                      >
                        <option value="">Toutes les communes</option>
                        {[...new Set(PHARMACIES_SEED.filter((r) => r.ville === addFromListFilter.ville).map((r) => r.commune))].sort().map((c) => (<option key={c}>{c}</option>))}
                      </select>
                      <input
                        placeholder="Quartier / adresse"
                        value={addFromListFilter.quartier}
                        onChange={(e) => setAddFromListFilter({ ...addFromListFilter, quartier: e.target.value })}
                        style={{ ...fieldStyle, marginBottom: 0 }}
                      />
                    </div>

                    {filtered.length > 0 && (
                      <button onClick={() => addFilteredSeedPharmacies(filtered)} disabled={importingSeed} style={{
                        padding: "8px 16px", backgroundColor: "#0F7A6E", color: "white", border: "none",
                        borderRadius: 6, cursor: importingSeed ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 12.5,
                        marginBottom: 14,
                      }}>
                        {importingSeed ? "Ajout…" : `+ Ajouter ces ${filtered.length} résultat(s)`}
                      </button>
                    )}

                    {filtered.length === 0 ? (
                      <p style={{ fontSize: 13, color: COLORS.slate }}>
                        {notYetAdded.length === 0 ? "Toutes les pharmacies fournies ont déjà été ajoutées." : "Aucun résultat pour ce filtre."}
                      </p>
                    ) : (
                      <div style={{ display: "grid", gap: 6, maxHeight: 320, overflowY: "auto" }}>
                        {filtered.map((row, i) => (
                          <div key={i} style={{
                            display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8,
                            padding: "8px 12px", backgroundColor: "#fff", borderRadius: 6, border: `1px solid ${COLORS.line}`,
                          }}>
                            <div>
                              <div style={{ fontWeight: 700, color: COLORS.ink, fontSize: 13 }}>{row.name}</div>
                              <div style={{ fontSize: 11, color: COLORS.slate }}>
                                {[row.commune, row.address, row.ville].filter(Boolean).join(", ")}{row.responsiblePerson && ` · ${row.responsiblePerson}`}
                              </div>
                            </div>
                            <button onClick={() => addSingleSeedPharmacy(row)} disabled={addingSingleName === row.name} style={{
                              padding: "5px 12px", backgroundColor: COLORS.green, color: "white", border: "none",
                              borderRadius: 5, cursor: addingSingleName === row.name ? "not-allowed" : "pointer", fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap",
                            }}>
                              {addingSingleName === row.name ? "Ajout…" : "+ Ajouter"}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {addFacilityTab === "manual" && (
                <div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div>
                  <input placeholder="Nom" value={facilityForm.name} onChange={(e) => setFacilityForm({ ...facilityForm, name: e.target.value })} disabled={creatingFacility} style={fieldStyle} />
                  <input placeholder="Adresse (optionnel)" value={facilityForm.address} onChange={(e) => setFacilityForm({ ...facilityForm, address: e.target.value })} disabled={creatingFacility} style={fieldStyle} />
                  <input placeholder="Téléphone (optionnel)" value={facilityForm.phone} onChange={(e) => setFacilityForm({ ...facilityForm, phone: e.target.value })} disabled={creatingFacility} style={fieldStyle} />
                  <select
                    value={facilityForm.ville}
                    onChange={(e) => setFacilityForm({ ...facilityForm, ville: e.target.value, commune: "", quartier: "" })}
                    disabled={creatingFacility} style={fieldStyle}
                  >
                    <option value="">Ville…</option>
                    {Object.keys(VILLES).sort().map((v) => (<option key={v}>{v}</option>))}
                  </select>
                  {facilityForm.ville && Object.keys(VILLES[facilityForm.ville] || {}).length > 0 ? (
                    <select
                      value={facilityForm.commune}
                      onChange={(e) => setFacilityForm({ ...facilityForm, commune: e.target.value, quartier: "" })}
                      disabled={creatingFacility} style={fieldStyle}
                    >
                      <option value="">Commune…</option>
                      {Object.keys(VILLES[facilityForm.ville]).map((c) => (<option key={c}>{c}</option>))}
                    </select>
                  ) : (
                    <input placeholder={facilityForm.ville ? "Commune (communes non répertoriées pour cette ville)" : "Choisir une ville d'abord"} value={facilityForm.commune} onChange={(e) => setFacilityForm({ ...facilityForm, commune: e.target.value })} disabled={creatingFacility || !facilityForm.ville} style={fieldStyle} />
                  )}
                  {facilityForm.ville && facilityForm.commune && (VILLES[facilityForm.ville]?.[facilityForm.commune]?.length > 0) ? (
                    <select
                      value={facilityForm.quartier}
                      onChange={(e) => setFacilityForm({ ...facilityForm, quartier: e.target.value })}
                      disabled={creatingFacility} style={fieldStyle}
                    >
                      <option value="">Quartier…</option>
                      {VILLES[facilityForm.ville][facilityForm.commune].map((q) => (<option key={q}>{q}</option>))}
                    </select>
                  ) : (
                    <input placeholder={facilityForm.commune ? "Quartier (non répertorié)" : "Choisir une commune d'abord"} value={facilityForm.quartier} onChange={(e) => setFacilityForm({ ...facilityForm, quartier: e.target.value })} disabled={creatingFacility || !facilityForm.commune} style={fieldStyle} />
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.slate, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.03em" }}>
                    Administrateur de l'établissement
                  </div>
                  <input placeholder="Prénom" value={facilityForm.adminFirstName} onChange={(e) => setFacilityForm({ ...facilityForm, adminFirstName: e.target.value })} disabled={creatingFacility} style={fieldStyle} />
                  <input placeholder="Nom" value={facilityForm.adminLastName} onChange={(e) => setFacilityForm({ ...facilityForm, adminLastName: e.target.value })} disabled={creatingFacility} style={fieldStyle} />
                  <input placeholder="Email" type="email" value={facilityForm.adminEmail} onChange={(e) => setFacilityForm({ ...facilityForm, adminEmail: e.target.value })} disabled={creatingFacility} style={fieldStyle} />
                  <input placeholder="Mot de passe temporaire" value={facilityForm.adminPassword} onChange={(e) => setFacilityForm({ ...facilityForm, adminPassword: e.target.value })} disabled={creatingFacility} style={fieldStyle} />
                </div>
              </div>
              <button onClick={createFacility} disabled={creatingFacility} style={{
                width: "100%", padding: 12, backgroundColor: COLORS.green, color: "white", border: "none",
                borderRadius: 6, cursor: creatingFacility ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 14,
                opacity: creatingFacility ? 0.7 : 1, marginTop: 4,
              }}>
                {creatingFacility ? "Création…" : `+ Créer ${facilityForm.facilityType === "pharmacy" ? "la pharmacie" : "le laboratoire"}`}
              </button>
                </div>
              )}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 22, marginBottom: 10 }}>
            <select
              value={facilityJumpTo.pharmacy}
              onChange={(e) => {
                setFacilityJumpTo({ ...facilityJumpTo, pharmacy: e.target.value });
                if (e.target.value) setFacilityListFilter({ search: e.target.value, ville: "", commune: "", quartier: "" });
              }}
              style={{ ...fieldStyle, marginBottom: 0 }}
            >
              <option value="">💊 Aller à une pharmacie…</option>
              {[...pharmacies].sort((a, b) => a.name.localeCompare(b.name)).map((f) => (<option key={f.id} value={f.name}>{f.name}</option>))}
            </select>
            <select
              value={facilityJumpTo.lab}
              onChange={(e) => {
                setFacilityJumpTo({ ...facilityJumpTo, lab: e.target.value });
                if (e.target.value) setFacilityListFilter({ search: e.target.value, ville: "", commune: "", quartier: "" });
              }}
              style={{ ...fieldStyle, marginBottom: 0 }}
            >
              <option value="">🧪 Aller à un laboratoire…</option>
              {[...labs].sort((a, b) => a.name.localeCompare(b.name)).map((f) => (<option key={f.id} value={f.name}>{f.name}</option>))}
            </select>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", gap: 10, marginBottom: 18 }}>
            <input
              placeholder="🔍 Rechercher par nom…"
              value={facilityListFilter.search}
              onChange={(e) => { setFacilityListFilter({ ...facilityListFilter, search: e.target.value }); setFacilityJumpTo({ pharmacy: "", lab: "" }); }}
              style={{ ...fieldStyle, marginBottom: 0 }}
            />
            <select
              value={facilityListFilter.ville}
              onChange={(e) => setFacilityListFilter({ ...facilityListFilter, ville: e.target.value, commune: "", quartier: "" })}
              style={{ ...fieldStyle, marginBottom: 0 }}
            >
              <option value="">Toutes les villes</option>
              {Object.keys(VILLES).sort().map((v) => (<option key={v}>{v}</option>))}
            </select>
            {facilityListFilter.ville && Object.keys(VILLES[facilityListFilter.ville] || {}).length > 0 ? (
              <select
                value={facilityListFilter.commune}
                onChange={(e) => setFacilityListFilter({ ...facilityListFilter, commune: e.target.value, quartier: "" })}
                style={{ ...fieldStyle, marginBottom: 0 }}
              >
                <option value="">Toutes les communes</option>
                {Object.keys(VILLES[facilityListFilter.ville]).map((c) => (<option key={c}>{c}</option>))}
              </select>
            ) : (
              <input
                placeholder={facilityListFilter.ville ? "Commune" : "Ville d'abord"}
                value={facilityListFilter.commune}
                onChange={(e) => setFacilityListFilter({ ...facilityListFilter, commune: e.target.value })}
                disabled={!facilityListFilter.ville}
                style={{ ...fieldStyle, marginBottom: 0 }}
              />
            )}
            {facilityListFilter.ville && facilityListFilter.commune && (VILLES[facilityListFilter.ville]?.[facilityListFilter.commune]?.length > 0) ? (
              <select
                value={facilityListFilter.quartier}
                onChange={(e) => setFacilityListFilter({ ...facilityListFilter, quartier: e.target.value })}
                style={{ ...fieldStyle, marginBottom: 0 }}
              >
                <option value="">Tous les quartiers</option>
                {VILLES[facilityListFilter.ville][facilityListFilter.commune].map((q) => (<option key={q}>{q}</option>))}
              </select>
            ) : (
              <input
                placeholder={facilityListFilter.commune ? "Quartier" : "Commune d'abord"}
                value={facilityListFilter.quartier}
                onChange={(e) => setFacilityListFilter({ ...facilityListFilter, quartier: e.target.value })}
                disabled={!facilityListFilter.commune}
                style={{ ...fieldStyle, marginBottom: 0 }}
              />
            )}
          </div>

          {[{ label: "💊 Pharmacies", type: "pharmacy", list: pharmacies }].map((section) => {
            const filtered = section.list.filter((f) => {
              if (facilityListFilter.search.trim() && !f.name.toLowerCase().includes(facilityListFilter.search.trim().toLowerCase())) return false;
              if (facilityListFilter.ville && f.ville !== facilityListFilter.ville) return false;
              if (facilityListFilter.commune && f.commune !== facilityListFilter.commune) return false;
              if (facilityListFilter.quartier && f.quartier !== facilityListFilter.quartier) return false;
              return true;
            });
            const filterActive = facilityListFilter.search.trim() || facilityListFilter.ville || facilityListFilter.commune || facilityListFilter.quartier;
            return (
              <div key={section.type} style={{ marginBottom: 22 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.slate, textTransform: "uppercase", letterSpacing: "0.03em" }}>
                    {section.label} ({filtered.length}{filterActive ? ` / ${section.list.length}` : ""})
                  </div>
                  {section.list.length > 0 && (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => bulkToggleFacilities(section.type, true)} disabled={bulkTogglingType === section.type} style={{
                        padding: "5px 12px", backgroundColor: COLORS.green, color: "white", border: "none",
                        borderRadius: 5, cursor: bulkTogglingType === section.type ? "not-allowed" : "pointer", fontSize: 11.5, fontWeight: 600,
                        opacity: bulkTogglingType === section.type ? 0.6 : 1,
                      }}>
                        Activer tout
                      </button>
                      <button onClick={() => bulkToggleFacilities(section.type, false)} disabled={bulkTogglingType === section.type} style={{
                        padding: "5px 12px", backgroundColor: "#6c757d", color: "white", border: "none",
                        borderRadius: 5, cursor: bulkTogglingType === section.type ? "not-allowed" : "pointer", fontSize: 11.5, fontWeight: 600,
                        opacity: bulkTogglingType === section.type ? 0.6 : 1,
                      }}>
                        Désactiver tout
                      </button>
                    </div>
                  )}
                </div>
                {filtered.length === 0 ? (
                  <p style={{ fontSize: 13, color: COLORS.slate, margin: 0 }}>
                    {section.list.length === 0 ? "Aucun(e) pour l'instant." : "Aucun résultat pour ce filtre."}
                  </p>
                ) : (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                      <button onClick={() => selectAllVisible(section.type, filtered.map((f) => f.id))} style={{ background: "none", border: "none", color: "#2E5C8C", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0 }}>
                        Tout sélectionner ({filtered.length})
                      </button>
                      {selectedFacilityIds[section.type].length > 0 && (
                        <>
                          <button onClick={() => clearSelection(section.type)} style={{ background: "none", border: "none", color: COLORS.slate, fontSize: 12, cursor: "pointer", padding: 0 }}>
                            Désélectionner
                          </button>
                          <span style={{ fontSize: 12, color: COLORS.slate }}>· {selectedFacilityIds[section.type].length} sélectionné(s)</span>
                          <button onClick={() => toggleSelectedFacilities(section.type, true)} disabled={bulkTogglingType === section.type} style={{
                            padding: "4px 10px", backgroundColor: COLORS.green, color: "white", border: "none",
                            borderRadius: 5, cursor: bulkTogglingType === section.type ? "not-allowed" : "pointer", fontSize: 11.5, fontWeight: 600,
                          }}>
                            Activer la sélection
                          </button>
                          <button onClick={() => toggleSelectedFacilities(section.type, false)} disabled={bulkTogglingType === section.type} style={{
                            padding: "4px 10px", backgroundColor: "#6c757d", color: "white", border: "none",
                            borderRadius: 5, cursor: bulkTogglingType === section.type ? "not-allowed" : "pointer", fontSize: 11.5, fontWeight: 600,
                          }}>
                            Désactiver la sélection
                          </button>
                        </>
                      )}
                    </div>
                    <div style={{ display: "grid", gap: 8, maxHeight: 420, overflowY: "auto" }}>
                    {filtered.map((f) => (
                      <div key={f.id} style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8,
                        padding: "10px 14px", backgroundColor: COLORS.paper, borderRadius: 8, border: `1px solid ${COLORS.line}`,
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <input
                            type="checkbox"
                            checked={selectedFacilityIds[section.type].includes(f.id)}
                            onChange={() => toggleFacilitySelection(section.type, f.id)}
                            style={{ width: 16, height: 16, cursor: "pointer", flexShrink: 0 }}
                          />
                          <div>
                            <div style={{ fontWeight: 700, color: COLORS.ink, fontSize: 13.5 }}>
                              {f.name} {!f.active && <span style={{ color: COLORS.dangerText, fontSize: 11 }}>(désactivé)</span>}
                              {f.claimed === false && <span style={{ color: "#8A5A00", fontSize: 11, fontWeight: 700 }}> · Non réclamée</span>}
                            </div>
                            <div style={{ fontSize: 11.5, color: COLORS.slate, marginTop: 2 }}>
                              {[f.commune, f.quartier, f.ville].filter(Boolean).join(", ")} {f.hospitalId ? "· établissement interne d'un hôpital" : "· indépendant"}
                              {f.responsiblePerson && ` · Responsable: ${f.responsiblePerson}`}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {f.claimed === false ? (
                            <button onClick={() => openClaimForm(section.type, f)} style={{ padding: "5px 10px", backgroundColor: "#8A5A00", color: "white", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 11.5, fontWeight: 600 }}>
                              Réclamer (créer l'admin)
                            </button>
                          ) : (
                            <button onClick={() => openFacilityStaffPanel(section.type, f)} style={{ padding: "5px 10px", backgroundColor: "#2E5C8C", color: "white", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 11.5, fontWeight: 600 }}>
                              👤 Personnel
                            </button>
                          )}
                          <button onClick={() => toggleFacilityActive(section.type, f)} style={{ padding: "5px 10px", backgroundColor: f.active ? "#6c757d" : COLORS.green, color: "white", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 11.5, fontWeight: 600 }}>
                            {f.active ? "Désactiver" : "Réactiver"}
                          </button>
                          <button onClick={() => deleteFacility(section.type, f)} style={{ padding: "5px 10px", backgroundColor: COLORS.red, color: "white", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 11.5, fontWeight: 600 }}>
                            Supprimer
                          </button>
                        </div>
                      </div>
                    ))}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {[
          {
            type: "pharmacy", title: "Import en masse — Pharmacies", accent: "#0F7A6E",
            open: pharmacyImportOpen, setOpen: setPharmacyImportOpen,
            text: pharmacyImportText, setText: setPharmacyImportText,
            preview: pharmacyImportPreview, parse: parsePharmacyImport, submit: submitPharmacyImport,
            importing: importingPharmacyBulk,
          },
        ].map((imp) => (
          <div key={imp.type} style={{
            marginTop: 30, padding: 26, backgroundColor: COLORS.card, borderRadius: 10,
            border: `1px solid ${COLORS.line}`, borderTop: `4px solid ${imp.accent}`,
            boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <h2 style={{ color: COLORS.ink, margin: 0, fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700 }}>
                {imp.title}
              </h2>
              <button onClick={() => imp.setOpen((v) => !v)} style={{
                padding: "7px 16px", backgroundColor: imp.open ? "#6c757d" : imp.accent, color: "white", border: "none",
                borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 12.5,
              }}>
                {imp.open ? "✕ Fermer" : "Ouvrir"}
              </button>
            </div>

            {imp.open && (
              <div style={{ marginTop: 18 }}>
                <p style={{ color: COLORS.slate, fontSize: 13, marginTop: 0, marginBottom: 14, maxWidth: 720 }}>
                  Pour importer une liste réelle (ex: un registre national) sans créer de compte administrateur pour
                  chacun. Ces établissements restent visibles et utilisables par les médecins, mais sont marqués
                  « Non réclamée » jusqu'à ce qu'un vrai administrateur leur soit attribué.
                </p>
                <p style={{ fontSize: 12, color: COLORS.slate, marginBottom: 8 }}>
                  Une ligne par établissement, séparée par des virgules ou des tabulations, dans cet ordre :<br />
                  <code style={{ backgroundColor: COLORS.paper, padding: "2px 6px", borderRadius: 4 }}>
                    nom, adresse/quartier, commune, ville, téléphone (optionnel), responsable (optionnel)
                  </code>
                </p>
                <textarea
                  value={imp.text}
                  onChange={(e) => imp.setText(e.target.value)}
                  placeholder={imp.type === "pharmacy"
                    ? "OFFICINE AGUIBOU SYLLA, Wayerma, Sikasso, Sikasso, , M. SYLLA Aguibou\nOFFICINE YAYA SOGODOGO, Wayerma, Sikasso, Sikasso, , M. SOGODOGO Yaya"
                    : "LABORATOIRE CENTRAL, Hamdallaye, Sikasso, Sikasso, , M. TRAORE Amadou"}
                  rows={8}
                  style={{
                    width: "100%",
                    padding: "16px 18px",
                    borderRadius: 10,
                    border: `1px solid ${COLORS.line}`,
                    fontSize: 13.5,
                    lineHeight: 1.7,
                    boxSizing: "border-box",
                    fontFamily: "monospace",
                    resize: "vertical",
                    marginBottom: 14,
                    minHeight: 140,
                    backgroundColor: "#fff",
                  }}
                />
                <button onClick={imp.parse} disabled={!imp.text.trim()} style={{
                  padding: "9px 18px", backgroundColor: imp.accent, color: "white", border: "none",
                  borderRadius: 6, cursor: !imp.text.trim() ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 13.5,
                  opacity: !imp.text.trim() ? 0.6 : 1, marginBottom: 16,
                }}>
                  Aperçu
                </button>

                {imp.preview.length > 0 && (
                  <>
                    <div style={{ maxHeight: 260, overflowY: "auto", border: `1px solid ${COLORS.line}`, borderRadius: 8, marginBottom: 14 }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                        <thead><tr style={{ backgroundColor: COLORS.ink, color: "white" }}>
                          {["Nom", "Adresse", "Commune", "Ville", "Téléphone", "Responsable"].map((h) => (
                            <th key={h} style={{ padding: "6px 10px", textAlign: "left", fontSize: 11 }}>{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {imp.preview.map((r, i) => (
                            <tr key={i} style={{ borderBottom: `1px solid ${COLORS.line}`, backgroundColor: (!r.name || !r.ville) ? COLORS.dangerBg : "transparent" }}>
                              <td style={{ padding: "4px 10px" }}>{r.name || <em style={{ color: COLORS.dangerText }}>manquant</em>}</td>
                              <td style={{ padding: "4px 10px" }}>{r.address}</td>
                              <td style={{ padding: "4px 10px" }}>{r.commune}</td>
                              <td style={{ padding: "4px 10px" }}>{r.ville || <em style={{ color: COLORS.dangerText }}>manquant</em>}</td>
                              <td style={{ padding: "4px 10px" }}>{r.phone}</td>
                              <td style={{ padding: "4px 10px" }}>{r.responsiblePerson}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p style={{ fontSize: 12, color: COLORS.slate, marginBottom: 12 }}>
                      {imp.preview.filter((r) => r.name && r.ville).length} ligne(s) valide(s) sur {imp.preview.length}
                      {imp.preview.some((r) => !r.name || !r.ville) && " — les lignes en rouge (nom ou ville manquant) seront ignorées."}
                    </p>
                    <button onClick={imp.submit} disabled={imp.importing} style={{
                      padding: "10px 22px", backgroundColor: COLORS.green, color: "white", border: "none",
                      borderRadius: 6, cursor: imp.importing ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 14,
                      opacity: imp.importing ? 0.7 : 1,
                    }}>
                      {imp.importing ? "Import en cours…" : `+ Importer ${imp.preview.filter((r) => r.name && r.ville).length} établissement(s)`}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
        </>
        )}

        {activeTab === "notifications" && (
        <div style={{
          padding: 26, backgroundColor: COLORS.card, borderRadius: 10,
          border: `1px solid ${COLORS.line}`, borderTop: `4px solid ${COLORS.gold}`,
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)", maxWidth: 640,
        }}>
          <h2 style={{ color: COLORS.ink, marginTop: 0, marginBottom: 4, fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 700 }}>
            Diffuser une notification
          </h2>
          <p style={{ color: COLORS.slate, fontSize: 13, marginTop: 0, marginBottom: 18 }}>
            Visible dans le tableau de bord de chaque membre du personnel concerné, dès sa prochaine connexion ou en temps réel.
          </p>
          <input placeholder="Titre" value={broadcastForm.title} onChange={(e) => setBroadcastForm({ ...broadcastForm, title: e.target.value })} disabled={broadcasting} style={fieldStyle} />
          <textarea
            placeholder="Message"
            value={broadcastForm.message}
            onChange={(e) => setBroadcastForm({ ...broadcastForm, message: e.target.value })}
            disabled={broadcasting}
            style={{ ...fieldStyle, minHeight: 130, padding: "14px 16px", lineHeight: 1.6, fontFamily: FONT_BODY }}
          />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            <select value={broadcastForm.severity} onChange={(e) => setBroadcastForm({ ...broadcastForm, severity: e.target.value })} disabled={broadcasting} style={{ ...fieldStyle, marginBottom: 0 }}>
              <option value="info">ℹ️ Information</option>
              <option value="warning">⚠️ Avertissement</option>
              <option value="urgent">🚨 Urgent</option>
            </select>
            <select value={broadcastForm.targetHospitalId} onChange={(e) => setBroadcastForm({ ...broadcastForm, targetHospitalId: e.target.value })} disabled={broadcasting} style={{ ...fieldStyle, marginBottom: 0 }}>
              <option value="">Tous les hôpitaux</option>
              {hospitals.map((h) => (<option key={h.id} value={h.id}>{h.name}</option>))}
            </select>
          </div>
          <button onClick={sendBroadcast} disabled={broadcasting} style={{
            width: "100%", padding: 13, backgroundColor: COLORS.ink, color: "white", border: "none",
            borderRadius: 6, cursor: broadcasting ? "not-allowed" : "pointer", fontSize: 14.5, fontWeight: 700,
            opacity: broadcasting ? 0.7 : 1,
          }}>
            {broadcasting ? "Diffusion en cours…" : "📢 Diffuser"}
          </button>
        </div>
        )}

        <div style={{ borderTop: `1px solid ${COLORS.line}`, marginTop: 34, padding: "18px 0", textAlign: "center", fontSize: 12.5, color: COLORS.slate }}>
          République du Mali — Ministère de la Santé · Système national de gestion hospitalière
        </div>
      </div>

      {managingStaffFor && (
        <div
          onClick={closeFacilityStaffPanel}
          style={{ position: "fixed", inset: 0, backgroundColor: "rgba(22,28,26,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 1000 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: "#fff", borderRadius: 14, width: "min(560px, 100%)", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.35)", borderTop: `6px solid ${COLORS.gold}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "22px 28px 18px", borderBottom: `1px solid ${COLORS.line}` }}>
              <h2 style={{ margin: 0, fontFamily: FONT_DISPLAY, fontSize: 20, color: COLORS.ink }}>Personnel — {managingStaffFor.facilityName}</h2>
              <button onClick={closeFacilityStaffPanel} aria-label="Fermer" style={{ width: 36, height: 36, borderRadius: "50%", border: "none", backgroundColor: COLORS.paper, color: COLORS.ink, fontSize: 18, fontWeight: 700, cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ padding: "22px 28px 28px" }}>
              <div style={{ display: "grid", gap: 8, marginBottom: 20 }}>
                {facilityStaffList.length === 0 ? (
                  <p style={{ fontSize: 13.5, color: COLORS.slate, margin: 0 }}>Aucun membre du personnel pour l'instant.</p>
                ) : facilityStaffList.map((s) => (
                  <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", backgroundColor: COLORS.paper, borderRadius: 8, border: `1px solid ${COLORS.line}` }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13.5, color: COLORS.ink }}>{s.firstName} {s.lastName} {s.disabled && <span style={{ color: COLORS.dangerText, fontSize: 11 }}>(désactivé)</span>}</div>
                      <div style={{ fontSize: 12, color: COLORS.slate }}>{s.email}</div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => toggleFacilityStaffDisabled(s.id, !s.disabled)} style={{ padding: "5px 10px", backgroundColor: s.disabled ? COLORS.green : "#6c757d", color: "white", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
                        {s.disabled ? "Réactiver" : "Désactiver"}
                      </button>
                      <button onClick={() => deleteFacilityStaffMember(s.id, `${s.firstName} ${s.lastName}`)} style={{ padding: "5px 10px", backgroundColor: COLORS.red, color: "white", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
                        Supprimer
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ fontWeight: 700, fontSize: 13.5, color: COLORS.ink, marginBottom: 10 }}>Ajouter un membre</div>
              <input placeholder="Prénom" value={newFacilityStaffForm.firstName} onChange={(e) => setNewFacilityStaffForm({ ...newFacilityStaffForm, firstName: e.target.value })} disabled={creatingFacilityStaff} style={fieldStyle} />
              <input placeholder="Nom" value={newFacilityStaffForm.lastName} onChange={(e) => setNewFacilityStaffForm({ ...newFacilityStaffForm, lastName: e.target.value })} disabled={creatingFacilityStaff} style={fieldStyle} />
              <input placeholder="Email" type="email" value={newFacilityStaffForm.email} onChange={(e) => setNewFacilityStaffForm({ ...newFacilityStaffForm, email: e.target.value })} disabled={creatingFacilityStaff} style={fieldStyle} />
              <input placeholder="Mot de passe temporaire" value={newFacilityStaffForm.password} onChange={(e) => setNewFacilityStaffForm({ ...newFacilityStaffForm, password: e.target.value })} disabled={creatingFacilityStaff} style={fieldStyle} />
              <button onClick={createNewFacilityStaff} disabled={creatingFacilityStaff} style={{ width: "100%", padding: 12, backgroundColor: COLORS.green, color: "white", border: "none", borderRadius: 6, cursor: creatingFacilityStaff ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 14, opacity: creatingFacilityStaff ? 0.7 : 1 }}>
                {creatingFacilityStaff ? "Création…" : "+ Créer le compte"}
              </button>
            </div>
          </div>
        </div>
      )}

      {claimingFacility && (
        <div
          onClick={() => setClaimingFacility(null)}
          style={{ position: "fixed", inset: 0, backgroundColor: "rgba(22,28,26,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 1000 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: "#fff", borderRadius: 14, width: "min(480px, 100%)", boxShadow: "0 20px 60px rgba(0,0,0,0.35)", borderTop: "6px solid #8A5A00" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "22px 28px 18px", borderBottom: `1px solid ${COLORS.line}` }}>
              <h2 style={{ margin: 0, fontFamily: FONT_DISPLAY, fontSize: 19, color: COLORS.ink }}>Réclamer — {claimingFacility.name}</h2>
              <button onClick={() => setClaimingFacility(null)} aria-label="Fermer" style={{ width: 36, height: 36, borderRadius: "50%", border: "none", backgroundColor: COLORS.paper, color: COLORS.ink, fontSize: 18, fontWeight: 700, cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ padding: "22px 28px 28px" }}>
              <p style={{ fontSize: 13, color: COLORS.slate, marginTop: 0, marginBottom: 16 }}>
                Crée un compte administrateur réel pour cet établissement importé — une fois fait, il ne sera plus marqué « Non réclamée ».
              </p>
              {claimError && (
                <div style={{ padding: "10px 14px", marginBottom: 14, borderRadius: 6, backgroundColor: COLORS.dangerBg, color: COLORS.dangerText, fontSize: 13, fontWeight: 500 }}>
                  ❌ {claimError}
                </div>
              )}
              <input placeholder="Prénom" value={claimForm.adminFirstName} onChange={(e) => setClaimForm({ ...claimForm, adminFirstName: e.target.value })} disabled={submittingClaim} style={fieldStyle} />
              <input placeholder="Nom" value={claimForm.adminLastName} onChange={(e) => setClaimForm({ ...claimForm, adminLastName: e.target.value })} disabled={submittingClaim} style={fieldStyle} />
              <input placeholder="Email" type="email" value={claimForm.adminEmail} onChange={(e) => setClaimForm({ ...claimForm, adminEmail: e.target.value })} disabled={submittingClaim} style={fieldStyle} />
              <input placeholder="Mot de passe temporaire" value={claimForm.adminPassword} onChange={(e) => setClaimForm({ ...claimForm, adminPassword: e.target.value })} disabled={submittingClaim} style={fieldStyle} />
              <button onClick={submitClaim} disabled={submittingClaim} style={{ width: "100%", padding: 12, backgroundColor: "#8A5A00", color: "white", border: "none", borderRadius: 6, cursor: submittingClaim ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 14, opacity: submittingClaim ? 0.7 : 1 }}>
                {submittingClaim ? "Création…" : "Réclamer cet établissement"}
              </button>
            </div>
          </div>
        </div>
      )}
      {showHospitalDetail && (
        <div
          onClick={() => setShowHospitalDetail(null)}
          style={{ position: "fixed", inset: 0, backgroundColor: "rgba(22,28,26,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 1000 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: "#fff", borderRadius: 14, width: "min(640px, 100%)", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.35)", borderTop: `6px solid ${COLORS.red}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "22px 28px 18px", borderBottom: `1px solid ${COLORS.line}` }}>
              <h2 style={{ margin: 0, fontFamily: FONT_DISPLAY, fontSize: 20, color: COLORS.ink }}>{showHospitalDetail.name}</h2>
              <button onClick={() => setShowHospitalDetail(null)} aria-label="Fermer" style={{ width: 36, height: 36, borderRadius: "50%", border: "none", backgroundColor: COLORS.paper, color: COLORS.ink, fontSize: 18, fontWeight: 700, cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ padding: "22px 28px 28px" }}>
              {/* Basic info */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 22, fontSize: 13.5 }}>
                <div><span style={{ color: COLORS.slate }}>Adresse:</span> <strong style={{ color: COLORS.ink }}>{showHospitalDetail.address || "—"}</strong></div>
                <div><span style={{ color: COLORS.slate }}>Prix ticket:</span> <strong style={{ color: COLORS.ink }}>{showHospitalDetail.ticketPrice != null ? `${showHospitalDetail.ticketPrice.toLocaleString("fr-FR")} FCFA` : "—"}</strong></div>
                <div><span style={{ color: COLORS.slate }}>Créé le:</span> <strong style={{ color: COLORS.ink }}>{new Date(showHospitalDetail.createdAt).toLocaleDateString("fr-FR")}</strong></div>
                <div><span style={{ color: COLORS.slate }}>Statut:</span> <strong style={{ color: showHospitalDetail.active ? COLORS.successText : COLORS.dangerText }}>{showHospitalDetail.active ? "Actif" : "Désactivé"}</strong></div>
              </div>

              {/* Departments */}
              <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.slate, textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 8 }}>
                Départements ({(showHospitalDetail.departments || []).length})
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 22 }}>
                {(showHospitalDetail.departments || []).length === 0 ? (
                  <span style={{ fontSize: 13, color: COLORS.slate }}>Aucun département configuré.</span>
                ) : (
                  showHospitalDetail.departments.map((d) => (
                    <span key={d} style={{ padding: "4px 12px", borderRadius: 20, backgroundColor: COLORS.paper, border: `1px solid ${COLORS.line}`, fontSize: 12.5, color: COLORS.ink, fontWeight: 600 }}>{d}</span>
                  ))
                )}
              </div>

              {loadingHospitalDetail ? (
                <p style={{ fontSize: 13, color: COLORS.slate }}>Chargement…</p>
              ) : (
                <>
                  {/* Hospital admins — add/edit/remove */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.slate, textTransform: "uppercase", letterSpacing: "0.03em" }}>
                      Administrateurs
                    </div>
                    <button onClick={() => setShowAddAdminForm((v) => !v)} style={{
                      padding: "4px 10px", backgroundColor: showAddAdminForm ? "#6c757d" : COLORS.green, color: "white", border: "none",
                      borderRadius: 5, cursor: "pointer", fontSize: 11.5, fontWeight: 600,
                    }}>
                      {showAddAdminForm ? "✕ Annuler" : "+ Ajouter"}
                    </button>
                  </div>

                  {showAddAdminForm && (
                    <div style={{ padding: 14, marginBottom: 14, backgroundColor: COLORS.paper, borderRadius: 8, border: `1px solid ${COLORS.line}` }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <input placeholder="Prénom" value={addAdminForm.firstName} onChange={(e) => setAddAdminForm({ ...addAdminForm, firstName: e.target.value })} disabled={addingAdmin} style={{ ...fieldStyle, marginBottom: 8 }} />
                        <input placeholder="Nom" value={addAdminForm.lastName} onChange={(e) => setAddAdminForm({ ...addAdminForm, lastName: e.target.value })} disabled={addingAdmin} style={{ ...fieldStyle, marginBottom: 8 }} />
                      </div>
                      <input placeholder="Email" type="email" value={addAdminForm.email} onChange={(e) => setAddAdminForm({ ...addAdminForm, email: e.target.value })} disabled={addingAdmin} style={{ ...fieldStyle, marginBottom: 8 }} />
                      <input placeholder="Mot de passe temporaire" value={addAdminForm.password} onChange={(e) => setAddAdminForm({ ...addAdminForm, password: e.target.value })} disabled={addingAdmin} style={{ ...fieldStyle, marginBottom: 10 }} />
                      <button onClick={addHospitalAdmin} disabled={addingAdmin} style={{
                        width: "100%", padding: 10, backgroundColor: COLORS.green, color: "white", border: "none",
                        borderRadius: 6, cursor: addingAdmin ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 13,
                        opacity: addingAdmin ? 0.7 : 1,
                      }}>
                        {addingAdmin ? "Création…" : "Créer l'administrateur"}
                      </button>
                    </div>
                  )}

                  {(() => {
                    const admins = hospitalDetailStaff.filter((u) => u.role === "hospitaladmin");
                    if (admins.length === 0) {
                      return <p style={{ fontSize: 13, color: COLORS.slate, marginBottom: 22 }}>Aucun administrateur pour cet hôpital.</p>;
                    }
                    return (
                      <div style={{ display: "grid", gap: 6, marginBottom: 22 }}>
                        {admins.map((a) => (
                          <div key={a.id} style={{ padding: "10px 12px", backgroundColor: "#F5EFE6", borderRadius: 8, border: "1px solid #D9C9AA" }}>
                            {editingAdminId === a.id ? (
                              <div>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                                  <input value={editAdminForm.firstName} onChange={(e) => setEditAdminForm({ ...editAdminForm, firstName: e.target.value })} style={{ padding: 6, borderRadius: 5, border: `1px solid ${COLORS.line}`, fontSize: 13 }} />
                                  <input value={editAdminForm.lastName} onChange={(e) => setEditAdminForm({ ...editAdminForm, lastName: e.target.value })} style={{ padding: 6, borderRadius: 5, border: `1px solid ${COLORS.line}`, fontSize: 13 }} />
                                </div>
                                <div style={{ display: "flex", gap: 6 }}>
                                  <button onClick={() => saveEditAdmin(a.id)} style={{ padding: "5px 12px", backgroundColor: COLORS.green, color: "white", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 11.5, fontWeight: 600 }}>Sauver</button>
                                  <button onClick={() => setEditingAdminId(null)} style={{ padding: "5px 12px", backgroundColor: "transparent", color: COLORS.slate, border: `1px solid ${COLORS.line}`, borderRadius: 5, cursor: "pointer", fontSize: 11.5, fontWeight: 600 }}>Annuler</button>
                                </div>
                              </div>
                            ) : (
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                                <div>
                                  <div style={{ fontWeight: 700, color: COLORS.ink, fontSize: 13.5 }}>
                                    {a.firstName} {a.lastName} {a.disabled && <span style={{ color: COLORS.dangerText, fontSize: 11 }}>(désactivé)</span>}
                                  </div>
                                  <div style={{ fontSize: 11.5, color: COLORS.slate, marginTop: 2 }}>{a.email}</div>
                                </div>
                                <div style={{ display: "flex", gap: 6 }}>
                                  <button onClick={() => startEditAdmin(a)} style={{ padding: "5px 12px", backgroundColor: "#2E5C8C", color: "white", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 11.5, fontWeight: 600 }}>Modifier</button>
                                  <button onClick={() => removeHospitalAdmin(a)} disabled={deletingAdminId === a.id} style={{
                                    padding: "5px 12px", backgroundColor: COLORS.red, color: "white", border: "none",
                                    borderRadius: 5, cursor: deletingAdminId === a.id ? "not-allowed" : "pointer", fontSize: 11.5, fontWeight: 600,
                                  }}>
                                    {deletingAdminId === a.id ? "…" : "Supprimer"}
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                  {/* Staff breakdown by role */}
                  <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.slate, textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 8 }}>
                    Personnel ({hospitalDetailStaff.length})
                  </div>
                  {(() => {
                    const labels = { doctor: "Médecin", nurse: "Infirmier·ère", accueil: "Accueil", supervisor: "Superviseur", pharmacy: "Pharmacie", lab: "Laboratoire", hospitaladmin: "Administrateur" };
                    const counts = {};
                    hospitalDetailStaff.forEach((u) => { counts[u.role] = (counts[u.role] || 0) + 1; });
                    const entries = Object.entries(counts);
                    if (entries.length === 0) return <p style={{ fontSize: 13, color: COLORS.slate }}>Aucun membre du personnel.</p>;
                    return (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, marginBottom: 22 }}>
                        {entries.map(([role, count]) => (
                          <div key={role} style={{ padding: "10px 12px", backgroundColor: COLORS.paper, borderRadius: 8, border: `1px solid ${COLORS.line}`, textAlign: "center" }}>
                            <div style={{ fontSize: 20, fontWeight: 700, color: COLORS.ink, fontFamily: FONT_DISPLAY }}>{count}</div>
                            <div style={{ fontSize: 11, color: COLORS.slate, fontWeight: 600 }}>{labels[role] || role}</div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                  {/* Active sessions */}
                  <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.slate, textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 8 }}>
                    Sessions actives ({hospitalDetailSessions.length})
                  </div>
                  {hospitalDetailSessions.length === 0 ? (
                    <p style={{ fontSize: 13, color: COLORS.slate }}>Personne n'est actuellement connecté.</p>
                  ) : (
                    <div style={{ display: "grid", gap: 6 }}>
                      {hospitalDetailSessions.map((s) => (
                        <div key={s.id} style={{ padding: "8px 12px", backgroundColor: COLORS.paper, borderRadius: 6, border: `1px solid ${COLORS.line}`, fontSize: 12.5 }}>
                          <strong style={{ color: COLORS.ink }}>{s.displayName || s.email}</strong>
                          <span style={{ color: COLORS.slate }}> · {s.deviceLabel || "Appareil inconnu"} · {new Date(s.lastActivityAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
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

function StatCard({ label, value, accent, onClick }) {
  return (
    <div onClick={onClick} style={{
      backgroundColor: COLORS.card, borderRadius: 10, border: `1px solid ${COLORS.line}`,
      borderLeft: `4px solid ${accent}`, padding: "18px 20px", boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
      cursor: onClick ? "pointer" : "default",
    }}>
      <div style={{ fontSize: 12.5, color: COLORS.slate, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>{label}{onClick ? " ▾" : ""}</div>
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 32, fontWeight: 700, color: COLORS.ink, marginTop: 4 }}>{value}</div>
    </div>
  );
}

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

const secondaryBtnStyle = {
  padding: "10px 16px",
  backgroundColor: COLORS.ink,
  color: "white",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 13.5,
  fontFamily: FONT_BODY,
  boxSizing: "border-box",
  lineHeight: "20px",
  whiteSpace: "nowrap",
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