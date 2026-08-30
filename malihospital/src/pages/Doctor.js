import { useState, useEffect, useRef, Fragment } from "react";
import ChangePassword from "./ChangePassword";
import { auth, db, functions } from "../firebase";
import { collection, doc, updateDoc, getDoc, getDocs, query, where, orderBy, limit, addDoc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import NotificationsBanner from "../components/NotificationsBanner";
import SessionsButton from "../components/SessionsButton";
import { VILLES } from "../constants/villes";

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
  warnBg: "#FDF3E3",
  warnText: "#8A5A00",
};

const FONT_DISPLAY = "'Georgia', 'Iowan Old Style', 'Times New Roman', serif";
const FONT_BODY = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

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

const SESSION_KEY = "doctorSessionId";

// Must stay in sync with the PRIORITY_CONFIG in Accueil.jsx (same field,
// same keys) — rank controls queue order: lower rank is seen first.
const PRIORITY_CONFIG = {
  emergency: { label: "Urgence", emoji: "🔴", rank: 0, color: "#A31221", bg: "#FBEAEC" },
  urgent:    { label: "Urgent",  emoji: "🟠", rank: 1, color: "#8A5A00", bg: "#FDF3E3" },
  normal:    { label: "Normal",  emoji: "🟢", rank: 2, color: "#1E7B34", bg: "#E9F7EC" },
};
const priorityRank = (p) => PRIORITY_CONFIG[p]?.rank ?? PRIORITY_CONFIG.normal.rank;

// Mirrors LOCK_TIMEOUT_MS in functions/lib/helpers.js — purely for display
// (showing "🔒 Dr. X édite" live on the ticket row); the Cloud Function is
// still the actual source of truth and re-checks this itself on every write.
const LOCK_TIMEOUT_MS = 10 * 60 * 1000;
const isLockActive = (ticket, now) => {
  if (!ticket.lockedBy || !ticket.lockedAt) return false;
  return now - new Date(ticket.lockedAt).getTime() < LOCK_TIMEOUT_MS;
};

const formatDuration = (totalSeconds) => {
  if (totalSeconds == null || Number.isNaN(totalSeconds)) return "—";
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
};

