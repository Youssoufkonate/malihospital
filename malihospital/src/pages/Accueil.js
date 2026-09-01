import { useState, useEffect, useRef } from "react";
import ChangePassword from "./ChangePassword";
import SessionsButton from "../components/SessionsButton";
import { auth, db, functions } from "../firebase";
import { collection, addDoc, getDocs, query, where, orderBy, limit, onSnapshot, getDoc, doc, updateDoc, runTransaction } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { VILLES } from "../constants/villes";

// How often to restart the "last 24h" ticket listener so its cutoff
// actually advances. Firestore only re-evaluates a query's where() bound
// when something changes (a matching write happens) — it does NOT re-check
// "is this doc still >= 24h ago" on its own as the clock ticks forward. So
// on a quiet reception desk, a ticket that just crossed the 24h mark would
// otherwise sit there forever instead of dropping off. Restarting the
// listener periodically with a freshly-computed cutoff fixes that.
const TICKET_WINDOW_REFRESH_MS = 5 * 60 * 1000; // 5 minutes

/* ------------------------------------------------------------------ */
/*  Design tokens — matches the institutional palette already used     */
/*  across Login / Doctor / AdminPanel / SuperAdmin / WaitingRoom, so   */
/*  this screen belongs to the same product instead of looking bolted  */
/*  on. Priority colors are aligned to the exact tokens Doctor.jsx /    */
/*  Nurse.jsx already use, so a "red" badge is the same red everywhere. */
/* ------------------------------------------------------------------ */
const COLORS = {
  green: "#14B53A",
  gold: "#FCD116",
  red: "#CE1126",
  ink: "#1B2A1F",
  inkDeep: "#141F17",
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

// Ville → Commune → Quartier lookup for the patient registration form.
const FONT_BODY = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

function calcAge(dob) {
  if (!dob) return null;
  const birth = new Date(dob);
  if (isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

// Triage priority the receptionist assigns at intake. "rank" controls queue
// order on the doctor's dashboard — lower rank = seen sooner, regardless of
// arrival time. Within the same rank, patients are still seen oldest-first.
const PRIORITY_CONFIG = {
  emergency: { label: "Urgence", emoji: "🔴", rank: 0, color: COLORS.dangerText, bg: COLORS.dangerBg, ring: "rgba(163,18,33,0.25)" },
  urgent:    { label: "Urgent",  emoji: "🟠", rank: 1, color: COLORS.warnText, bg: COLORS.warnBg, ring: "rgba(138,90,0,0.22)" },
  normal:    { label: "Normal",  emoji: "🟢", rank: 2, color: COLORS.successText, bg: COLORS.successBg, ring: "rgba(30,123,52,0.2)" },
};

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

function BogolanPattern({ id, opacity = 1, colorA = COLORS.gold, colorB = COLORS.red }) {
  return (
    <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, opacity, pointerEvents: "none" }} preserveAspectRatio="none">
      <defs>
        <pattern id={id} width="52" height="52" patternUnits="userSpaceOnUse">
          <rect width="52" height="52" fill="transparent" />
          <path d="M26 3 L49 26 L26 49 L3 26 Z" fill="none" stroke={colorA} strokeWidth="1.1" opacity="0.55" />
          <circle cx="26" cy="26" r="2.6" fill={colorB} opacity="0.4" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

function GlobalStyle() {
  return (
    <style>{`
      .ac-page { min-height: 100vh; background: ${COLORS.paper}; font-family: ${FONT_BODY}; }
      .ac-grid {
        display: grid;
        grid-template-columns: minmax(340px, 400px) 1fr;
        gap: 28px;
        align-items: start;
      }
      @media (max-width: 900px) {
        .ac-grid { grid-template-columns: 1fr; }
      }

      /* ---- The ticket stub (signature element) ---- */
      .ac-stub {
        background: ${COLORS.card};
        border-radius: 20px;
        box-shadow: 0 26px 60px rgba(27,42,31,0.14), 0 1px 0 rgba(255,255,255,0.6) inset;
        position: sticky;
        top: 24px;
      }
      .ac-stub-counterfoil {
        background: linear-gradient(135deg, ${COLORS.ink} 0%, ${COLORS.inkDeep} 100%);
        border-radius: 20px 20px 0 0;
        padding: 24px 28px 30px;
        position: relative;
        overflow: hidden;
      }
      .ac-perforation { position: relative; height: 0; }
      .ac-perforation::before, .ac-perforation::after {
        content: "";
        position: absolute;
        top: -12px;
        width: 24px; height: 24px;
        border-radius: 50%;
        background: ${COLORS.paper};
      }
      .ac-perforation::before { left: -12px; }
      .ac-perforation::after { right: -12px; }
      .ac-perforation-line {
        position: absolute;
        left: 14px; right: 14px; top: -1px;
        border-top: 2px dashed rgba(27,42,31,0.22);
      }
      .ac-stub-body { padding: 30px 28px 30px; }

      .ac-input, .ac-select {
        width: 100%;
        padding: 12px 14px;
        margin-bottom: 13px;
        border-radius: 8px;
        border: 1.5px solid ${COLORS.line};
        font-size: 14.5px;
        font-family: ${FONT_BODY};
        color: ${COLORS.ink};
        background: #fff;
        box-sizing: border-box;
        transition: border-color 0.15s, box-shadow 0.15s;
      }
      .ac-input:focus, .ac-select:focus {
        outline: none;
        border-color: ${COLORS.green};
        box-shadow: 0 0 0 3px rgba(20,181,58,0.12);
      }
      .ac-input:disabled, .ac-select:disabled { opacity: 0.55; cursor: not-allowed; }

      .ac-priority-card {
        flex: 1;
        padding: 14px 10px;
        border-radius: 10px;
        cursor: pointer;
        font-family: ${FONT_BODY};
        font-weight: 700;
        font-size: 13.5px;
        text-align: center;
        border: 2px solid ${COLORS.line};
        background: #fff;
        color: ${COLORS.slate};
        transition: transform 0.12s, border-color 0.15s, background 0.15s, box-shadow 0.15s;
      }
      .ac-priority-card:hover:not(:disabled) { transform: translateY(-2px); }
      .ac-priority-card:disabled { cursor: not-allowed; opacity: 0.6; }
      .ac-priority-emoji { display: block; font-size: 22px; margin-bottom: 4px; }

      .ac-submit {
        width: 100%;
        padding: 15px;
        background: ${COLORS.green};
        color: #fff;
        border: none;
        border-radius: 10px;
        cursor: pointer;
        font-size: 15.5px;
        font-weight: 700;
        font-family: ${FONT_BODY};
        letter-spacing: 0.01em;
        box-shadow: 0 6px 20px rgba(20,181,58,0.28);
        transition: transform 0.12s, box-shadow 0.12s, background 0.15s, opacity 0.15s;
      }
      .ac-submit:not(:disabled):hover { transform: translateY(-1px); background: #119b30; }
      .ac-submit:disabled { cursor: not-allowed; opacity: 0.55; box-shadow: none; }

      .ac-row {
        background: ${COLORS.card};
        border-radius: 12px;
        border: 1px solid ${COLORS.line};
        padding: 18px 22px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 14px;
        transition: box-shadow 0.15s, transform 0.15s;
      }
      .ac-row:hover { box-shadow: 0 8px 24px rgba(27,42,31,0.08); transform: translateY(-1px); }

      .ac-btn-ghost {
        padding: 9px 16px;
        border-radius: 7px;
        border: 1.5px solid ${COLORS.line};
        background: #fff;
        color: ${COLORS.ink};
        font-weight: 600;
        font-size: 13px;
        cursor: pointer;
        font-family: ${FONT_BODY};
        transition: border-color 0.15s, background 0.15s;
        white-space: nowrap;
      }
      .ac-btn-ghost:hover { border-color: ${COLORS.ink}; background: ${COLORS.paper}; }

      .ac-btn-recall {
        padding: 10px 18px;
        border-radius: 7px;
        border: none;
        background: ${COLORS.green};
        color: #fff;
        font-weight: 700;
        font-size: 13.5px;
        cursor: pointer;
        font-family: ${FONT_BODY};
        white-space: nowrap;
        transition: background 0.15s, transform 0.12s;
      }
      .ac-btn-recall:hover { background: #119b30; transform: translateY(-1px); }

      /* ---- Queue tabs (Tickets récents / File manquée) ---- */
      .ac-qtabs {
        display: flex;
        gap: 6px;
        margin-bottom: 20px;
        border-bottom: 1.5px solid ${COLORS.line};
      }
      .ac-qtab {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 11px 4px 13px;
        margin-right: 22px;
        background: none;
        border: none;
        border-bottom: 3px solid transparent;
        cursor: pointer;
        font-family: ${FONT_DISPLAY};
        font-size: 17px;
        font-weight: 700;
        color: ${COLORS.slate};
        transition: color 0.15s, border-color 0.15s;
      }
      .ac-qtab:hover { color: ${COLORS.ink}; }
      .ac-qtab.active { color: ${COLORS.ink}; border-bottom-color: ${COLORS.gold}; }
      .ac-qtab .ac-qtab-sub {
        font-family: ${FONT_BODY};
        font-weight: 400;
        font-size: 13px;
        color: ${COLORS.slate};
      }
      .ac-qtab-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 20px;
        height: 20px;
        padding: 0 6px;
        border-radius: 10px;
        background: ${COLORS.red};
        color: #fff;
        font-family: ${FONT_BODY};
        font-size: 11px;
        font-weight: 700;
      }
    `}</style>
  );
}

export default function Accueil() {
  // Patient flow: search an existing patient record, or register a new
  // one, before a ticket can be created — replaces free-typing a name each
  // visit. "step" drives which part of the stub body renders.
  const [patientStep, setPatientStep] = useState("search"); // search | register | ticket
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [patientSearchType, setPatientSearchType] = useState("id"); // id | phone | name | dob
  const [patientSearchTerm, setPatientSearchTerm] = useState("");
  const [patientSearchDate, setPatientSearchDate] = useState("");
  const [patientSearchResults, setPatientSearchResults] = useState([]);
  const [patientSearching, setPatientSearching] = useState(false);
  const [patientSearchRan, setPatientSearchRan] = useState(false);
  const [newPatientForm, setNewPatientForm] = useState({
    firstName: "", lastName: "", phone: "", dob: "", sex: "Homme",
    address: "", city: "", commune: "", quartier: "", bloodType: "", allergies: "",
  });
  const [registeringPatient, setRegisteringPatient] = useState(false);

  const [dept, setDept] = useState("");
  const [departments, setDepartments] = useState([]);
  const [priority, setPriority] = useState("normal");
  const [tickets, setTickets] = useState([]);
  const [missedTickets, setMissedTickets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [userData, setUserData] = useState(null);
  const [hospitalName, setHospitalName] = useState("");
  const [pageLoading, setPageLoading] = useState(true);
  // Which queue panel is showing on the right — keeps "Tickets récents" and
  // "File manquée" from both being fully expanded at once, so the page
  // reads as one focused list instead of two stacked ones competing for
  // attention (and scroll space) at the same time.
  const [queueTab, setQueueTab] = useState("recent"); // recent | missed
  const nav = useNavigate();
  const ticketsUnsubRef = useRef(null);
  const missedUnsubRef = useRef(null);
  const hospitalUnsubRef = useRef(null);
  const ticketsRefreshIntervalRef = useRef(null);

  useEffect(() => {
    const loadUserData = async () => {
      try {
        const userSnap = await getDoc(doc(db, "users", auth.currentUser.uid));
        if (!userSnap.exists()) {
          alert("❌ Données utilisateur introuvables. Veuillez vous réinscrire.");
          await signOut(auth);
          nav("/");
          return;
        }

        const data = userSnap.data();
        setUserData(data);
	alert("DEBUG reached point right after setUserData");

        // Update last login
        await updateDoc(doc(db, "users", auth.currentUser.uid), {
          lastLoginAt: new Date().toISOString()
        });

        // Check if disabled
        if (data.disabled) {
          alert("❌ Votre compte a été désactivé. Contactez l'administrateur.");
          await signOut(auth);
          nav("/");
          return;
        }

        if (!data.approved) return;

        if (data.role !== "accueil") {
          alert("❌ Accès refusé.");
          await signOut(auth);
          nav("/");
          return;
        }

        loadTickets();
      } catch (e) {
        alert("Erreur de chargement des données: " + e.message);
      }
    };

    const loadTickets = () => {
      const q = query(collection(db, "tickets"), orderBy("createdAt", "desc"));
      onSnapshot(q, snapshot => {
        const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        // Filter tickets from last 24 hours
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recentTickets = list.filter(t => new Date(t.createdAt) > twentyFourHoursAgo);
        setTickets(recentTickets);
      });
    };

    const checkAuth = async () => {
      if (!auth.currentUser) {
        nav("/");
        return;
      }
      await loadUserData();
      setPageLoading(false);
    };

    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user) checkAuth();
      else nav("/");
    });
    return () => {
      unsubscribe();
      if (ticketsUnsubRef.current) ticketsUnsubRef.current();
      if (missedUnsubRef.current) missedUnsubRef.current();
      if (hospitalUnsubRef.current) hospitalUnsubRef.current();
      if (ticketsRefreshIntervalRef.current) clearInterval(ticketsRefreshIntervalRef.current);
    };
   }, []); // eslint-disable-line react-hooks/exhaustive-deps


  const checkAuth = async () => {
    if (!auth.currentUser) return nav("/");
    await loadUserData();
    setPageLoading(false);
  };

  const loadUserData = async () => {
    try {
      const userSnap = await getDoc(doc(db, "users", auth.currentUser.uid));
      if (!userSnap.exists()) {
        alert("❌ Données utilisateur introuvables. Veuillez vous reconnecter.");
        await signOut(auth);
        nav("/");
        return;
      }

      const data = userSnap.data();

      await updateDoc(doc(db, "users", auth.currentUser.uid), { lastLoginAt: new Date().toISOString() });

      if (data.disabled) {
        alert("❌ Votre compte a été désactivé. Contactez l'administrateur.");
        await signOut(auth);
        nav("/");
        return;
      }
      if (data.role !== "accueil") {
        alert("❌ Accès refusé.");
        await signOut(auth);
        nav("/");
        return;
      }

      const hospSnap = await getDoc(doc(db, "hospitals", data.hospitalId));
      if (!hospSnap.exists() || hospSnap.data().active === false) {
        alert("❌ Cet hôpital a été désactivé.");
        await signOut(auth);
        nav("/");
        return;
      }
      setHospitalName(hospSnap.data().name);

      setUserData(data);
      startTicketsListener(data.hospitalId);
      startMissedQueueListener(data.hospitalId);
      startHospitalListener(data.hospitalId);

      // Periodically tear down and re-subscribe so the "last 24h" cutoff
      // keeps advancing even with no new tickets to trigger it naturally.
      // Cleared in the auth-state effect's cleanup above (covers sign-out,
      // unmount, and React Router navigation away from this page).
      if (ticketsRefreshIntervalRef.current) clearInterval(ticketsRefreshIntervalRef.current);
      ticketsRefreshIntervalRef.current = setInterval(() => {
        startTicketsListener(data.hospitalId);
      }, TICKET_WINDOW_REFRESH_MS);
    } catch (e) {
      alert("Erreur de chargement des données: " + e.message);
    }
  };

  // Live listener on the hospital's own document — a single-document
  // subscription is cheap (not a query), and it means if the Hospital
  // Admin adds/renames/removes a department while reception is mid-shift,
  // this screen picks it up immediately instead of needing a re-login.
  const startHospitalListener = (hospitalId) => {
    alert("DEBUG startHospitalListener CALLED with hospitalId=" + hospitalId);
    if (hospitalUnsubRef.current) {
      hospitalUnsubRef.current();
      hospitalUnsubRef.current = null;
    }
    hospitalUnsubRef.current = onSnapshot(
      doc(db, "hospitals", hospitalId),
      (snap) => {
	
        if (!snap.exists()) return;
        const depts = snap.data().departments || [];
        setDepartments(depts);
        // Keep the selected department valid: if nothing's chosen yet, or
        // the previously-chosen one just got deleted by the admin, fall
        // back to the first available department.
        setDept((current) => (current && depts.includes(current) ? current : (depts[0] || "")));
      },
      (error) => { console.error("Error loading hospital departments:", error); }
    );
  };

  // (Re)subscribes to a bounded "last 24h" query. Any previous listener is
  // torn down first, so calling this repeatedly (from the refresh interval
  // above) doesn't stack up multiple live subscriptions.
  const startTicketsListener = (hospitalId) => {
    if (ticketsUnsubRef.current) {
      ticketsUnsubRef.current();
      ticketsUnsubRef.current = null;
    }

    // Bounded at the query level: only tickets from the last 24h are ever
    // synced to this listener, instead of subscribing to the hospital's
    // entire ticket history and discarding most of it client-side after
    // download. This keeps read/bandwidth cost roughly constant no matter
    // how many tickets accumulate over the hospital's lifetime.
    // Requires the same composite index as Statistiques: tickets (hospitalId ASC, createdAt ASC/DESC).
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const q = query(
      collection(db, "tickets"),
      where("hospitalId", "==", hospitalId),
      where("createdAt", ">=", twentyFourHoursAgo.toISOString()),
      orderBy("createdAt", "desc")
    );
    ticketsUnsubRef.current = onSnapshot(
      q,
      (snapshot) => {
        setTickets(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (error) => {
        console.error("Error loading tickets:", error);
      }
    );
  };

  // Separate, dedicated listener for the missed queue. Deliberately NOT
  // tied to the "last 24h since ticket creation" window above: a ticket
  // created 20h ago that goes no-show 30 minutes ago should still be
  // recallable, even after it ages out of the "recent tickets" view.
  // Bounded instead by status equality + a result cap, so it stays cheap
  // regardless of how many no-shows accumulate over time.
  // Requires composite index: tickets (hospitalId ASC, status ASC, noShowAt DESC).
  const startMissedQueueListener = (hospitalId) => {
    if (missedUnsubRef.current) {
      missedUnsubRef.current();
      missedUnsubRef.current = null;
    }
    const q = query(
      collection(db, "tickets"),
      where("hospitalId", "==", hospitalId),
      where("status", "==", "no-show"),
      orderBy("noShowAt", "desc"),
      limit(100)
    );
    missedUnsubRef.current = onSnapshot(
      q,
      (snapshot) => {
        setMissedTickets(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (error) => {
        console.error("Error loading missed queue:", error);
      }
    );
  };

  // Searches the hospital's own patients collection — one of ID (exact),
  // phone (exact), name (prefix on last name), or DOB (exact date), per
  // the search methods you specified. Read-only, so this stays a direct
  // Firestore query (like the existing ticket search) rather than a Cloud
  // Function — no privileged write happening here.
  const searchPatients = async () => {
    const hid = userData?.hospitalId;
    if (!hid) return;
    setPatientSearching(true);
    setPatientSearchRan(true);
    setPatientSearchResults([]);
    try {
      let q;
      if (patientSearchType === "id") {
        const term = patientSearchTerm.trim();
        if (!term) { setPatientSearching(false); return; }
        q = query(collection(db, "patients"), where("hospitalId", "==", hid), where("patientId", "==", term), limit(10));
      } else if (patientSearchType === "phone") {
        const term = patientSearchTerm.trim();
        if (!term) { setPatientSearching(false); return; }
        q = query(collection(db, "patients"), where("hospitalId", "==", hid), where("phone", "==", term), limit(10));
      } else if (patientSearchType === "name") {
        const term = patientSearchTerm.trim();
        if (!term) { setPatientSearching(false); return; }
        q = query(
          collection(db, "patients"),
          where("hospitalId", "==", hid),
          where("lastName", ">=", term),
          where("lastName", "<=", term + "\uf8ff"),
          orderBy("lastName"),
          limit(15)
        );
      } else if (patientSearchType === "dob") {
        if (!patientSearchDate) { setPatientSearching(false); return; }
        q = query(collection(db, "patients"), where("hospitalId", "==", hid), where("dob", "==", patientSearchDate), limit(15));
      }
      const snap = await getDocs(q);
      setPatientSearchResults(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error("Error searching patients:", e);
      alert("❌ Erreur de recherche: " + (e.message || "Une erreur est survenue."));
    }
    setPatientSearching(false);
  };

  const selectPatient = (patient) => {
    setSelectedPatient(patient);
    setPatientStep("ticket");
  };

  const startNewPatientRegistration = () => {
    setNewPatientForm({
      firstName: "", lastName: "", phone: "", dob: "", sex: "Homme",
      address: "", city: "", commune: "", quartier: "", bloodType: "", allergies: "",
    });
    setPatientStep("register");
  };

  const registerNewPatient = async () => {
    if (!newPatientForm.firstName.trim() || !newPatientForm.lastName.trim()) {
      alert("❌ Le nom et le prénom sont obligatoires.");
      return;
    }
    setRegisteringPatient(true);
    try {
      const call = httpsCallable(functions, "registerPatient");
      const result = await call(newPatientForm);
      setSelectedPatient({
        id: result.data.id,
        patientId: result.data.patientId,
        ...newPatientForm,
      });
      setPatientStep("ticket");
    } catch (e) {
      alert("❌ Erreur lors de l'enregistrement du patient: " + (e.message || "Une erreur est survenue."));
    }
    setRegisteringPatient(false);
  };

  // "Changer de patient" — abandons the currently selected patient and
  // goes back to search, without touching anything already submitted.
  const resetPatientFlow = () => {
    setSelectedPatient(null);
    setPatientSearchTerm("");
    setPatientSearchDate("");
    setPatientSearchResults([]);
    setPatientSearchRan(false);
    setPatientStep("search");
  };


  const createTicket = async () => {
    if (!selectedPatient) return alert("❌ Veuillez d'abord rechercher ou enregistrer un patient.");
    if (!dept) return alert("❌ Aucun département sélectionné. Demandez à l'administrateur de configurer les départements de l'hôpital.");

    setLoading(true);
    try {
      const deptLetter = dept.charAt(0).toUpperCase();
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD — numbers reset daily per department
      const counterId = `${userData.hospitalId}_${deptLetter}_${today}`;
      const counterRef = doc(db, "ticketCounters", counterId);
      const ticketRef = doc(collection(db, "tickets")); // pre-generate the ID, write happens inside the transaction below

      let ticketNumber;
      await runTransaction(db, async (tx) => {
        const counterSnap = await tx.get(counterRef);
        const nextNumber = (counterSnap.exists() ? (counterSnap.data().count || 0) : 0) + 1;
        ticketNumber = `${deptLetter}-${String(nextNumber).padStart(3, "0")}`;

        const ticketData = {
          ticketNumber,
          patientDocId: selectedPatient.id,
          patientId: selectedPatient.patientId,
          patientName: `${selectedPatient.firstName} ${selectedPatient.lastName}`,
          age: calcAge(selectedPatient.dob),
          sex: selectedPatient.sex || "",
          department: dept,
          priority,
          hospitalId: userData.hospitalId,
          status: "waiting",
          createdAt: new Date().toISOString(),
          createdBy: auth.currentUser.uid,
          createdByName: `${userData.firstName} ${userData.lastName}`,
        };

        // Counter increment and ticket creation happen in the SAME
        // transaction — either both succeed or neither does, so a ticket
        // number can never get "reserved" by the counter without an
        // actual ticket existing for it (which a separate addDoc() call
        // right after the transaction could have left half-done on a
        // network hiccup).
        tx.set(counterRef, { hospitalId: userData.hospitalId, department: dept, date: today, count: nextNumber }, { merge: true });
        tx.set(ticketRef, ticketData);
      });

      printTicket({
        ticketNumber,
        patientDocId: selectedPatient.id,
        patientId: selectedPatient.patientId,
        patientName: `${selectedPatient.firstName} ${selectedPatient.lastName}`,
        age: calcAge(selectedPatient.dob),
        sex: selectedPatient.sex || "",
        department: dept,
        priority,
        createdAt: new Date().toISOString(),
        createdByName: `${userData.firstName} ${userData.lastName}`,
      });

      // Back to search for the next patient, rather than clearing a form —
      // the whole point of the patient flow is you always start by finding
      // or registering someone, not by typing a name from scratch.
      resetPatientFlow();
      setPriority("normal");
      setLoading(false);
      alert(`✅ Ticket créé: ${ticketNumber} (${selectedPatient.patientId})`);
    } catch (e) {
      alert("❌ Erreur de création du ticket: " + e.message);
      setLoading(false);
    }
  };

  const printTicket = (ticketData) => {
    const p = PRIORITY_CONFIG[ticketData.priority] || PRIORITY_CONFIG.normal;
    const printWindow = window.open("", "", "height=680,width=420");
    printWindow.document.write(`
      <html><head><title>Ticket ${ticketData.ticketNumber}</title>
      <style>
        body { font-family: Georgia, 'Times New Roman', serif; padding: 0; margin: 0; background: #EDEAE2; }
        .flagbar { height: 8px; display: flex; }
        .flagbar div { flex: 1; }
        .ticket { background: #fff; margin: 22px; border-radius: 14px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.12); border: 1px solid #E6E2D8; }
        .counterfoil { background: #1B2A1F; color: #F6EEDD; padding: 20px 26px 26px; text-align: center; }
        .counterfoil .eyebrow { font-size: 10.5px; letter-spacing: 0.16em; text-transform: uppercase; color: #E9C77D; font-weight: bold; margin: 0 0 4px; }
        .counterfoil h1 { font-size: 19px; margin: 0; font-weight: normal; }
        .priority-banner { text-align: center; font-size: 15px; font-weight: bold; padding: 9px; margin: 18px 26px 0; border-radius: 8px; color: ${p.color}; background: ${p.bg}; border: 1.5px solid ${p.color}; }
        .ticket-number { font-size: 46px; font-weight: bold; text-align: center; color: #1B2A1F; margin: 18px 26px; padding: 18px; background: #FAF9F5; border-radius: 10px; border: 2px dashed #D8C9A8; letter-spacing: 0.02em; }
        .info { margin: 10px 26px; font-size: 14.5px; font-family: 'Segoe UI', Arial, sans-serif; color: #1B2A1F; }
        .info strong { color: #5B6B63; font-weight: 600; }
        .footer { margin: 22px 26px 0; padding: 14px 0 20px; border-top: 1.5px dashed #D8C9A8; text-align: center; font-size: 11.5px; color: #8A7F6C; font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; }
      </style></head>
      <body>
        <div class="flagbar"><div style="background:#14B53A"></div><div style="background:#FCD116"></div><div style="background:#CE1126"></div></div>
        <div class="ticket">
          <div class="counterfoil">
            <p class="eyebrow">République du Mali · Ministère de la Santé</p>
            <h1>${hospitalName}</h1>
          </div>
          <div class="priority-banner">${p.emoji} ${p.label.toUpperCase()}</div>
          <div class="ticket-number">${ticketData.ticketNumber}</div>
          <div class="info"><strong>Patient</strong> &nbsp;${ticketData.patientName}</div>
          <div class="info"><strong>ID Patient</strong> &nbsp;${ticketData.patientId || "—"}</div>
          <div class="info"><strong>Âge</strong> &nbsp;${ticketData.age != null ? ticketData.age + " ans" : "—"}</div>
          <div class="info"><strong>Sexe</strong> &nbsp;${ticketData.sex}</div>
          <div class="info"><strong>Département</strong> &nbsp;${ticketData.department}</div>
          <div class="info"><strong>Date</strong> &nbsp;${new Date(ticketData.createdAt).toLocaleString("fr-FR")}</div>
          <div class="info"><strong>Enregistré par</strong> &nbsp;${ticketData.createdByName}</div>
          <div class="footer">Veuillez garder ce ticket et attendre votre appel<br/>Please keep this ticket and wait for your call</div>
        </div>
      </body></html>
    `);
    printWindow.document.close();
    setTimeout(() => { printWindow.print(); printWindow.close(); }, 250);
  };

  // Brings a "no-show" patient back into the waiting queue. Re-queues them
  // at the current moment (createdAt is bumped to now) rather than their
  // original arrival time, so they queue fairly behind patients who kept
  // waiting instead of jumping back ahead of everyone at their priority
  // level — their original arrival time is preserved in `originalCreatedAt`
  // for the record. Priority is untouched, so an emergency recall still
  // moves ahead of normal patients on the doctor's dashboard.
  const recallTicket = async (ticket) => {
    try {
      await updateDoc(doc(db, "tickets", ticket.id), {
        status: "waiting",
        createdAt: new Date().toISOString(),
        originalCreatedAt: ticket.originalCreatedAt || ticket.createdAt,
        recalledAt: new Date().toISOString(),
        recalledBy: auth.currentUser.uid,
        recalledByName: `${userData.firstName} ${userData.lastName}`,
      });
    } catch (e) {
      alert("❌ Erreur lors du rappel: " + e.message);
    }
  };

  const logout = async () => { await signOut(auth); nav("/"); };

  if (pageLoading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16, backgroundColor: COLORS.paper, fontFamily: FONT_BODY }}>
        <GlobalStyle />
        <MaliFlag width={56} height={38} />
        <div style={{ fontSize: 16, color: COLORS.slate }}>Chargement…</div>
      </div>
    );
  }

  // Excludes no-shows from the "recent tickets" display — those are shown
  // separately via the dedicated missedTickets state (its own listener,
  // not bounded by the same 24h-since-creation window as `tickets`).
  const recentTickets = tickets.filter((t) => t.status !== "no-show");

  return (
    <div className="ac-page">
      <GlobalStyle />
      {/* Tricolor signature bar */}
      <div style={{ height: 6, display: "flex" }}>
        <div style={{ flex: 1, background: COLORS.green }} />
        <div style={{ flex: 1, background: COLORS.gold }} />
        <div style={{ flex: 1, background: COLORS.red }} />
      </div>

      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "0 24px" }}>

        {/* Official letterhead header — matches Doctor.jsx / AdminPanel.jsx */}
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
                {hospitalName} <span style={{ color: COLORS.line }}>·</span> Accueil
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 13, color: COLORS.slate }}>Connecté en tant que</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.ink }}>{userData?.firstName} {userData?.lastName}</div>
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

        <div style={{ padding: "28px 0 60px 0" }}>
          <div className="ac-grid">

            {/* ---- Left: the ticket stub (signature element) ---- */}
            <div className="ac-stub">
              <div className="ac-stub-counterfoil">
                <BogolanPattern id="ac-pat-stub" opacity={0.1} />
                <p style={{ position: "relative", margin: "0 0 3px", fontFamily: FONT_DISPLAY, fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: "#E9C77D", fontWeight: 700 }}>
                  {patientStep === "search" ? "Étape 1" : patientStep === "register" ? "Nouveau patient" : "Étape 2 · Nouveau ticket"}
                </p>
                <p style={{ position: "relative", margin: 0, fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 700, color: "#F6EEDD" }}>
                  {patientStep === "search" ? "Rechercher un patient" : patientStep === "register" ? "Enregistrement d'un patient" : "Créer le ticket"}
                </p>
              </div>
              <div className="ac-perforation">
                <div className="ac-perforation-line" />
              </div>
              <div className="ac-stub-body">

                {/* ---- Step: search for an existing patient ---- */}
                {patientStep === "search" && (
                  <>
                    <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
                      {[
                        { key: "id", label: "ID Patient" },
                        { key: "phone", label: "Téléphone" },
                        { key: "name", label: "Nom" },
                        { key: "dob", label: "Date de naissance" },
                      ].map((opt) => (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => { setPatientSearchType(opt.key); setPatientSearchResults([]); setPatientSearchRan(false); }}
                          style={{
                            padding: "7px 14px", borderRadius: 20, cursor: "pointer", fontSize: 12.5, fontWeight: 600,
                            border: `1px solid ${patientSearchType === opt.key ? COLORS.green : COLORS.line}`,
                            backgroundColor: patientSearchType === opt.key ? COLORS.green : "#fff",
                            color: patientSearchType === opt.key ? "#fff" : COLORS.slate,
                          }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>

                    {patientSearchType === "dob" ? (
                      <input
                        className="ac-input" type="date"
                        value={patientSearchDate}
                        onChange={(e) => setPatientSearchDate(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && searchPatients()}
                      />
                    ) : (
                      <input
                        className="ac-input"
                        placeholder={patientSearchType === "id" ? "ex: PAT-000123" : patientSearchType === "phone" ? "ex: 76 12 34 56" : "Nom de famille"}
                        value={patientSearchTerm}
                        onChange={(e) => setPatientSearchTerm(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && searchPatients()}
                      />
                    )}

                    <button className="ac-submit" onClick={searchPatients} disabled={patientSearching} style={{ marginBottom: 14 }}>
                      {patientSearching ? "Recherche…" : "🔍 Rechercher"}
                    </button>

                    {patientSearchRan && !patientSearching && (
                      patientSearchResults.length === 0 ? (
                        <div style={{ padding: 14, marginBottom: 14, backgroundColor: COLORS.paper, borderRadius: 8, border: `1.5px dashed ${COLORS.line}`, fontSize: 13, color: COLORS.slate, textAlign: "center" }}>
                          Aucun patient trouvé.
                        </div>
                      ) : (
                        <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
                          {patientSearchResults.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => selectPatient(p)}
                              style={{
                                textAlign: "left", padding: "10px 14px", borderRadius: 8, cursor: "pointer",
                                border: `1.5px solid ${COLORS.line}`, backgroundColor: "#fff",
                              }}
                            >
                              <div style={{ fontWeight: 700, color: COLORS.ink, fontSize: 14 }}>{p.firstName} {p.lastName}</div>
                              <div style={{ fontSize: 12, color: COLORS.slate, marginTop: 2 }}>
                                {p.patientId} {p.phone ? `· ${p.phone}` : ""} {p.dob ? `· né(e) ${p.dob}` : ""}
                              </div>
                            </button>
                          ))}
                        </div>
                      )
                    )}

                    <div style={{ textAlign: "center", margin: "10px 0" }}>
                      <span style={{ fontSize: 12.5, color: COLORS.slate }}>ou</span>
                    </div>
                    <button
                      type="button"
                      onClick={startNewPatientRegistration}
                      style={{
                        width: "100%", padding: 13, backgroundColor: "#fff", color: COLORS.ink,
                        border: `1.5px solid ${COLORS.ink}`, borderRadius: 10, cursor: "pointer",
                        fontWeight: 700, fontSize: 14, fontFamily: FONT_BODY,
                      }}
                    >
                      + Nouveau patient
                    </button>
                  </>
                )}

                {/* ---- Step: register a new patient ---- */}
                {patientStep === "register" && (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div>
                        <label style={labelStyle}>Prénom</label>
                        <input className="ac-input" value={newPatientForm.firstName} onChange={(e) => setNewPatientForm({ ...newPatientForm, firstName: e.target.value })} disabled={registeringPatient} />
                      </div>
                      <div>
                        <label style={labelStyle}>Nom</label>
                        <input className="ac-input" value={newPatientForm.lastName} onChange={(e) => setNewPatientForm({ ...newPatientForm, lastName: e.target.value })} disabled={registeringPatient} />
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div>
                        <label style={labelStyle}>Téléphone</label>
                        <input className="ac-input" value={newPatientForm.phone} onChange={(e) => setNewPatientForm({ ...newPatientForm, phone: e.target.value })} disabled={registeringPatient} />
                      </div>
                      <div>
                        <label style={labelStyle}>Date de naissance</label>
                        <input className="ac-input" type="date" value={newPatientForm.dob} onChange={(e) => setNewPatientForm({ ...newPatientForm, dob: e.target.value })} disabled={registeringPatient} />
                      </div>
                    </div>
                    <label style={labelStyle}>Sexe</label>
                    <select className="ac-select" value={newPatientForm.sex} onChange={(e) => setNewPatientForm({ ...newPatientForm, sex: e.target.value })} disabled={registeringPatient}>
                      <option>Homme</option><option>Femme</option>
                    </select>

                    <label style={labelStyle}>Adresse (optionnel)</label>
                    <input className="ac-input" value={newPatientForm.address} onChange={(e) => setNewPatientForm({ ...newPatientForm, address: e.target.value })} disabled={registeringPatient} />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                      <div>
                        <label style={labelStyle}>Ville</label>
                        <select
                          className="ac-select"
                          value={newPatientForm.city}
                          onChange={(e) => setNewPatientForm({ ...newPatientForm, city: e.target.value, commune: "", quartier: "" })}
                          disabled={registeringPatient}
                        >
                          <option value="">Sélectionner…</option>
                          {Object.keys(VILLES).sort().map((v) => (<option key={v}>{v}</option>))}
                        </select>
                      </div>
                      <div>
                        <label style={labelStyle}>Commune</label>
                        {newPatientForm.city && Object.keys(VILLES[newPatientForm.city] || {}).length > 0 ? (
                          <select
                            className="ac-select"
                            value={newPatientForm.commune}
                            onChange={(e) => setNewPatientForm({ ...newPatientForm, commune: e.target.value, quartier: "" })}
                            disabled={registeringPatient}
                          >
                            <option value="">Sélectionner…</option>
                            {Object.keys(VILLES[newPatientForm.city]).map((c) => (<option key={c}>{c}</option>))}
                          </select>
                        ) : (
                          <input
                            className="ac-input"
                            placeholder={newPatientForm.city ? "Communes bientôt disponibles" : "Choisir une ville d'abord"}
                            value={newPatientForm.commune}
                            onChange={(e) => setNewPatientForm({ ...newPatientForm, commune: e.target.value })}
                            disabled={registeringPatient || !newPatientForm.city}
                          />
                        )}
                      </div>
                      <div>
                        <label style={labelStyle}>Quartier</label>
                        {newPatientForm.city && newPatientForm.commune && (VILLES[newPatientForm.city]?.[newPatientForm.commune]?.length > 0) ? (
                          <select
                            className="ac-select"
                            value={newPatientForm.quartier}
                            onChange={(e) => setNewPatientForm({ ...newPatientForm, quartier: e.target.value })}
                            disabled={registeringPatient}
                          >
                            <option value="">Sélectionner…</option>
                            {VILLES[newPatientForm.city][newPatientForm.commune].map((q) => (<option key={q}>{q}</option>))}
                          </select>
                        ) : (
                          <input
                            className="ac-input"
                            placeholder={newPatientForm.commune ? "Quartiers bientôt disponibles" : "Choisir une commune d'abord"}
                            value={newPatientForm.quartier}
                            onChange={(e) => setNewPatientForm({ ...newPatientForm, quartier: e.target.value })}
                            disabled={registeringPatient || !newPatientForm.commune}
                          />
                        )}
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div>
                        <label style={labelStyle}>Groupe sanguin (optionnel)</label>
                        <input className="ac-input" placeholder="ex: O+" value={newPatientForm.bloodType} onChange={(e) => setNewPatientForm({ ...newPatientForm, bloodType: e.target.value })} disabled={registeringPatient} />
                      </div>
                      <div>
                        <label style={labelStyle}>Allergies (optionnel)</label>
                        <input className="ac-input" value={newPatientForm.allergies} onChange={(e) => setNewPatientForm({ ...newPatientForm, allergies: e.target.value })} disabled={registeringPatient} />
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
                      <button className="ac-submit" onClick={registerNewPatient} disabled={registeringPatient} style={{ flex: 1 }}>
                        {registeringPatient ? "Enregistrement…" : "Enregistrer le patient"}
                      </button>
                      <button type="button" className="ac-btn-ghost" onClick={() => setPatientStep("search")} disabled={registeringPatient}>
                        Annuler
                      </button>
                    </div>
                  </>
                )}

                {/* ---- Step: patient resolved — create the ticket ---- */}
                {patientStep === "ticket" && selectedPatient && (
                  <>
                    <div style={{
                      padding: 14, marginBottom: 18, backgroundColor: COLORS.successBg, borderRadius: 10,
                      border: `1.5px solid ${COLORS.successText}`,
                    }}>
                      <div style={{ fontWeight: 700, color: COLORS.ink, fontSize: 15.5 }}>
                        {selectedPatient.firstName} {selectedPatient.lastName}
                      </div>
                      <div style={{ fontSize: 12.5, color: COLORS.slate, marginTop: 3 }}>
                        {selectedPatient.patientId} · {calcAge(selectedPatient.dob) != null ? `${calcAge(selectedPatient.dob)} ans` : "âge inconnu"} · {selectedPatient.sex || "—"}
                        {selectedPatient.phone ? ` · ${selectedPatient.phone}` : ""}
                      </div>
                      <button type="button" onClick={resetPatientFlow} style={{ marginTop: 8, background: "none", border: "none", color: COLORS.successText, fontSize: 12.5, fontWeight: 700, cursor: "pointer", padding: 0 }}>
                        Changer de patient
                      </button>
                    </div>

                    <label style={labelStyle}>Département</label>
		    
                    {departments.length === 0 ? (
                      <div style={{ padding: 12, marginBottom: 14, backgroundColor: COLORS.dangerBg, border: `1px solid #F1C3C9`, borderRadius: 8, color: COLORS.dangerText, fontSize: 13, fontWeight: 600 }}>
                        ⚠️ Aucun département configuré. Contactez votre administrateur.
                      </div>
                    ) : (
                      <select className="ac-select" value={dept} onChange={(e) => setDept(e.target.value)} disabled={loading}>
                        {departments.map((d) => (<option key={d}>{d}</option>))}
                      </select>
                    )}

                    <label style={{ ...labelStyle, marginTop: 4 }}>Niveau de priorité (triage)</label>
                    <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
                      {Object.entries(PRIORITY_CONFIG).map(([key, cfg]) => (
                        <button
                          key={key}
                          type="button"
                          className="ac-priority-card"
                          onClick={() => setPriority(key)}
                          disabled={loading}
                          style={{
                            borderColor: priority === key ? cfg.color : COLORS.line,
                            backgroundColor: priority === key ? cfg.bg : "#fff",
                            color: priority === key ? cfg.color : COLORS.slate,
                            boxShadow: priority === key ? `0 0 0 4px ${cfg.ring}` : "none",
                          }}
                        >
                          <span className="ac-priority-emoji">{cfg.emoji}</span>
                          {cfg.label}
                        </button>
                      ))}
                    </div>

                    <button className="ac-submit" onClick={createTicket} disabled={loading || departments.length === 0}>
                      {loading ? "Création en cours…" : "🎫 Créer et imprimer le ticket"}
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* ---- Right: queues, organized as tabs so only one list is
                 expanded at a time — reads as a single focused view
                 instead of two long lists stacked on top of each other. ---- */}
            <div>
              <div className="ac-qtabs">
                <button
                  type="button"
                  className={`ac-qtab ${queueTab === "recent" ? "active" : ""}`}
                  onClick={() => setQueueTab("recent")}
                >
                  Tickets récents <span className="ac-qtab-sub">· 24h</span>
                </button>
                <button
                  type="button"
                  className={`ac-qtab ${queueTab === "missed" ? "active" : ""}`}
                  onClick={() => setQueueTab("missed")}
                >
                  File manquée <span className="ac-qtab-sub">· non présentés</span>
                  {missedTickets.length > 0 && <span className="ac-qtab-badge">{missedTickets.length}</span>}
                </button>
              </div>

              {queueTab === "recent" && (
                recentTickets.length === 0 ? (
                  <EmptyState text="Rien pour l'instant — les tickets créés apparaîtront ici." />
                ) : (
                  <div style={{ display: "grid", gap: 12, marginBottom: 40 }}>
                    {recentTickets.map((t) => {
                      const p = PRIORITY_CONFIG[t.priority] || PRIORITY_CONFIG.normal;
                      const statusColor = t.status === "waiting" ? COLORS.warnText : t.status === "ready" ? "#2E5C8C" : t.status === "in-progress" ? "#2E5C8C" : COLORS.successText;
                      const statusBg = t.status === "waiting" ? COLORS.warnBg : t.status === "ready" ? "#E8F0FB" : t.status === "in-progress" ? "#E8F0FB" : COLORS.successBg;
                      const statusLabel = t.status === "waiting" ? "🩺 Attente triage" : t.status === "ready" ? "✅ Prêt pour médecin" : t.status === "in-progress" ? "🔄 En cours" : "✅ Complété";
                      return (
                        <div key={t.id} className="ac-row" style={{ borderLeft: `5px solid ${p.color}` }}>
                          <div style={{ flex: 1, minWidth: 220 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
                              <span style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 700, color: COLORS.ink }}>{t.ticketNumber}</span>
                              <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11.5, fontWeight: 700, color: p.color, backgroundColor: p.bg, border: `1.5px solid ${p.color}` }}>
                                {p.emoji} {p.label}
                              </span>
                            </div>
                            <div style={{ fontSize: 15.5, fontWeight: 700, color: COLORS.ink }}>{t.patientName}</div>
                            <div style={{ fontSize: 13, color: COLORS.slate, marginTop: 3 }}>{t.age} ans · {t.sex} · {t.department}</div>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <span style={{ padding: "7px 14px", borderRadius: 20, backgroundColor: statusBg, color: statusColor, fontWeight: 700, fontSize: 12.5 }}>
                              {statusLabel}
                            </span>
                            <button className="ac-btn-ghost" onClick={() => printTicket(t)}>🖨️ Réimprimer</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
              )}

              {queueTab === "missed" && (
                missedTickets.length === 0 ? (
                  <EmptyState text="Aucun patient manqué — la file est à jour." muted />
                ) : (
                  <div style={{ display: "grid", gap: 12 }}>
                    {missedTickets.map((t) => {
                      const p = PRIORITY_CONFIG[t.priority] || PRIORITY_CONFIG.normal;
                      return (
                        <div key={t.id} className="ac-row" style={{ borderLeft: `5px solid ${p.color}`, background: "#F6F5F1" }}>
                          <div style={{ flex: 1, minWidth: 220 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
                              <span style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 700, color: COLORS.slate }}>{t.ticketNumber}</span>
                              <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11.5, fontWeight: 700, color: p.color, backgroundColor: p.bg, border: `1.5px solid ${p.color}` }}>
                                {p.emoji} {p.label}
                              </span>
                            </div>
                            <div style={{ fontSize: 15.5, fontWeight: 700, color: COLORS.ink }}>{t.patientName}</div>
                            <div style={{ fontSize: 13, color: COLORS.slate, marginTop: 3 }}>{t.age} ans · {t.sex} · {t.department}</div>
                            <div style={{ fontSize: 12, color: "#8A7F6C", marginTop: 6 }}>
                              Non présenté(e) le {t.noShowAt ? new Date(t.noShowAt).toLocaleString("fr-FR") : "—"} — signalé par {t.noShowByName || "un membre du personnel"}
                            </div>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <button className="ac-btn-recall" onClick={() => recallTicket(t)}>🔁 Rappeler en file</button>
                            <button className="ac-btn-ghost" onClick={() => printTicket(t)}>🖨️ Réimprimer</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
              )}
            </div>
          </div>
        </div>

        <div style={{ borderTop: `1px solid ${COLORS.line}`, padding: "18px 0", textAlign: "center", fontSize: 12.5, color: COLORS.slate }}>
          République du Mali — Ministère de la Santé · Système de gestion hospitalière
        </div>
      </div>
      {showChangePassword && (
        <ChangePassword onClose={() => setShowChangePassword(false)} />
      )}
    </div>
  );
}

function EmptyState({ text, muted }) {
  return (
    <div style={{
      padding: "36px 24px", marginBottom: 40, textAlign: "center",
      color: muted ? "#A39C8C" : COLORS.slate, border: `1.5px dashed ${COLORS.line}`,
      borderRadius: 12, fontSize: 14.5, background: muted ? "transparent" : COLORS.card,
    }}>
      {text}
    </div>
  );
}

const labelStyle = {
  display: "block",
  fontSize: 11.5,
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: COLORS.slate,
  marginBottom: 6,
};

const sectionHeadingStyle = {
  color: COLORS.ink,
  fontFamily: FONT_DISPLAY,
  fontSize: 18,
  marginBottom: 16,
  borderLeft: `4px solid ${COLORS.gold}`,
  paddingLeft: 12,
};
