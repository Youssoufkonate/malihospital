import { useState, useEffect, useRef } from "react";
import ChangePassword from "./ChangePassword";
import SessionsButton from "../components/SessionsButton";
import { auth, db } from "../firebase";
import { collection, doc, updateDoc, getDoc, getDocs, query, where, orderBy, limit, onSnapshot } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import NotificationsBanner from "../components/NotificationsBanner";

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

// Must stay in sync with Accueil.jsx / Doctor.jsx.
const PRIORITY_CONFIG = {
  emergency: { label: "Urgence", emoji: "🔴", rank: 0, color: "#A31221", bg: "#FBEAEC" },
  urgent:    { label: "Urgent",  emoji: "🟠", rank: 1, color: "#8A5A00", bg: "#FDF3E3" },
  normal:    { label: "Normal",  emoji: "🟢", rank: 2, color: "#1E7B34", bg: "#E9F7EC" },
};
const priorityRank = (p) => PRIORITY_CONFIG[p]?.rank ?? PRIORITY_CONFIG.normal.rank;

const emptyVitalsForm = (priority) => ({
  bpSystolic: "", bpDiastolic: "", temperature: "", pulse: "", spo2: "",
  weightKg: "", heightCm: "", notes: "", priority: priority || "normal",
});

export default function Nurse() {
  const [allTickets, setAllTickets] = useState([]);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [userData, setUserData] = useState(null);
  const [hospitalName, setHospitalName] = useState("");
  const [loading, setLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("triage"); // triage | triaged | schedule
  const [mySchedule, setMySchedule] = useState([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterPriority, setFilterPriority] = useState("all");
  const [expandedTicketId, setExpandedTicketId] = useState(null);
  const [vitalsForm, setVitalsForm] = useState(emptyVitalsForm());
  const [savingVitals, setSavingVitals] = useState(false);
  const nav = useNavigate();
  const ticketsUnsubRef = useRef(null);

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
      if (user.role !== "nurse") {
        alert("❌ Accès refusé. Cette page est réservée au personnel infirmier.");
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

      try {
        await updateDoc(doc(db, "users", auth.currentUser.uid), { lastLoginAt: new Date().toISOString() });
      } catch (e) {
        console.warn("Could not update lastLoginAt:", e);
      }

      setUserData(user);
      loadTickets(user);
      loadMySchedule(user);
      setPageLoading(false);
    } catch (e) {
      console.error("Error loading user data:", e);
      alert("Erreur de chargement des données: " + e.message);
      setPageLoading(false);
    }
  };

  const loadTickets = (user) => {
    setLoading(true);

    // Same scoping as Doctor.jsx: hospitalId + department, so a nurse
    // never sees a ticket from another hospital or another department.
    const q = query(
      collection(db, "tickets"),
      where("hospitalId", "==", user.hospitalId),
      where("department", "==", user.department)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
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

  // Same pattern as Doctor.jsx — reuses the (hospitalId, department, date)
  // index Supervisor.jsx's roster view already needs, filtering down to
  // just this nurse's own shifts client-side.
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

  const openVitalsPanel = (ticket) => {
    setExpandedTicketId(ticket.id);
    setVitalsForm(emptyVitalsForm(ticket.priority));
  };

  const closeVitalsPanel = () => {
    setExpandedTicketId(null);
    setVitalsForm(emptyVitalsForm());
  };

  // Writes the vitals + moves the ticket from "waiting" to "ready" — the
  // required gate this hospital uses: a doctor cannot call a patient until
  // a nurse has triaged them. Numeric fields are stored as numbers where
  // filled in, or omitted (not forced to 0) where left blank, since a
  // nurse may not always be able to take every measurement.
  const markReadyForDoctor = async (ticket) => {
    setSavingVitals(true);
    try {
      const toNum = (v) => (v === "" || v == null ? null : Number(v));
      const updates = {
        status: "ready",
        priority: vitalsForm.priority,
        bpSystolic: toNum(vitalsForm.bpSystolic),
        bpDiastolic: toNum(vitalsForm.bpDiastolic),
        temperature: toNum(vitalsForm.temperature),
        pulse: toNum(vitalsForm.pulse),
        spo2: toNum(vitalsForm.spo2),
        weightKg: toNum(vitalsForm.weightKg),
        heightCm: toNum(vitalsForm.heightCm),
        vitalsNotes: vitalsForm.notes || "",
        vitalsTakenAt: new Date().toISOString(),
        vitalsTakenBy: auth.currentUser.uid,
        vitalsTakenByName: `${userData.firstName} ${userData.lastName}`,
      };
      await updateDoc(doc(db, "tickets", ticket.id), updates);
      closeVitalsPanel();
    } catch (e) {
      alert("❌ Erreur lors de l'enregistrement des constantes: " + e.message);
    }
    setSavingVitals(false);
  };

  // A patient who never showed up for triage at all — distinct from a
  // doctor's "no-show" (which means they were triaged/ready but didn't
  // show for the consultation itself). Reuses the exact same fields
  // (noShowAt/noShowBy/noShowByName) so Accueil's Missed Queue and recall
  // flow work identically regardless of which stage flagged it.
  const markNoShow = (ticket) => {
    if (!window.confirm(`Marquer ${ticket.patientName} (${ticket.ticketNumber}) comme non présenté(e) pour le triage ?\n\nLe patient sera déplacé vers la file manquée. La réception pourra le rappeler plus tard.`)) return;
    updateDoc(doc(db, "tickets", ticket.id), {
      status: "no-show",
      noShowAt: new Date().toISOString(),
      noShowBy: auth.currentUser.uid,
      noShowByName: `${userData.firstName} ${userData.lastName} (infirmier·ère)`,
    }).catch((e) => alert("❌ Erreur: " + e.message));
    if (expandedTicketId === ticket.id) closeVitalsPanel();
  };

  const logout = async () => {
    if (ticketsUnsubRef.current) {
      ticketsUnsubRef.current();
      ticketsUnsubRef.current = null;
    }
    try {
      if (auth.currentUser) {
        await updateDoc(doc(db, "users", auth.currentUser.uid), { lastLogoutAt: new Date().toISOString() });
      }
    } catch (e) {
      console.warn("Could not record logout:", e);
    }
    await signOut(auth);
    nav("/");
  };

  const getFilteredTickets = () => {
    let filtered = allTickets;
    if (activeTab === "triage") filtered = filtered.filter((t) => t.status === "waiting");
    else if (activeTab === "triaged") filtered = filtered.filter((t) => t.status && t.status !== "waiting");

    if (searchTerm) {
      filtered = filtered.filter((t) =>
        t.patientName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.ticketNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.symptoms?.toLowerCase().includes(searchTerm.toLowerCase()));
    }
    if (filterPriority !== "all") filtered = filtered.filter((t) => (t.priority || "normal") === filterPriority);
    return filtered;
  };

  const formatVitals = (t) => {
    const parts = [];
    if (t.bpSystolic != null && t.bpDiastolic != null) parts.push(`${t.bpSystolic}/${t.bpDiastolic} mmHg`);
    if (t.temperature != null) parts.push(`${t.temperature}°C`);
    if (t.pulse != null) parts.push(`${t.pulse} bpm`);
    if (t.spo2 != null) parts.push(`SpO₂ ${t.spo2}%`);
    if (t.weightKg != null) parts.push(`${t.weightKg} kg`);
    if (t.heightCm != null) parts.push(`${t.heightCm} cm`);
    return parts.length ? parts.join(" · ") : null;
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
  const triageCount = allTickets.filter((t) => t.status === "waiting").length;
  const triagedCount = allTickets.filter((t) => t.status && t.status !== "waiting").length;

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
                {hospitalName} <span style={{ color: COLORS.line }}>·</span> {userData.department} <span style={{ color: COLORS.line }}>·</span> Triage
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

        <div style={{ display: "flex", gap: 4, marginTop: 4, borderBottom: `2px solid ${COLORS.line}` }}>
          {["triage", "triaged", "schedule"].map((tab) => (
            <button key={tab} onClick={() => { setActiveTab(tab); closeVitalsPanel(); }}
              style={{
                padding: "13px 22px", border: "none", background: "none", cursor: "pointer",
                fontSize: 15, fontWeight: activeTab === tab ? 700 : 500,
                color: activeTab === tab ? COLORS.green : COLORS.slate,
                borderBottom: activeTab === tab ? `3px solid ${COLORS.green}` : "3px solid transparent",
                marginBottom: -2, fontFamily: FONT_BODY, transition: "color 0.15s",
              }}>
              {tab === "triage" ? `À trier (${triageCount})` : tab === "triaged" ? `Triés (${triagedCount})` : "🗓️ Mon planning"}
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
            <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)} style={{ ...fieldStyle, width: 180, marginBottom: 0 }}>
              <option value="all">Toutes priorités</option>
              {Object.entries(PRIORITY_CONFIG).map(([key, cfg]) => (
                <option key={key} value={key}>{cfg.emoji} {cfg.label}</option>
              ))}
            </select>
          </div>

          <h3 style={sectionHeadingStyle}>
            {activeTab === "triage" ? "Patients à trier" : "Patients déjà triés"} — {userData.department}
          </h3>

          {loading ? (
            <p style={{ marginTop: 20, color: COLORS.slate }}>Chargement des tickets…</p>
          ) : filteredTickets.length === 0 ? (
            <div style={{
              marginTop: 16, padding: 40, backgroundColor: COLORS.card, borderRadius: 10, textAlign: "center",
              color: COLORS.slate, border: `1.5px dashed ${COLORS.line}`,
            }}>
              <p style={{ fontSize: 16 }}>{activeTab === "triage" ? "Aucun patient en attente de triage" : "Aucun patient trié pour le moment"}</p>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 14 }}>
              {filteredTickets.map((t) => {
                const p = PRIORITY_CONFIG[t.priority] || PRIORITY_CONFIG.normal;
                const isExpanded = expandedTicketId === t.id;
                const vitalsSummary = formatVitals(t);
                return (
                  <div key={t.id} style={{
                    border: `1px solid ${COLORS.line}`, borderLeft: `5px solid ${p.color}`, borderRadius: 10,
                    backgroundColor: COLORS.card, overflow: "hidden",
                  }}>
                    <div style={{ padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 14 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                        <span style={{
                          padding: "4px 11px", borderRadius: 20, fontSize: 11.5, fontWeight: 700,
                          color: p.color, backgroundColor: p.bg, border: `1.5px solid ${p.color}`, whiteSpace: "nowrap",
                        }}>
                          {p.emoji} {p.label}
                        </span>
                        <div>
                          <div style={{ fontWeight: 700, color: COLORS.ink, fontSize: 15.5 }}>
                            {t.ticketNumber} — {t.patientName}
                          </div>
                          <div style={{ fontSize: 13, color: COLORS.slate, marginTop: 2 }}>
                            {t.age} ans · {t.sex || "—"} {t.symptoms ? `· ${t.symptoms}` : ""}
                          </div>
                          {vitalsSummary && (
                            <div style={{ fontSize: 12.5, color: "#2E5C8C", marginTop: 4, fontWeight: 600 }}>
                              🩺 {vitalsSummary}
                            </div>
                          )}
                          {t.status === "no-show" && (
                            <div style={{ fontSize: 12.5, color: "#6c757d", marginTop: 4 }}>
                              ❌ Non présenté le {t.noShowAt ? new Date(t.noShowAt).toLocaleString("fr-FR") : ""}
                            </div>
                          )}
                          {t.status && t.status !== "waiting" && t.status !== "no-show" && (
                            <div style={{ fontSize: 12.5, color: COLORS.slate, marginTop: 4 }}>
                              Statut : {t.status === "ready" ? "🩺 Prêt pour médecin" : t.status === "in-progress" ? "🔄 En cours avec le médecin" : t.status === "completed" ? "✅ Complété" : t.status}
                            </div>
                          )}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        {t.status === "waiting" && !isExpanded && (
                          <>
                            <button onClick={() => openVitalsPanel(t)} style={actionBtnStyle("#2E7D8C")}>Prendre les constantes</button>
                            <button onClick={() => markNoShow(t)} style={actionBtnStyle("#6c757d")}>Non présenté</button>
                          </>
                        )}
                        {isExpanded && (
                          <button onClick={closeVitalsPanel} style={actionBtnStyle(COLORS.slate)}>Fermer</button>
                        )}
                      </div>
                    </div>

                    {isExpanded && (
                      <div style={{ padding: "18px 20px 22px", borderTop: `1px solid ${COLORS.line}`, backgroundColor: COLORS.paper }}>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 14 }}>
                          <VitalInput label="TA systolique (mmHg)" value={vitalsForm.bpSystolic} onChange={(v) => setVitalsForm((f) => ({ ...f, bpSystolic: v }))} />
                          <VitalInput label="TA diastolique (mmHg)" value={vitalsForm.bpDiastolic} onChange={(v) => setVitalsForm((f) => ({ ...f, bpDiastolic: v }))} />
                          <VitalInput label="Température (°C)" value={vitalsForm.temperature} onChange={(v) => setVitalsForm((f) => ({ ...f, temperature: v }))} step="0.1" />
                          <VitalInput label="Pouls (bpm)" value={vitalsForm.pulse} onChange={(v) => setVitalsForm((f) => ({ ...f, pulse: v }))} />
                          <VitalInput label="SpO₂ (%)" value={vitalsForm.spo2} onChange={(v) => setVitalsForm((f) => ({ ...f, spo2: v }))} />
                          <VitalInput label="Poids (kg)" value={vitalsForm.weightKg} onChange={(v) => setVitalsForm((f) => ({ ...f, weightKg: v }))} step="0.1" />
                          <VitalInput label="Taille (cm)" value={vitalsForm.heightCm} onChange={(v) => setVitalsForm((f) => ({ ...f, heightCm: v }))} />
                        </div>

                        <div style={{ marginBottom: 14 }}>
                          <label style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: COLORS.slate, marginBottom: 6 }}>
                            Notes cliniques (optionnel)
                          </label>
                          <textarea
                            value={vitalsForm.notes}
                            onChange={(e) => setVitalsForm((f) => ({ ...f, notes: e.target.value }))}
                            placeholder="Observations, allergies signalées, antécédents pertinents…"
                            style={{ ...fieldStyle, minHeight: 70, fontFamily: FONT_BODY, marginBottom: 0 }}
                          />
                        </div>

                        <div style={{ marginBottom: 16 }}>
                          <label style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: COLORS.slate, marginBottom: 6 }}>
                            Priorité (ajustable selon les constantes)
                          </label>
                          <div style={{ display: "flex", gap: 8 }}>
                            {Object.entries(PRIORITY_CONFIG).map(([key, cfg]) => (
                              <button
                                key={key}
                                onClick={() => setVitalsForm((f) => ({ ...f, priority: key }))}
                                style={{
                                  flex: 1, padding: "10px 8px", borderRadius: 6, cursor: "pointer",
                                  fontWeight: 700, fontSize: 13,
                                  border: vitalsForm.priority === key ? `2.5px solid ${cfg.color}` : `1.5px solid ${COLORS.line}`,
                                  backgroundColor: vitalsForm.priority === key ? cfg.bg : "#fff",
                                  color: cfg.color,
                                }}
                              >
                                {cfg.emoji} {cfg.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div style={{ display: "flex", gap: 10 }}>
                          <button
                            onClick={() => markReadyForDoctor(t)}
                            disabled={savingVitals}
                            style={{
                              flex: 1, padding: "12px", backgroundColor: COLORS.green, color: "white", border: "none",
                              borderRadius: 6, cursor: savingVitals ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 14.5,
                              opacity: savingVitals ? 0.7 : 1,
                            }}
                          >
                            {savingVitals ? "Enregistrement…" : "🩺 Marquer prêt pour médecin"}
                          </button>
                          <button onClick={() => markNoShow(t)} style={{ padding: "12px 20px", backgroundColor: "#6c757d", color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 14.5 }}>
                            Non présenté
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          </>
          )}
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

function VitalInput({ label, value, onChange, step }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: COLORS.slate, marginBottom: 4 }}>{label}</label>
      <input
        type="number"
        step={step || "1"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...fieldStyle, marginBottom: 0 }}
      />
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
  whiteSpace: "nowrap",
});