export default function Doctor() {
  const [allTickets, setAllTickets] = useState([]);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [userData, setUserData] = useState(null);
  const [hospitalName, setHospitalName] = useState("");
  const [loading, setLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("active");
  const [mySchedule, setMySchedule] = useState([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [nowTick, setNowTick] = useState(Date.now());
  const [diagnosisTicketId, setDiagnosisTicketId] = useState(null);
  const [recordTicketId, setRecordTicketId] = useState(null);
  const [prescriptionTicketId, setPrescriptionTicketId] = useState(null);
  const [pharmacySearch, setPharmacySearch] = useState({ patientVille: "", patientCommune: "", patientQuartier: "", allPharmacies: [], loading: false });
  const [medicineCatalog, setMedicineCatalog] = useState([]);
  const [medicineCatalogLoading, setMedicineCatalogLoading] = useState(false);
  const [openMedicineDropdown, setOpenMedicineDropdown] = useState(null); // index of the row being searched, or null
  const [pharmacyFilter, setPharmacyFilter] = useState({ ville: "", commune: "", quartier: "" });
  const [changingPharmacy, setChangingPharmacy] = useState(true); // shows the filter/list; collapses to a summary once a pharmacy is picked
  const [prescriptionForm, setPrescriptionForm] = useState({ pharmacyId: "", patientPhone: "", medications: [{ name: "", medicineId: null, searchText: "", dosage: "", quantity: "", duration: "", instructions: "" }] });
  const [sendingPrescription, setSendingPrescription] = useState(false);
  const [ticketPrescriptions, setTicketPrescriptions] = useState([]);
  const [lastVisitPrescriptions, setLastVisitPrescriptions] = useState([]);
  const [prescriptionTab, setPrescriptionTab] = useState("new"); // last | new

  const [recordData, setRecordData] = useState(null);
  const [recordLoading, setRecordLoading] = useState(false);
  const [diagnosisForm, setDiagnosisForm] = useState({ diagnosis: "", diagnosisNotes: "" });
  const [savingDiagnosis, setSavingDiagnosis] = useState(false);
  const [acquiringLock, setAcquiringLock] = useState(null);
  const nav = useNavigate();
  const ticketsUnsubRef = useRef(null);
  const sessionStartedRef = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Best-effort: release any held record lock if the doctor navigates away
  // (route change, tab close, logout) while the diagnosis panel is still
  // open, rather than leaving it locked for the full 10-minute timeout.
  const diagnosisTicketIdRef = useRef(null);
  useEffect(() => { diagnosisTicketIdRef.current = diagnosisTicketId; }, [diagnosisTicketId]);
  useEffect(() => {
    return () => {
      if (diagnosisTicketIdRef.current) {
        httpsCallable(functions, "releasePatientRecordLock")({ ticketId: diagnosisTicketIdRef.current }).catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user) {
        checkAuthAndLoad();
      } else {
        if (ticketsUnsubRef.current) {
          ticketsUnsubRef.current();
          ticketsUnsubRef.current = null;
        }
        nav("/");
      }
    });
    return () => {
      unsubscribe();
      if (ticketsUnsubRef.current) ticketsUnsubRef.current();
    };
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
        alert("❌ Votre compte a été désactivé. Contactez l'administrateur.");
        await signOut(auth);
        nav("/");
        return;
      }
      if (user.role !== "doctor") {
        alert("❌ Accès refusé. Cette page est réservée aux médecins.");
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
      await startSessionIfNeeded(user);
      loadTickets(user);
      loadMySchedule(user);
      setPageLoading(false);
    } catch (e) {
      console.error("Error loading user data:", e);
      alert("Erreur de chargement des données: " + e.message);
      setPageLoading(false);
    }
  };

  const startSessionIfNeeded = async (user) => {
    if (sessionStartedRef.current) return;
    sessionStartedRef.current = true;
    try {
      const existing = sessionStorage.getItem(SESSION_KEY);
      if (existing) return;

      const loginAt = new Date().toISOString();
      const sessionRef = await addDoc(collection(db, "doctorSessions"), {
        doctorId: auth.currentUser.uid,
        doctorName: `Dr. ${user.firstName} ${user.lastName}`,
        hospitalId: user.hospitalId,
        department: user.department || null,
        loginAt,
        logoutAt: null,
      });
      sessionStorage.setItem(SESSION_KEY, sessionRef.id);

      await updateDoc(doc(db, "users", auth.currentUser.uid), {
        online: true,
        lastLoginAt: loginAt,
      });
    } catch (e) {
      console.warn("Could not record login session:", e);
    }
  };

  const loadTickets = (user) => {
    setLoading(true);

    const q = query(
      collection(db, "tickets"),
      where("hospitalId", "==", user.hospitalId),
      where("department", "==", user.department)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        // Emergency/urgent tickets automatically move ahead of normal ones
        // (lower priority rank = seen sooner). Within the same priority,
        // oldest-first — patients who've been waiting longest at that same
        // urgency level go to the top.
        list.sort((a, b) => {
          const rankDiff = priorityRank(a.priority) - priorityRank(b.priority);
          if (rankDiff !== 0) return rankDiff;
          return new Date(a.createdAt) - new Date(b.createdAt);
        });
        setAllTickets(list);
        setLoading(false);
      },
      (error) => {
        console.error("Error loading tickets:", error);
        if (error.code === "permission-denied" && auth.currentUser) {
          alert("⚠️ Pas de permission. Votre compte nécessite peut-être une approbation.");
        }
        setLoading(false);
      }
    );
    ticketsUnsubRef.current = unsubscribe;
  };

  // Reuses the same composite index as Supervisor.jsx's roster view
  // (hospitalId, department, date) — no new index needed. Filters down to
  // just this doctor's own shifts client-side, since Firestore can't
  // combine a date-range filter with an equality filter on staffId without
  // yet another index for what's a fairly light read.
  const loadMySchedule = (user) => {
    setScheduleLoading(true);
    const today = new Date().toISOString().slice(0, 10);
    const q = query(
      collection(db, "schedules"),
      where("hospitalId", "==", user.hospitalId),
      where("department", "==", user.department),
      where("date", ">=", today),
      orderBy("date"),
      limit(100)
    );
    getDocs(q)
      .then((snap) => {
        const mine = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((s) => s.staffId === auth.currentUser.uid);
        setMySchedule(mine);
      })
      .catch((e) => console.error("Error loading schedule:", e))
      .finally(() => setScheduleLoading(false));
  };

  const updateStatus = async (ticketId, newStatus, ticket) => {
    try {
      const updates = {
        status: newStatus,
        updatedAt: new Date().toISOString(),
        updatedBy: auth.currentUser.uid,
      };

      if (newStatus === "in-progress" && !ticket?.consultationStartedAt) {
        updates.consultationStartedAt = new Date().toISOString();
        updates.consultationDoctorId = auth.currentUser.uid;
        updates.consultationDoctorName = `Dr. ${userData.firstName} ${userData.lastName}`;
      }

      if (newStatus === "completed") {
        const endedAt = new Date();
        updates.consultationEndedAt = endedAt.toISOString();
        if (ticket?.consultationStartedAt) {
          const startedAt = new Date(ticket.consultationStartedAt);
          updates.consultationDurationSeconds = Math.max(0, Math.round((endedAt - startedAt) / 1000));
        }
      }

      if (newStatus === "no-show") {
        updates.noShowAt = new Date().toISOString();
        updates.noShowBy = auth.currentUser.uid;
        updates.noShowByName = `Dr. ${userData.firstName} ${userData.lastName}`;
      }

      await updateDoc(doc(db, "tickets", ticketId), updates);
    } catch (e) {
      alert("❌ Erreur de mise à jour: " + e.message);
    }
  };

  // Confirmed separately from updateStatus since this pulls a patient out
  // of the active queue entirely — a misclick here isn't as recoverable
  // as accidentally clicking "Commencer". Reception can bring them back
  // via the Missed Queue's "Rappeler" action on their side.
  const markNoShow = (ticket) => {
    if (!window.confirm(`Marquer ${ticket.patientName} (${ticket.ticketNumber}) comme non présenté(e) ?\n\nLe patient sera déplacé vers la file manquée. La réception pourra le rappeler plus tard.`)) return;
    updateStatus(ticket.id, "no-show", ticket);
  };

  const callPatient = async (ticket) => {
    try {
      if (!ticket.ticketNumber || !ticket.patientName) return alert("❌ Données de ticket invalides");

      // Cloud Function: writes the `calls` doc and (if the ticket was
      // "ready") flips it to "in-progress" as one atomic server-side
      // batch, instead of two separate client writes that could partially
      // fail. It also re-checks the nurse-triage gate server-side, not
      // just in this UI.
      const call = httpsCallable(functions, "callNextPatient");
      const result = await call({ ticketId: ticket.id });
      alert(`📢 ${result.data.message}`);
    } catch (e) {
      console.error("❌ Full error:", e);
      alert("❌ Erreur d'appel du patient: " + (e.message || "Une erreur est survenue."));
    }
  };

  const openDiagnosisPanel = async (ticket) => {
    // A diagnosis already recorded is permanently locked — saveDiagnosis
    // rejects any attempt to re-save one (see functions/lib/tickets.js).
    // Every visit is its own ticket with its own fresh diagnosis field, so
    // "editing" an old note isn't a real workflow — just show it read-only,
    // no lock needed since nothing here can be written to.
    if (ticket.diagnosis) {
      setDiagnosisTicketId(ticket.id);
      setDiagnosisForm({ diagnosis: ticket.diagnosis, diagnosisNotes: ticket.diagnosisNotes || "" });
      return;
    }

    setAcquiringLock(ticket.id);
    try {
      // Acquire the exclusive edit lock before showing the form — if
      // another doctor is already mid-edit on this same ticket, this
      // throws and we never open the panel at all, rather than letting
      // two doctors type into the same record at once.
      const call = httpsCallable(functions, "acquirePatientRecordLock");
      await call({ ticketId: ticket.id });
      setDiagnosisTicketId(ticket.id);
      setDiagnosisForm({ diagnosis: "", diagnosisNotes: "" });
    } catch (e) {
      alert("🔒 " + (e.message || "Ce dossier est verrouillé."));
    }
    setAcquiringLock(null);
  };

  const closeDiagnosisPanel = (ticket) => {
    // Only release the lock if we actually acquired one — read-only views
    // (diagnosis already set) never took a lock in the first place.
    if (diagnosisTicketId && !ticket?.diagnosis) {
      httpsCallable(functions, "releasePatientRecordLock")({ ticketId: diagnosisTicketId }).catch(() => {});
    }
    setDiagnosisTicketId(null);
    setDiagnosisForm({ diagnosis: "", diagnosisNotes: "" });
  };

  const saveDiagnosis = async (ticketId) => {
    if (!diagnosisForm.diagnosis.trim()) {
      alert("❌ Veuillez indiquer un diagnostic.");
      return;
    }
    setSavingDiagnosis(true);
    try {
      const call = httpsCallable(functions, "saveDiagnosis");
      await call({ ticketId, diagnosis: diagnosisForm.diagnosis.trim(), diagnosisNotes: diagnosisForm.diagnosisNotes });
      // saveDiagnosis already releases the lock server-side on success, so
      // just reset local state here — no need to also call
      // releasePatientRecordLock (that's only for the Annuler/close path).
      setDiagnosisTicketId(null);
      setDiagnosisForm({ diagnosis: "", diagnosisNotes: "" });
    } catch (e) {
      alert("❌ Erreur lors de l'enregistrement du diagnostic: " + (e.message || "Une erreur est survenue."));
    }
    setSavingDiagnosis(false);
  };

  // Full patient history — the patient record itself plus every past
  // ticket for them, not just the current one. Only works for tickets
  // created after Phase 1 (patient records) shipped — older tickets don't
  // have a patientDocId to look up, so the button is hidden for those.
  const openPatientRecord = async (ticket) => {
    setRecordTicketId(ticket.id);
    setRecordLoading(true);
    setRecordData(null);
    try {
      const patientSnap = await getDoc(doc(db, "patients", ticket.patientDocId));
      const patient = patientSnap.exists() ? { id: patientSnap.id, ...patientSnap.data() } : null;

      const historyQ = query(
        collection(db, "tickets"),
        where("hospitalId", "==", userData.hospitalId),
        where("patientDocId", "==", ticket.patientDocId),
        orderBy("createdAt", "desc"),
        limit(20)
      );
      const historySnap = await getDocs(historyQ);
      const history = historySnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((t) => t.id !== ticket.id); // current visit is already on screen, skip it here

      setRecordData({ patient, history });
    } catch (e) {
      console.error("Error loading patient record:", e);
      alert("❌ Erreur de chargement du dossier: " + (e.message || "Une erreur est survenue."));
      setRecordTicketId(null);
    }
    setRecordLoading(false);
  };

  const closePatientRecord = () => {
    setRecordTicketId(null);
    setRecordData(null);
  };

  const openPrescriptionPanel = async (ticket) => {
    setPrescriptionTicketId(ticket.id);
    setPrescriptionTab("new");
    setChangingPharmacy(true);
    setPrescriptionForm({ pharmacyId: "", patientPhone: "", medications: [{ name: "", medicineId: null, searchText: "", dosage: "", quantity: "", duration: "", instructions: "" }] });
    setPharmacySearch((s) => ({ ...s, loading: true }));
    try {
      let patientVille = "", patientCommune = "", patientQuartier = "", patientPhone = "";
      if (ticket.patientDocId) {
        const patientSnap = await getDoc(doc(db, "patients", ticket.patientDocId));
        if (patientSnap.exists()) {
          patientVille = patientSnap.data().ville || patientSnap.data().city || "";
          patientCommune = patientSnap.data().commune || "";
          patientQuartier = patientSnap.data().quartier || "";
          patientPhone = patientSnap.data().phone || "";
        }
      }
      const [pharmSnap, presSnap, patientPresSnap] = await Promise.all([
        getDocs(query(collection(db, "pharmacies"), where("active", "==", true))),
        // Must filter by hospitalId too, not just ticketId — the
        // prescriptions read rule checks hospitalId, and Firestore
        // rejects the whole query if a filtered field the rule depends on
        // isn't part of the query itself (it can't otherwise prove ahead
        // of time that every possible match would pass the rule).
        ticket.id ? getDocs(query(collection(db, "prescriptions"), where("ticketId", "==", ticket.id), where("hospitalId", "==", userData.hospitalId))) : Promise.resolve({ docs: [] }),
        // All this patient's prescriptions (any visit), so we can pick out
        // their most recent PREVIOUS visit's ordonnance below — same
        // hospitalId-filter requirement as above.
        ticket.patientDocId
          ? getDocs(query(collection(db, "prescriptions"), where("patientDocId", "==", ticket.patientDocId), where("hospitalId", "==", userData.hospitalId), orderBy("createdAt", "desc"), limit(20)))
          : Promise.resolve({ docs: [] }),
      ]);
      // No global medicine catalog fetch here anymore — each pharmacy
      // maintains its own list. That gets loaded by selectPharmacy() once
      // the doctor actually picks one below, not before.
      setMedicineCatalog([]);
      const allPharmacies = pharmSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setPharmacySearch({ patientVille, patientCommune, patientQuartier, allPharmacies, loading: false });
      // Pre-fill the filter from the patient's registered location — the
      // doctor can freely change any of the three if they want a
      // different area (e.g. patient will be near work, not home).
      setPharmacyFilter({ ville: patientVille, commune: patientCommune, quartier: patientQuartier });
      // Pre-fill from the registered number too, but this stays editable
      // — the doctor confirms it with the patient right there, and
      // whatever's typed here is what the pharmacy will actually use to
      // verify the patient, not silently whatever's on file.
      setPrescriptionForm((f) => ({ ...f, patientPhone }));

      // "Last visit" = the most recent ticket (other than this one) that
      // has any prescription at all. Group by that ticket's id so if the
      // doctor sent several ordonnances that day, all of them show
      // together, not just the single most recent document.
      const otherVisits = patientPresSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => p.ticketId !== ticket.id);
      if (otherVisits.length > 0) {
        const mostRecentTicketId = otherVisits[0].ticketId;
        setLastVisitPrescriptions(otherVisits.filter((p) => p.ticketId === mostRecentTicketId));
      } else {
        setLastVisitPrescriptions([]);
      }
      setTicketPrescriptions(presSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error("Error loading prescription data:", e);
      alert("❌ Erreur de chargement: " + (e.message || "Une erreur est survenue."));
      setPharmacySearch((s) => ({ ...s, loading: false }));
    }
  };

  const closePrescriptionPanel = () => {
    setPrescriptionTicketId(null);
    setPrescriptionForm({ pharmacyId: "", patientPhone: "", medications: [{ name: "", medicineId: null, searchText: "", dosage: "", quantity: "", duration: "", instructions: "" }] });
    setPharmacyFilter({ ville: "", commune: "", quartier: "" });
    setTicketPrescriptions([]);
    setLastVisitPrescriptions([]);
    setMedicineCatalog([]);
  };

  // Each pharmacy maintains its own medicine list — picking a pharmacy is
  // what actually determines which medicines the dropdown below can offer.
  // Any medicineId already set on a medication row gets cleared here too:
  // it would otherwise silently keep pointing at an item in the PREVIOUS
  // pharmacy's inventory, not this one — the typed name stays, only the
  // (now-wrong) catalog link is dropped.
  const selectPharmacy = async (pharmacy) => {
    setPrescriptionForm((f) => ({
      ...f,
      pharmacyId: pharmacy.id,
      medications: f.medications.map((m) => ({ ...m, medicineId: null, searchText: "" })),
    }));
    setChangingPharmacy(false);
    setMedicineCatalog([]);
    setMedicineCatalogLoading(true);
    try {
      const snap = await getDocs(query(collection(db, "inventory"), where("facilityId", "==", pharmacy.id)));
      setMedicineCatalog(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error("Error loading pharmacy inventory:", e);
    }
    setMedicineCatalogLoading(false);
  };

  const changePharmacy = () => {
    setPrescriptionForm((f) => ({
      ...f,
      pharmacyId: "",
      medications: f.medications.map((m) => ({ ...m, medicineId: null, searchText: "" })),
    }));
    setChangingPharmacy(true);
    setMedicineCatalog([]);
  };

  const addMedicationRow = () => {
    setPrescriptionForm((f) => ({ ...f, medications: [...f.medications, { name: "", medicineId: null, searchText: "", dosage: "", quantity: "", duration: "", instructions: "" }] }));
  };

  const removeMedicationRow = (i) => {
    setPrescriptionForm((f) => ({ ...f, medications: f.medications.filter((_, idx) => idx !== i) }));
  };

  const updateMedicationRow = (i, field, value) => {
    setPrescriptionForm((f) => ({
      ...f,
      medications: f.medications.map((m, idx) => (idx === i ? { ...m, [field]: value } : m)),
    }));
  };

  // The only way a medication row's name/medicineId ever change now — no
  // free typing of the medicine name itself. Selecting the empty option
  // clears both back out. Dosage auto-fills from the medicine's strength
  // as a starting point — still freely editable afterward (e.g. to add
  // frequency like "1x/jour").
  const selectMedicineFromCatalog = (i, medicineId) => {
    const medicine = medicineCatalog.find((med) => med.id === medicineId);
    setPrescriptionForm((f) => ({
      ...f,
      medications: f.medications.map((m, idx) => (idx === i ? {
        ...m,
        name: medicine ? `${medicine.genericName}${medicine.strength ? " " + medicine.strength : ""}` : "",
        medicineId: medicine ? medicine.id : null,
        searchText: "",
        // Auto-filled from the medicine's own strength (e.g. "500mg") —
        // the only dosage-related fact the inventory actually holds.
        // Still fully editable afterwards for frequency, e.g. "1x/jour".
        dosage: medicine ? (medicine.strength || m.dosage) : m.dosage,
      } : m)),
    }));
    setOpenMedicineDropdown(null);
  };

  const searchMedicineInRow = (i, value) => {
    setPrescriptionForm((f) => ({
      ...f,
      medications: f.medications.map((m, idx) => (idx === i ? { ...m, name: value, medicineId: null } : m)),
    }));
    setOpenMedicineDropdown(i);
  };

  // On leaving the field without picking anything from the list, clear
  // whatever was typed — doctors can search, but the field can never end
  // up holding free text that isn't an actual selection from this
  // pharmacy's stock.
  const blurMedicineRow = (i) => {
    setTimeout(() => {
      setOpenMedicineDropdown((cur) => {
        if (cur !== i) return cur;
        setPrescriptionForm((f) => ({
          ...f,
          medications: f.medications.map((m, idx) => (idx === i && !m.medicineId ? { ...m, name: "" } : m)),
        }));
        return null;
      });
    }, 150);
  };

  const sendPrescription = async () => {
    if (!prescriptionForm.pharmacyId) return alert("❌ Veuillez sélectionner une pharmacie.");
    if (!prescriptionForm.patientPhone.trim()) return alert("❌ Veuillez confirmer le numéro de téléphone du patient — la pharmacie l'utilisera pour vérifier son identité.");
    const validMeds = prescriptionForm.medications.filter((m) => m.name.trim());
    if (validMeds.length === 0) return alert("❌ Veuillez indiquer au moins un médicament.");
    setSendingPrescription(true);
    try {
      const call = httpsCallable(functions, "createPrescription");
      const result = await call({
        ticketId: prescriptionTicketId,
        pharmacyId: prescriptionForm.pharmacyId,
        patientPhone: prescriptionForm.patientPhone.trim(),
        medications: validMeds,
      });
      alert("✅ " + result.data.message);
      closePrescriptionPanel();
    } catch (e) {
      alert("❌ Erreur lors de l'envoi de l'ordonnance: " + (e.message || "Une erreur est survenue."));
    }
    setSendingPrescription(false);
  };

  const logout = async () => {
    if (ticketsUnsubRef.current) {
      ticketsUnsubRef.current();
      ticketsUnsubRef.current = null;
    }

    try {
      const sessionId = sessionStorage.getItem(SESSION_KEY);
      const logoutAt = new Date().toISOString();
      if (sessionId) {
        await updateDoc(doc(db, "doctorSessions", sessionId), { logoutAt });
        sessionStorage.removeItem(SESSION_KEY);
      }
      if (auth.currentUser) {
        await updateDoc(doc(db, "users", auth.currentUser.uid), {
          online: false,
          lastLogoutAt: logoutAt,
        });
      }
    } catch (e) {
      console.warn("Could not record logout:", e);
    }

    await signOut(auth);
    nav("/");
  };

  const [filterPriority, setFilterPriority] = useState("all");

  const getFilteredTickets = () => {
    let filtered = allTickets;
    if (activeTab === "active") filtered = filtered.filter((t) => t.status === "waiting" || t.status === "ready" || t.status === "in-progress");
    else if (activeTab === "completed") filtered = filtered.filter((t) => t.status === "completed");
    else if (activeTab === "noshow") filtered = filtered.filter((t) => t.status === "no-show");

    if (searchTerm) {
      filtered = filtered.filter((t) =>
        t.patientName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.ticketNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.symptoms?.toLowerCase().includes(searchTerm.toLowerCase()));
    }
    if (activeTab === "active" && filterStatus !== "all") filtered = filtered.filter((t) => t.status === filterStatus);
    if (filterPriority !== "all") filtered = filtered.filter((t) => (t.priority || "normal") === filterPriority);
    return filtered;
  };

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
        <div style={{ padding: 32, maxWidth: 480, backgroundColor: COLORS.card, border: `1px solid ${COLORS.line}`, borderTop: `4px solid ${COLORS.red}`, borderRadius: 10, textAlign: "center", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
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

  const filteredTickets = getFilteredTickets();
  const activeCount = allTickets.filter((t) => t.status === "waiting" || t.status === "ready" || t.status === "in-progress").length;
  const completedCount = allTickets.filter((t) => t.status === "completed").length;
  const noShowCount = allTickets.filter((t) => t.status === "no-show").length;

  return (
    <div style={{ minHeight: "100vh", background: COLORS.paper, fontFamily: FONT_BODY }}>
      <div style={{ height: 6, display: "flex" }}>
        <div style={{ flex: 1, background: COLORS.green }} />
        <div style={{ flex: 1, background: COLORS.gold }} />
        <div style={{ flex: 1, background: COLORS.red }} />
      </div>

      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "0 24px" }}>

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
                {hospitalName} <span style={{ color: COLORS.line }}>·</span> {userData.department} <span style={{ color: COLORS.line }}>·</span> Chambre {userData.room}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 13, color: COLORS.slate }}>Connecté en tant que</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.ink }}>Dr. {userData.firstName} {userData.lastName}</div>
            </div>
            <SessionsButton />
            <button onClick={() => setShowChangePassword(true)} style={{
              padding: "10px 16px", backgroundColor: "transparent", color: "#6B4226", border: "1.5px solid #6B4226",
              borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13,
            }}>
              🔑 Mot de passe
            </button>
            <button onClick={logout} style={{
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
          <NotificationsBanner hospitalId={userData?.hospitalId} department={userData?.department} />
        </div>

        <div style={{ display: "flex", gap: 4, marginTop: 24, borderBottom: `2px solid ${COLORS.line}` }}>
          {["active", "noshow", "completed", "schedule"].map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              style={{
                padding: "13px 22px", border: "none", background: "none", cursor: "pointer",
                fontSize: 15, fontWeight: activeTab === tab ? 700 : 500,
                color: activeTab === tab ? COLORS.green : COLORS.slate,
                borderBottom: activeTab === tab ? `3px solid ${COLORS.green}` : "3px solid transparent",
                marginBottom: -2, fontFamily: FONT_BODY, transition: "color 0.15s",
              }}>
              {tab === "active" ? `File d'attente (${activeCount})` : tab === "noshow" ? `Manqués (${noShowCount})` : tab === "completed" ? `Complétés (${completedCount})` : "🗓️ Mon planning"}
            </button>
          ))}
        </div>

        <div style={{ padding: "28px 0 50px 0" }}>

          {activeTab === "schedule" ? (
            <div>
              <h3 style={sectionHeadingStyle}>Mon planning — {userData.department}</h3>
              <p style={{ fontSize: 13, color: COLORS.slate, marginTop: -8, marginBottom: 18 }}>
                Horaires assignés par votre superviseur de département, à partir d'aujourd'hui.
              </p>
              {scheduleLoading ? (
                <p style={{ color: COLORS.slate }}>Chargement…</p>
              ) : mySchedule.length === 0 ? (
                <div style={{ padding: 40, backgroundColor: COLORS.card, borderRadius: 10, textAlign: "center", color: COLORS.slate, border: `1.5px dashed ${COLORS.line}` }}>
                  Aucun horaire à venir. Votre superviseur ne vous a pas encore assigné de créneau.
                </div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {mySchedule.map((s) => (
                    <div key={s.id} style={{ padding: "16px 20px", backgroundColor: COLORS.card, borderRadius: 10, border: `1px solid ${COLORS.line}`, borderLeft: `4px solid ${COLORS.green}` }}>
                      <div style={{ fontWeight: 700, color: COLORS.ink, fontSize: 15 }}>
                        {new Date(s.date + "T00:00:00").toLocaleDateString("fr-FR", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
                      </div>
                      <div style={{ fontSize: 14, color: COLORS.slate, marginTop: 4 }}>
                        ⏰ {s.shiftStart} – {s.shiftEnd}{s.notes ? ` · ${s.notes}` : ""}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
          <>
          <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
            <input
              type="text"
              placeholder="Rechercher par nom, numéro ou symptômes…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ ...fieldStyle, flex: 1, marginBottom: 0 }}
            />
            {activeTab === "active" && (
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{ ...fieldStyle, width: 200, marginBottom: 0 }}>
                <option value="all">Tous les statuts</option>
                <option value="waiting">En attente de triage</option>
                <option value="ready">Prêt pour médecin</option>
                <option value="in-progress">En cours</option>
              </select>
            )}
            <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)} style={{ ...fieldStyle, width: 180, marginBottom: 0 }}>
              <option value="all">Toutes priorités</option>
              {Object.entries(PRIORITY_CONFIG).map(([key, cfg]) => (
                <option key={key} value={key}>{cfg.emoji} {cfg.label}</option>
              ))}
            </select>
          </div>

          <h3 style={sectionHeadingStyle}>
            {activeTab === "active" ? "Patients en attente" : activeTab === "noshow" ? "Patients non présentés" : "Patients complétés"} — {userData.department}
          </h3>

          {loading ? (
            <p style={{ marginTop: 20, color: COLORS.slate }}>Chargement des tickets…</p>
          ) : filteredTickets.length === 0 ? (
            <div style={{
              marginTop: 16, padding: 40, backgroundColor: COLORS.card, borderRadius: 10, textAlign: "center",
              color: COLORS.slate, border: `1.5px dashed ${COLORS.line}`,
            }}>
              <p style={{ fontSize: 16 }}>{activeTab === "active" ? "Aucun patient dans la file d'attente" : activeTab === "noshow" ? "Aucun patient non présenté" : "Aucun patient complété"}</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto", border: `1px solid ${COLORS.line}`, borderRadius: 10 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", backgroundColor: COLORS.card }}>
                <thead>
                  <tr style={{ backgroundColor: COLORS.ink, color: "white" }}>
                    {["Priorité", "Ticket #", "Patient", "Âge", "Sexe", "Symptômes", "Statut", "Chrono", "Créé le", "Actions"].map((h) => (
                      <th key={h} style={{ padding: "14px 16px", textAlign: "left", fontSize: 12.5, letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredTickets.map((t) => {
                    const elapsedSeconds = t.status === "in-progress" && t.consultationStartedAt
                      ? Math.floor((nowTick - new Date(t.consultationStartedAt).getTime()) / 1000)
                      : null;
                    const rowBg = t.status === "waiting" ? "#EDECE7" : t.status === "ready" ? COLORS.warnBg : t.status === "in-progress" ? "#E8F0FB" : t.status === "no-show" ? "#EDECE7" : COLORS.successBg;
                    const p = PRIORITY_CONFIG[t.priority] || PRIORITY_CONFIG.normal;
                    return (
                      <Fragment key={t.id}>
                      <tr style={{ backgroundColor: rowBg, borderBottom: `1px solid ${COLORS.line}`, borderLeft: `5px solid ${p.color}`, opacity: t.status === "waiting" ? 0.7 : 1 }}>
                        <td style={{ padding: "13px 16px" }}>
                          <span style={{
                            padding: "4px 10px", borderRadius: 20, fontSize: 11.5, fontWeight: 700,
                            color: p.color, backgroundColor: p.bg, border: `1.5px solid ${p.color}`,
                            whiteSpace: "nowrap",
                          }}>
                            {p.emoji} {p.label}
                          </span>
                        </td>
                        <td style={{ padding: "13px 16px", fontWeight: 700, color: COLORS.ink }}>{t.ticketNumber || "N/A"}</td>
                        <td style={{ padding: "13px 16px", fontWeight: 700, color: COLORS.ink }}>{t.patientName}</td>
                        <td style={{ padding: "13px 16px" }}>{t.age} ans</td>
                        <td style={{ padding: "13px 16px" }}>{t.sex || "—"}</td>
                        <td style={{ padding: "13px 16px", maxWidth: 220, fontSize: 14, color: COLORS.slate }}>
                          {t.symptoms || "—"}
                          {(t.bpSystolic != null || t.temperature != null || t.pulse != null || t.spo2 != null) && (
                            <div style={{ marginTop: 4, fontSize: 12, color: "#2E5C8C", fontWeight: 600 }}>
                              🩺 {[
                                t.bpSystolic != null && t.bpDiastolic != null ? `${t.bpSystolic}/${t.bpDiastolic} mmHg` : null,
                                t.temperature != null ? `${t.temperature}°C` : null,
                                t.pulse != null ? `${t.pulse} bpm` : null,
                                t.spo2 != null ? `SpO₂ ${t.spo2}%` : null,
                                t.weightKg != null ? `${t.weightKg} kg` : null,
                              ].filter(Boolean).join(" · ")}
                            </div>
                          )}
                          {t.vitalsNotes && (
                            <div style={{ marginTop: 3, fontSize: 12, color: COLORS.slate, fontStyle: "italic" }}>
                              Note infirmier·ère : {t.vitalsNotes}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "13px 16px" }}>
                          {t.status === "waiting" && (
                            <span style={{ padding: "4px 11px", borderRadius: 20, backgroundColor: "#DEDCD5", color: "#4A4438", fontWeight: 700, fontSize: 11.5 }}>🩺 Attente triage</span>
                          )}
                          {t.status === "ready" && (
                            <span style={{ padding: "4px 11px", borderRadius: 20, backgroundColor: "#F1DFA9", color: COLORS.warnText, fontWeight: 700, fontSize: 11.5 }}>Prêt pour médecin</span>
                          )}
                          {t.status === "in-progress" && (
                            <span style={{ padding: "4px 11px", borderRadius: 20, backgroundColor: "#D6E4F7", color: "#2E5C8C", fontWeight: 700, fontSize: 11.5 }}>En cours</span>
                          )}
                          {t.status === "completed" && (
                            <span style={{ padding: "4px 11px", borderRadius: 20, backgroundColor: COLORS.successBg, color: COLORS.successText, fontWeight: 700, fontSize: 11.5 }}>Complété</span>
                          )}
                          {t.status === "no-show" && (
                            <span style={{ padding: "4px 11px", borderRadius: 20, backgroundColor: "#DEDCD5", color: "#4A4438", fontWeight: 700, fontSize: 11.5 }}>❌ Non présenté</span>
                          )}
                        </td>
                        <td style={{ padding: "13px 16px", fontFamily: "monospace", fontSize: 14, fontWeight: 700 }}>
                          {t.status === "in-progress" && elapsedSeconds != null && (
                            <span style={{ color: "#2E5C8C" }}>⏱ {formatDuration(elapsedSeconds)}</span>
                          )}
                          {t.status === "completed" && t.consultationDurationSeconds != null && (
                            <span style={{ color: COLORS.successText }}>{formatDuration(t.consultationDurationSeconds)}</span>
                          )}
                          {(t.status === "waiting" || t.status === "ready" || t.status === "no-show") && <span style={{ color: COLORS.slate }}>—</span>}
                        </td>
                        <td style={{ padding: "13px 16px", fontSize: 12, color: COLORS.slate }}>{new Date(t.createdAt).toLocaleString("fr-FR")}</td>
                        <td style={{ padding: "10px 16px" }}>
                          <div style={{ display: "flex", gap: 6, flexDirection: "column" }}>
                            {t.status === "waiting" && (
                              <span style={{ padding: "8px 0", color: "#6c757d", fontWeight: 600, fontSize: 12.5 }}>
                                En attente de triage infirmier
                              </span>
                            )}
                            {(t.status === "ready" || t.status === "in-progress") && (
                              <button onClick={() => callPatient(t)} style={actionBtnStyle("#2E5C8C")}>Appeler</button>
                            )}
                            {t.status === "ready" && (
                              <button onClick={() => updateStatus(t.id, "in-progress", t)} style={actionBtnStyle("#2E7D8C")}>Commencer</button>
                            )}
                            {t.status === "in-progress" && (
                              <button onClick={() => updateStatus(t.id, "completed", t)} style={actionBtnStyle(COLORS.green)}>Terminer</button>
                            )}
                            {(t.status === "in-progress" || t.status === "completed") && (() => {
                              const lockedByOther = isLockActive(t, nowTick) && t.lockedBy !== auth.currentUser?.uid;
                              if (lockedByOther) {
                                return (
                                  <button disabled style={{ ...actionBtnStyle("#6c757d"), cursor: "not-allowed", opacity: 0.75 }}>
                                    🔒 {t.lockedByName || "Verrouillé"}
                                  </button>
                                );
                              }
                              return (
                                <button
                                  onClick={() => (diagnosisTicketId === t.id ? closeDiagnosisPanel(t) : openDiagnosisPanel(t))}
                                  disabled={acquiringLock === t.id}
                                  style={{ ...actionBtnStyle(t.diagnosis ? "#2E5C8C" : "#8A5A00"), opacity: acquiringLock === t.id ? 0.6 : 1 }}
                                >
                                  {acquiringLock === t.id ? "Verrouillage…" : t.diagnosis ? "Diagnostic ✓" : "Diagnostic"}
                                </button>
                              );
                            })()}
                            {t.patientDocId && (
                              <button onClick={() => (recordTicketId === t.id ? closePatientRecord() : openPatientRecord(t))} style={actionBtnStyle("#5B6B63")}>
                                📋 Dossier
                              </button>
                            )}
                            {(t.status === "in-progress" || t.status === "completed") && (
                              <button onClick={() => openPrescriptionPanel(t)} style={actionBtnStyle("#0F7A6E")}>
                                💊 Ordonnance
                              </button>
                            )}
                            {(t.status === "ready" || t.status === "in-progress") && (
                              <button onClick={() => markNoShow(t)} style={actionBtnStyle("#6c757d")}>Non présenté</button>
                            )}
                            {t.status === "completed" && <span style={{ padding: "8px 0", color: COLORS.successText, fontWeight: 700, fontSize: 13.5 }}>Terminé ✓</span>}
                            {t.status === "no-show" && (
                              <span style={{ padding: "8px 0", color: "#6c757d", fontWeight: 600, fontSize: 12.5 }}>
                                Non présenté le {t.noShowAt ? new Date(t.noShowAt).toLocaleTimeString("fr-FR") : ""} — en attente de rappel par l'accueil
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                      {diagnosisTicketId === t.id && null /* rendered as a modal below instead — see end of component */}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          </>
          )}
        </div>

        <div style={{ borderTop: `1px solid ${COLORS.line}`, padding: "18px 0", textAlign: "center", fontSize: 12.5, color: COLORS.slate }}>
          République du Mali — Ministère de la Santé · Système de gestion hospitalière
        </div>
      </div>

      {diagnosisTicketId && (() => {
        const t = allTickets.find((x) => x.id === diagnosisTicketId);
        if (!t) return null;
        return (
          <div
            onClick={() => closeDiagnosisPanel(t)}
            style={{
              position: "fixed", inset: 0, backgroundColor: "rgba(27,42,31,0.55)",
              display: "flex", alignItems: "center", justifyContent: "center",
              padding: 24, zIndex: 1000,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                backgroundColor: "#fff", borderRadius: 14, width: "min(600px, 100%)",
                maxHeight: "88vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
                borderTop: `6px solid ${t.diagnosis ? "#2E5C8C" : COLORS.gold}`,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "22px 28px 18px", borderBottom: `1px solid ${COLORS.line}` }}>
                <h2 style={{ margin: 0, fontFamily: FONT_DISPLAY, fontSize: 22, color: COLORS.ink }}>Diagnostic</h2>
                <button
                  onClick={() => closeDiagnosisPanel(t)}
                  aria-label="Fermer"
                  style={{
                    width: 36, height: 36, borderRadius: "50%", border: "none", backgroundColor: COLORS.paper,
                    color: COLORS.ink, fontSize: 18, fontWeight: 700, cursor: "pointer", lineHeight: 1,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  ✕
                </button>
              </div>

              <div style={{ padding: "24px 28px 30px" }}>
                <div style={{ marginBottom: 18, fontSize: 14, color: COLORS.slate }}>
                  {t.patientName} — {t.ticketNumber}
                </div>

                {t.diagnosis ? (
                  <div style={{ padding: 18, backgroundColor: COLORS.paper, borderRadius: 10, border: `1px solid ${COLORS.line}` }}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: COLORS.slate, textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 6 }}>
                      Diagnostic — visite du {t.createdAt ? new Date(t.createdAt).toLocaleDateString("fr-FR") : ""}
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: COLORS.ink }}>{t.diagnosis}</div>
                    {t.diagnosisNotes && <div style={{ fontSize: 14.5, color: COLORS.slate, marginTop: 8 }}>{t.diagnosisNotes}</div>}
                    <div style={{ fontSize: 12, color: COLORS.slate, marginTop: 14, fontStyle: "italic" }}>
                      🔒 Enregistré définitivement le {t.diagnosisSavedAt ? new Date(t.diagnosisSavedAt).toLocaleString("fr-FR") : ""} par {t.diagnosisSavedByName} —
                      non modifiable. Une nouvelle visite (nouveau ticket) permettra d'ajouter une nouvelle note.
                    </div>
                  </div>
                ) : (
                  <>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: COLORS.slate, marginBottom: 6 }}>Diagnostic</label>
                    <input
                      value={diagnosisForm.diagnosis}
                      onChange={(e) => setDiagnosisForm((f) => ({ ...f, diagnosis: e.target.value }))}
                      placeholder="ex: Paludisme, Hypertension…"
                      style={{ width: "100%", padding: "12px 14px", borderRadius: 8, border: `1px solid ${COLORS.line}`, fontSize: 15, boxSizing: "border-box", marginBottom: 16 }}
                    />
                    <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: COLORS.slate, marginBottom: 6 }}>Notes (optionnel)</label>
                    <textarea
                      value={diagnosisForm.diagnosisNotes}
                      onChange={(e) => setDiagnosisForm((f) => ({ ...f, diagnosisNotes: e.target.value }))}
                      placeholder="Traitement prescrit, recommandations…"
                      rows={4}
                      style={{ width: "100%", padding: "12px 14px", borderRadius: 8, border: `1px solid ${COLORS.line}`, fontSize: 15, boxSizing: "border-box", marginBottom: 8, fontFamily: FONT_BODY, resize: "vertical" }}
                    />
                    <div style={{ fontSize: 12, color: COLORS.slate, fontStyle: "italic", marginBottom: 18 }}>
                      ⚠️ Une fois enregistré, ce diagnostic ne pourra plus être modifié ni supprimé.
                    </div>
                    <div style={{ display: "flex", gap: 10 }}>
                      <button onClick={() => saveDiagnosis(t.id)} disabled={savingDiagnosis} style={{
                        flex: 1, padding: 13, backgroundColor: COLORS.green, color: "white", border: "none",
                        borderRadius: 8, cursor: savingDiagnosis ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 15,
                        opacity: savingDiagnosis ? 0.7 : 1,
                      }}>
                        {savingDiagnosis ? "Enregistrement…" : "Enregistrer (définitif)"}
                      </button>
                      <button onClick={() => closeDiagnosisPanel(t)} style={{ padding: "13px 20px", backgroundColor: COLORS.paper, color: COLORS.ink, border: `1px solid ${COLORS.line}`, borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 15 }}>
                        Annuler
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {recordTicketId && (
        <div
          onClick={closePatientRecord}
          style={{
            position: "fixed", inset: 0, backgroundColor: "rgba(27,42,31,0.55)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 24, zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: "#fff", borderRadius: 14, width: "min(760px, 100%)",
              maxHeight: "88vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
              borderTop: `6px solid ${COLORS.gold}`,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "22px 28px 18px", borderBottom: `1px solid ${COLORS.line}` }}>
              <h2 style={{ margin: 0, fontFamily: FONT_DISPLAY, fontSize: 22, color: COLORS.ink }}>Dossier patient</h2>
              <button
                onClick={closePatientRecord}
                aria-label="Fermer"
                style={{
                  width: 36, height: 36, borderRadius: "50%", border: "none", backgroundColor: COLORS.paper,
                  color: COLORS.ink, fontSize: 18, fontWeight: 700, cursor: "pointer", lineHeight: 1,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: "24px 28px 30px" }}>
              {recordLoading ? (
                <p style={{ color: COLORS.slate, fontSize: 14.5 }}>Chargement du dossier…</p>
              ) : recordData ? (
                <>
                  {recordData.patient && (
                    <div style={{
                      marginBottom: 22, padding: 18, backgroundColor: COLORS.paper, borderRadius: 10,
                      display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, fontSize: 14,
                    }}>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.slate, textTransform: "uppercase", letterSpacing: "0.03em" }}>Patient</div>
                        <div style={{ fontWeight: 700, color: COLORS.ink, marginTop: 3, fontSize: 16 }}>{recordData.patient.firstName} {recordData.patient.lastName}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.slate, textTransform: "uppercase", letterSpacing: "0.03em" }}>ID Patient</div>
                        <div style={{ marginTop: 3 }}>{recordData.patient.patientId}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.slate, textTransform: "uppercase", letterSpacing: "0.03em" }}>Téléphone</div>
                        <div style={{ marginTop: 3 }}>{recordData.patient.phone || "—"}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.slate, textTransform: "uppercase", letterSpacing: "0.03em" }}>Groupe sanguin</div>
                        <div style={{ marginTop: 3 }}>{recordData.patient.bloodType || "—"}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.slate, textTransform: "uppercase", letterSpacing: "0.03em" }}>Allergies</div>
                        <div style={{ marginTop: 3, color: recordData.patient.allergies ? COLORS.dangerText : "inherit", fontWeight: recordData.patient.allergies ? 700 : 400 }}>
                          {recordData.patient.allergies || "Aucune connue"}
                        </div>
                      </div>
                      {(recordData.patient.commune || recordData.patient.quartier) && (
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.slate, textTransform: "uppercase", letterSpacing: "0.03em" }}>Localité</div>
                          <div style={{ marginTop: 3 }}>{[recordData.patient.commune, recordData.patient.quartier].filter(Boolean).join(", ")}</div>
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.slate, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    Visites précédentes ({recordData.history.length})
                  </div>
                  {recordData.history.length === 0 ? (
                    <p style={{ margin: 0, fontSize: 14, color: COLORS.slate }}>Aucune visite précédente enregistrée.</p>
                  ) : (
                    <div style={{ display: "grid", gap: 10 }}>
                      {recordData.history.map((h) => (
                        <div key={h.id} style={{ padding: "14px 16px", backgroundColor: COLORS.paper, borderRadius: 10, border: `1px solid ${COLORS.line}`, fontSize: 14 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                            <strong style={{ color: COLORS.ink }}>{new Date(h.createdAt).toLocaleDateString("fr-FR", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} — {h.department}</strong>
                            <span style={{ color: COLORS.slate, fontSize: 13 }}>{h.ticketNumber}</span>
                          </div>
                          {h.diagnosis ? (
                            <div style={{ marginTop: 8, padding: "10px 12px", backgroundColor: "#fff", borderRadius: 6, borderLeft: "3px solid #2E5C8C" }}>
                              <div style={{ fontWeight: 700, color: "#2E5C8C" }}>🩺 {h.diagnosis}</div>
                              {h.diagnosisNotes && <div style={{ color: COLORS.slate, marginTop: 3, fontSize: 13.5 }}>{h.diagnosisNotes}</div>}
                            </div>
                          ) : (
                            <div style={{ marginTop: 6, color: COLORS.slate, fontSize: 13, fontStyle: "italic" }}>Aucun diagnostic enregistré pour cette visite.</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {prescriptionTicketId && (
        <div
          onClick={closePrescriptionPanel}
          style={{ position: "fixed", inset: 0, backgroundColor: "rgba(27,42,31,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 1000 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ backgroundColor: "#fff", borderRadius: 14, width: "min(960px, 95vw)", maxHeight: "92vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.35)", borderTop: "6px solid #0F7A6E" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "22px 28px 18px", borderBottom: `1px solid ${COLORS.line}` }}>
              <h2 style={{ margin: 0, fontFamily: FONT_DISPLAY, fontSize: 22, color: COLORS.ink }}>💊 Ordonnance</h2>
              <button onClick={closePrescriptionPanel} aria-label="Fermer" style={{ width: 36, height: 36, borderRadius: "50%", border: "none", backgroundColor: COLORS.paper, color: COLORS.ink, fontSize: 18, fontWeight: 700, cursor: "pointer" }}>✕</button>
            </div>

            <div style={{ display: "flex", gap: 4, padding: "0 28px", borderBottom: `1px solid ${COLORS.line}` }}>
              {["last", "new"].map((tab) => (
                <button key={tab} onClick={() => setPrescriptionTab(tab)}
                  style={{
                    padding: "12px 18px", border: "none", background: "none", cursor: "pointer",
                    fontSize: 14, fontWeight: prescriptionTab === tab ? 700 : 500,
                    color: prescriptionTab === tab ? "#0F7A6E" : COLORS.slate,
                    borderBottom: prescriptionTab === tab ? "3px solid #0F7A6E" : "3px solid transparent",
                    marginBottom: -1,
                  }}>
                  {tab === "last" ? "Dernière visite" : "Nouvelle ordonnance"}
                </button>
              ))}
            </div>

            <div style={{ padding: "24px 28px 30px" }}>
              {prescriptionTab === "last" && (
                <div>
                  {ticketPrescriptions.length > 0 && (
                    <div style={{ marginBottom: 22 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.slate, textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 8 }}>
                        Déjà envoyées pour cette visite
                      </div>
                      <div style={{ display: "grid", gap: 8 }}>
                        {ticketPrescriptions.map((p) => (
                          <div key={p.id} style={{ padding: "10px 14px", backgroundColor: COLORS.paper, borderRadius: 8, border: `1px solid ${COLORS.line}`, fontSize: 13 }}>
                            <strong>{p.pharmacyName}</strong> — {p.medications.map((m) => m.name).join(", ")}
                            <span style={{ marginLeft: 8, color: COLORS.slate }}>
                              ({p.status === "pending" ? "en attente" : p.status === "preparing" ? "en préparation" : p.status === "ready" ? "prête" : "remise au patient"})
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {lastVisitPrescriptions.length === 0 ? (
                    <p style={{ color: COLORS.slate, fontSize: 14 }}>Aucune ordonnance lors d'une visite précédente.</p>
                  ) : (
                    <>
                      <p style={{ fontSize: 13, color: COLORS.slate, marginTop: 0, marginBottom: 14 }}>
                        Prescrit le {lastVisitPrescriptions[0].createdAt ? new Date(lastVisitPrescriptions[0].createdAt).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : ""} par {lastVisitPrescriptions[0].doctorName}
                        {lastVisitPrescriptions[0].diagnosis && ` — 🩺 ${lastVisitPrescriptions[0].diagnosis}`}
                      </p>
                      <div style={{ display: "grid", gap: 10 }}>
                        {lastVisitPrescriptions.map((p) => (
                          <div key={p.id} style={{ padding: 16, backgroundColor: COLORS.paper, borderRadius: 10, border: `1px solid ${COLORS.line}` }}>
                            <div style={{ fontWeight: 700, color: COLORS.ink, fontSize: 14, marginBottom: 8 }}>💊 {p.pharmacyName}</div>
                            <div style={{ display: "grid", gap: 6 }}>
                              {p.medications.map((m, i) => (
                                <div key={i} style={{ padding: "8px 12px", backgroundColor: "#fff", borderRadius: 6, fontSize: 13.5, border: `1px solid ${COLORS.line}` }}>
                                  <strong>{m.name}</strong>{m.dosage ? ` — ${m.dosage}` : ""}{m.quantity ? ` · Qté: ${m.quantity}` : ""}{m.duration ? ` · ${m.duration}` : ""}
                                  {m.instructions && <div style={{ color: COLORS.slate, fontSize: 12.5, marginTop: 2 }}>{m.instructions}</div>}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {prescriptionTab === "new" && (
                <>
              {pharmacySearch.loading ? (
                <p style={{ color: COLORS.slate }}>Chargement des pharmacies…</p>
              ) : prescriptionForm.pharmacyId ? (
                (() => {
                  const selected = pharmacySearch.allPharmacies.find((p) => p.id === prescriptionForm.pharmacyId);
                  return (
                    <div style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10,
                      padding: "12px 16px", marginBottom: 18, backgroundColor: "#E3F7F5", border: "1.5px solid #0F7A6E", borderRadius: 8,
                    }}>
                      <div>
                        <div style={{ fontWeight: 700, color: COLORS.ink, fontSize: 14 }}>💊 {selected?.name || "Pharmacie sélectionnée"}</div>
                        {selected && (
                          <div style={{ fontSize: 12, color: COLORS.slate, marginTop: 2 }}>
                            {[selected.commune, selected.quartier, selected.ville].filter(Boolean).join(", ")}
                          </div>
                        )}
                      </div>
                      <button type="button" onClick={changePharmacy} style={{ background: "none", border: "none", color: "#0F7A6E", fontWeight: 700, fontSize: 12.5, cursor: "pointer", textDecoration: "underline", padding: 0 }}>
                        Changer
                      </button>
                    </div>
                  );
                })()
              ) : (
                <>
                  {(pharmacySearch.patientVille || pharmacySearch.patientCommune) && (
                    <p style={{ fontSize: 13, color: COLORS.slate, marginTop: 0, marginBottom: 14 }}>
                      Localité du patient : {[pharmacySearch.patientCommune, pharmacySearch.patientQuartier, pharmacySearch.patientVille].filter(Boolean).join(", ")} — filtres pré-remplis en conséquence, modifiables librement.
                    </p>
                  )}

                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: COLORS.slate, marginBottom: 8 }}>Filtrer les pharmacies par localisation</label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
                    <select
                      value={pharmacyFilter.ville}
                      onChange={(e) => setPharmacyFilter({ ville: e.target.value, commune: "", quartier: "" })}
                      style={{ padding: "10px 12px", borderRadius: 8, border: `1px solid ${COLORS.line}`, fontSize: 13.5, boxSizing: "border-box" }}
                    >
                      <option value="">Sélectionner une ville…</option>
                      {Object.keys(VILLES).sort().map((v) => (<option key={v}>{v}</option>))}
                    </select>
                    {pharmacyFilter.ville && Object.keys(VILLES[pharmacyFilter.ville] || {}).length > 0 ? (
                      <select
                        value={pharmacyFilter.commune}
                        onChange={(e) => setPharmacyFilter({ ...pharmacyFilter, commune: e.target.value, quartier: "" })}
                        style={{ padding: "10px 12px", borderRadius: 8, border: `1px solid ${COLORS.line}`, fontSize: 13.5, boxSizing: "border-box" }}
                      >
                        <option value="">Toutes les communes</option>
                        {Object.keys(VILLES[pharmacyFilter.ville]).map((c) => (<option key={c}>{c}</option>))}
                      </select>
                    ) : (
                      <input
                        placeholder={pharmacyFilter.ville ? "Commune (texte libre)" : "Choisir une ville d'abord"}
                        value={pharmacyFilter.commune}
                        onChange={(e) => setPharmacyFilter({ ...pharmacyFilter, commune: e.target.value })}
                        disabled={!pharmacyFilter.ville}
                        style={{ padding: "10px 12px", borderRadius: 8, border: `1px solid ${COLORS.line}`, fontSize: 13.5, boxSizing: "border-box" }}
                      />
                    )}
                    {pharmacyFilter.ville && pharmacyFilter.commune && (VILLES[pharmacyFilter.ville]?.[pharmacyFilter.commune]?.length > 0) ? (
                      <select
                        value={pharmacyFilter.quartier}
                        onChange={(e) => setPharmacyFilter({ ...pharmacyFilter, quartier: e.target.value })}
                        style={{ padding: "10px 12px", borderRadius: 8, border: `1px solid ${COLORS.line}`, fontSize: 13.5, boxSizing: "border-box" }}
                      >
                        <option value="">Tous les quartiers</option>
                        {VILLES[pharmacyFilter.ville][pharmacyFilter.commune].map((q) => (<option key={q}>{q}</option>))}
                      </select>
                    ) : (
                      <input
                        placeholder={pharmacyFilter.commune ? "Quartier (texte libre)" : "Choisir une commune d'abord"}
                        value={pharmacyFilter.quartier}
                        onChange={(e) => setPharmacyFilter({ ...pharmacyFilter, quartier: e.target.value })}
                        disabled={!pharmacyFilter.commune}
                        style={{ padding: "10px 12px", borderRadius: 8, border: `1px solid ${COLORS.line}`, fontSize: 13.5, boxSizing: "border-box" }}
                      />
                    )}
                  </div>

                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: COLORS.slate, marginBottom: 8 }}>Pharmacie</label>
                  {!pharmacyFilter.ville ? (
                    <div style={{ padding: 14, backgroundColor: COLORS.paper, borderRadius: 8, color: COLORS.slate, fontSize: 13.5, marginBottom: 18 }}>
                      Sélectionnez une ville ci-dessus pour voir les pharmacies disponibles.
                    </div>
                  ) : (() => {
                    const filteredPharmacies = pharmacySearch.allPharmacies.filter((p) =>
                      p.ville === pharmacyFilter.ville &&
                      (!pharmacyFilter.commune || p.commune === pharmacyFilter.commune) &&
                      (!pharmacyFilter.quartier || p.quartier === pharmacyFilter.quartier)
                    );
                    if (filteredPharmacies.length === 0) {
                      return (
                        <div style={{ padding: 14, backgroundColor: COLORS.paper, borderRadius: 8, color: COLORS.slate, fontSize: 13.5, marginBottom: 18 }}>
                          Aucune pharmacie ne correspond à ce filtre. Élargissez la recherche (ville seule).
                        </div>
                      );
                    }
                    return (
                      <div style={{ display: "grid", gap: 8, marginBottom: 20, maxHeight: 220, overflowY: "auto" }}>
                        {filteredPharmacies.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => selectPharmacy(p)}
                            style={{
                              textAlign: "left", padding: "10px 14px", borderRadius: 8, cursor: "pointer",
                              border: `1.5px solid ${COLORS.line}`, backgroundColor: "#fff",
                            }}
                          >
                            <div style={{ fontWeight: 700, color: COLORS.ink, fontSize: 14 }}>{p.name}</div>
                            <div style={{ fontSize: 12, color: COLORS.slate, marginTop: 2 }}>
                              {[p.commune, p.quartier, p.ville].filter(Boolean).join(", ")}{p.phone ? ` · ${p.phone}` : ""}
                            </div>
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                </>
              )}

              <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: COLORS.slate, marginBottom: 8, marginTop: 4 }}>
                    Téléphone du patient (vérification à la pharmacie)
                  </label>
                  <input
                    type="tel"
                    placeholder="ex: 76 12 34 56"
                    value={prescriptionForm.patientPhone}
                    onChange={(e) => setPrescriptionForm((f) => ({ ...f, patientPhone: e.target.value }))}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${COLORS.line}`, fontSize: 14, boxSizing: "border-box", marginBottom: 6 }}
                  />
                  <p style={{ fontSize: 11.5, color: COLORS.slate, marginTop: 0, marginBottom: 18, fontStyle: "italic" }}>
                    Confirmez ce numéro avec le patient — c'est ce que la pharmacie lui demandera pour retrouver son ordonnance.
                  </p>

                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: COLORS.slate, marginBottom: 8 }}>
                    Médicaments
                    {!prescriptionForm.pharmacyId && (
                      <span style={{ fontWeight: 400, color: COLORS.slate, fontStyle: "italic" }}> — choisissez d'abord une pharmacie ci-dessus</span>
                    )}
                    {medicineCatalogLoading && <span style={{ fontWeight: 400, color: COLORS.slate }}> — chargement du stock…</span>}
                  </label>
                  <div style={{ display: "grid", gap: 10, marginBottom: 12 }}>
                    {prescriptionForm.medications.map((m, i) => {
                      const isOpen = openMedicineDropdown === i;
                      const term = (m.searchText || "").trim().toLowerCase();
                      const matches = isOpen
                        ? medicineCatalog.filter((med) =>
                            !term
                              || med.genericName.toLowerCase().includes(term)
                              || (med.brandNames || []).some((b) => b.toLowerCase().includes(term))
                          ).slice(0, 8)
                        : [];
                      const disabled = !prescriptionForm.pharmacyId || medicineCatalogLoading;
                      return (
                        <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                          <div style={{ position: "relative", flex: "1.3 1 0" }}>
                            <input
                              value={isOpen ? m.searchText : m.name}
                              placeholder={
                                disabled
                                  ? (!prescriptionForm.pharmacyId ? "Choisissez une pharmacie d'abord" : "Chargement…")
                                  : "Rechercher un médicament…"
                              }
                              disabled={disabled}
                              onFocus={() => { setOpenMedicineDropdown(i); updateMedicationRow(i, "searchText", ""); }}
                              onChange={(e) => updateMedicationRow(i, "searchText", e.target.value)}
                              onBlur={() => setTimeout(() => setOpenMedicineDropdown((cur) => (cur === i ? null : cur)), 150)}
                              style={{
                                width: "100%", padding: "9px 12px", borderRadius: 6, boxSizing: "border-box", fontSize: 13.5,
                                border: `1px solid ${m.medicineId ? "#0F7A6E" : COLORS.line}`,
                                backgroundColor: disabled ? "#F6F5F1" : "#fff",
                                cursor: disabled ? "not-allowed" : "text",
                              }}
                            />
                            {m.medicineId && !isOpen && (
                              <span style={{ position: "absolute", right: 10, top: 10, fontSize: 12, color: "#0F7A6E" }} title="Sélectionné">✓</span>
                            )}
                            {isOpen && (
                              <div style={{
                                position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, zIndex: 20,
                                backgroundColor: "#fff", border: `1px solid ${COLORS.line}`, borderRadius: 8,
                                boxShadow: "0 8px 24px rgba(0,0,0,0.15)", maxHeight: 220, overflowY: "auto",
                              }}>
                                {matches.length === 0 ? (
                                  <div style={{ padding: "10px 12px", fontSize: 13, color: COLORS.slate }}>
                                    {medicineCatalog.length === 0 ? "Aucun médicament en stock dans cette pharmacie." : "Aucun résultat."}
                                  </div>
                                ) : matches.map((med) => {
                                  const low = (med.quantityAvailable || 0) <= (med.minimumStockLevel || 0);
                                  return (
                                    <button
                                      key={med.id}
                                      type="button"
                                      onMouseDown={(e) => { e.preventDefault(); selectMedicineFromCatalog(i, med.id); }}
                                      style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 12px", border: "none", borderBottom: `1px solid ${COLORS.line}`, backgroundColor: "#fff", cursor: "pointer", fontSize: 13 }}
                                    >
                                      <div style={{ fontWeight: 700, color: COLORS.ink }}>{med.genericName} {med.strength}</div>
                                      <div style={{ fontSize: 11.5, color: COLORS.slate }}>
                                        {med.brandNames?.length > 0 ? med.brandNames.join(", ") + " · " : ""}{med.dosageForm}
                                        {" · "}
                                        <span style={{ color: low ? "#8A5A00" : COLORS.slate, fontWeight: low ? 700 : 400 }}>
                                          en stock: {med.quantityAvailable ?? "—"}{low ? " (stock bas)" : ""}
                                        </span>
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                          <input placeholder="Dosage" value={m.dosage} onChange={(e) => updateMedicationRow(i, "dosage", e.target.value)} style={{ flex: "1 1 0", padding: "9px 12px", borderRadius: 6, border: `1px solid ${COLORS.line}`, fontSize: 13.5, boxSizing: "border-box" }} />
                          <input placeholder="Quantité" value={m.quantity} onChange={(e) => updateMedicationRow(i, "quantity", e.target.value)} style={{ flex: "0.7 1 0", padding: "9px 12px", borderRadius: 6, border: `1px solid ${COLORS.line}`, fontSize: 13.5, boxSizing: "border-box" }} />
                          <input placeholder="Durée (ex: 5 jours)" value={m.duration} onChange={(e) => updateMedicationRow(i, "duration", e.target.value)} style={{ flex: "0.9 1 0", padding: "9px 12px", borderRadius: 6, border: `1px solid ${COLORS.line}`, fontSize: 13.5, boxSizing: "border-box" }} />
                          <textarea
                            placeholder="Instructions"
                            value={m.instructions}
                            onChange={(e) => updateMedicationRow(i, "instructions", e.target.value)}
                            rows={1}
                            style={{ flex: "1.5 1 0", padding: "9px 12px", borderRadius: 6, border: `1px solid ${COLORS.line}`, fontSize: 13.5, boxSizing: "border-box", resize: "vertical", fontFamily: FONT_BODY, minHeight: 38 }}
                          />
                          {prescriptionForm.medications.length > 1 && (
                            <button onClick={() => removeMedicationRow(i)} style={{ padding: "9px 12px", backgroundColor: COLORS.red, color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>✕</button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <button onClick={addMedicationRow} style={{ background: "none", border: "none", color: "#0F7A6E", fontWeight: 700, fontSize: 13, cursor: "pointer", padding: 0, marginBottom: 22 }}>
                    + Ajouter un médicament
                  </button>

                  <button onClick={sendPrescription} disabled={sendingPrescription} style={{
                    width: "100%", padding: 14, backgroundColor: "#0F7A6E", color: "white", border: "none",
                    borderRadius: 8, cursor: sendingPrescription ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 15,
                    opacity: sendingPrescription ? 0.7 : 1,
                  }}>
                    {sendingPrescription ? "Envoi en cours…" : "💊 Envoyer à la pharmacie"}
                  </button>
                </>
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

const sectionHeadingStyle = {
  color: COLORS.ink,
  fontFamily: FONT_DISPLAY,
  fontSize: 17,
  marginBottom: 14,
  borderLeft: `4px solid ${COLORS.gold}`,
  paddingLeft: 10,
};

const actionBtnStyle = (color) => ({
  padding: "9px 14px",
  backgroundColor: color,
  color: "white",
  border: "none",
  borderRadius: 5,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 700,
});