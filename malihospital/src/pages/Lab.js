import { useState, useEffect, useRef } from "react";
import { auth, db, functions } from "../firebase";
import { doc, getDoc, collection, query, where, onSnapshot, updateDoc, runTransaction } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import NotificationsBanner from "../components/NotificationsBanner";

const COLORS = {
  green: "#14B53A", gold: "#FCD116", red: "#CE1126", ink: "#1B2A1F",
  slate: "#5B6B63", paper: "#FAF9F5", card: "#FFFFFF", line: "#E6E2D8",
  successBg: "#E9F7EC", successText: "#1E7B34",
  warnBg: "#FDF3E3", warnText: "#8A5A00",
};
const FONT_DISPLAY = "'Georgia', 'Iowan Old Style', 'Times New Roman', serif";
const FONT_BODY = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

const STATUS_FLOW = ["pending", "in_progress", "completed"];
const STATUS_LABELS = { pending: "En attente", in_progress: "En cours", completed: "Terminée" };
const STATUS_COLORS = {
  pending: { bg: COLORS.warnBg, text: COLORS.warnText },
  in_progress: { bg: "#E8F0FB", text: "#2E5C8C" },
  completed: { bg: COLORS.successBg, text: COLORS.successText },
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

export default function Lab() {
  const [userData, setUserData] = useState(null);
  const [facilityName, setFacilityName] = useState("");
  const [pageLoading, setPageLoading] = useState(true);
  const [requests, setRequests] = useState([]);
  const [filterStatus, setFilterStatus] = useState("active"); // active | completed | all
  const [phoneSearch, setPhoneSearch] = useState("");
  const [mainTab, setMainTab] = useState("requests"); // requests | tests
  const [testMenu, setTestMenu] = useState([]);
  const [newTestForm, setNewTestForm] = useState({ name: "", category: "", sampleType: "", turnaroundTime: "" });
  const [addingTest, setAddingTest] = useState(false);
  const [enteringResultsFor, setEnteringResultsFor] = useState(null);
  const [resultDrafts, setResultDrafts] = useState({});
  const testMenuUnsubRef = useRef(null);
  const nav = useNavigate();
  const unsubRef = useRef(null);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user) checkAuthAndLoad();
      else {
        if (unsubRef.current) unsubRef.current();
        if (testMenuUnsubRef.current) testMenuUnsubRef.current();
        nav("/");
      }
    });
    return () => {
      unsubscribe();
      if (unsubRef.current) unsubRef.current();
      if (testMenuUnsubRef.current) testMenuUnsubRef.current();
    };
  }, [nav]);

  const checkAuthAndLoad = async () => {
    if (!auth.currentUser) return nav("/");
    let userSnap;
    try {
      userSnap = await getDoc(doc(db, "users", auth.currentUser.uid));
    } catch (e) {
      alert("Erreur de chargement (profil utilisateur): " + e.message);
      setPageLoading(false);
      return;
    }
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
    if (user.role !== "lab") {
      alert("❌ Accès refusé. Cette page est réservée au personnel de laboratoire.");
      await signOut(auth);
      nav("/");
      return;
    }
    if (!user.facilityId) {
      alert("❌ Votre compte n'est rattaché à aucun laboratoire. Contactez l'administrateur.");
      await signOut(auth);
      nav("/");
      return;
    }
    let facilitySnap;
    try {
      facilitySnap = await getDoc(doc(db, "labs", user.facilityId));
    } catch (e) {
      alert("Erreur de chargement (fiche du laboratoire): " + e.message);
      setPageLoading(false);
      return;
    }
    if (!facilitySnap.exists() || facilitySnap.data().active === false) {
      alert("❌ Ce laboratoire a été désactivé.");
      await signOut(auth);
      nav("/");
      return;
    }
    setFacilityName(facilitySnap.data().name);
    setUserData(user);
    loadRequests(user);
    loadTestMenu(user);
    setPageLoading(false);
  };

  const loadRequests = (user) => {
    const q = query(collection(db, "labRequests"), where("labId", "==", user.facilityId));
    unsubRef.current = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      setRequests(list);
    }, (e) => console.error("Error loading lab requests:", e));
  };

  const loadTestMenu = (user) => {
    const q = query(collection(db, "labTests"), where("facilityId", "==", user.facilityId));
    testMenuUnsubRef.current = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      setTestMenu(list);
    }, (e) => console.error("Error loading test menu:", e));
  };

  // Moving to "in_progress" is a routine status click, same as pharmacy.
  // Moving to "completed" is different — it requires actual results, text
  // only (no file uploads, per the earlier decision that patients bring
  // physical images themselves), so that transition opens an inline
  // entry form instead of firing immediately.
  const advanceStatus = async (request) => {
    const currentIndex = STATUS_FLOW.indexOf(request.status);
    const nextStatus = STATUS_FLOW[currentIndex + 1];
    if (!nextStatus) return;
    if (nextStatus === "completed") {
      setEnteringResultsFor(request.id);
      const drafts = {};
      request.tests.forEach((t, i) => { drafts[i] = t.result || ""; });
      setResultDrafts(drafts);
      return;
    }
    try {
      const updates = { status: nextStatus };
      updates[`${nextStatus}At`] = new Date().toISOString();
      updates[`${nextStatus}By`] = auth.currentUser.uid;
      await updateDoc(doc(db, "labRequests", request.id), updates);
    } catch (e) {
      alert("❌ Erreur: " + e.message);
    }
  };

  const confirmResults = async (request) => {
    const hasEmpty = request.tests.some((_, i) => !(resultDrafts[i] || "").trim());
    if (hasEmpty && !window.confirm("Au moins un résultat est vide. Confirmer quand même ?")) return;
    try {
      const updatedTests = request.tests.map((t, i) => ({ ...t, result: (resultDrafts[i] || "").trim() }));
      await updateDoc(doc(db, "labRequests", request.id), {
        tests: updatedTests,
        status: "completed",
        completedAt: new Date().toISOString(),
        completedBy: auth.currentUser.uid,
      });
      setEnteringResultsFor(null);
      setResultDrafts({});

      // Notify the specific doctor who sent this request — non-fatal if
      // it fails, since the results themselves are already safely saved
      // either way; the doctor can still find them by reopening the
      // patient's Analyse modal even without the notification.
      if (request.doctorId) {
        try {
          const notify = httpsCallable(functions, "broadcastNotification");
          await notify({
            targetUserId: request.doctorId,
            title: "🧪 Résultats d'analyse disponibles",
            message: `Résultats prêts pour ${request.patientName} (${updatedTests.map((t) => t.name).join(", ")}) — ${facilityName}.`,
            severity: "info",
          });
        } catch (e) {
          console.warn("Could not notify doctor of results (non-fatal):", e);
        }
      }
    } catch (e) {
      alert("❌ Erreur: " + e.message);
    }
  };

  // Atomic per-lab Test ID (TEST-000001, etc., scoped to just this
  // facility's own counter) — same transaction pattern used for
  // pharmacy's Medicine ID.
  const addTest = async () => {
    const { name, category, sampleType, turnaroundTime } = newTestForm;
    if (!name.trim()) return alert("❌ Le nom de l'analyse est obligatoire.");
    setAddingTest(true);
    try {
      const counterRef = doc(db, "labTestCounters", userData.facilityId);
      const testRef = doc(collection(db, "labTests"));
      await runTransaction(db, async (tx) => {
        const counterSnap = await tx.get(counterRef);
        const nextNumber = (counterSnap.exists() ? (counterSnap.data().count || 0) : 0) + 1;
        const labTestId = `TEST-${String(nextNumber).padStart(6, "0")}`;
        tx.set(counterRef, { count: nextNumber }, { merge: true });
        tx.set(testRef, {
          facilityType: userData.facilityType,
          facilityId: userData.facilityId,
          labTestId,
          name: name.trim(),
          category: category.trim(),
          sampleType: sampleType.trim(),
          turnaroundTime: turnaroundTime.trim(),
          active: true,
          createdAt: new Date().toISOString(),
          createdBy: auth.currentUser.uid,
        });
      });
      setNewTestForm({ name: "", category: "", sampleType: "", turnaroundTime: "" });
    } catch (e) {
      alert("❌ Erreur: " + e.message);
    }
    setAddingTest(false);
  };

  const toggleTestActive = async (test) => {
    try {
      await updateDoc(doc(db, "labTests", test.id), { active: !test.active });
    } catch (e) {
      alert("❌ Erreur: " + e.message);
    }
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

  const filtered = requests.filter((r) => {
    if (filterStatus === "active" && r.status === "completed") return false;
    if (filterStatus === "completed" && r.status !== "completed") return false;
    if (phoneSearch.trim()) {
      const term = phoneSearch.trim().toLowerCase();
      const digits = phoneSearch.replace(/\s+/g, "");
      const patientDigits = (r.patientPhone || "").replace(/\s+/g, "");
      const matchesPhone = patientDigits.includes(digits);
      const matchesId = (r.patientId || "").toLowerCase().includes(term);
      const matchesName = (r.patientName || "").toLowerCase().includes(term);
      if (!matchesPhone && !matchesId && !matchesName) return false;
    }
    return true;
  });
  const activeCount = requests.filter((r) => r.status !== "completed").length;

  return (
    <div style={{ minHeight: "100vh", background: COLORS.paper, fontFamily: FONT_BODY }}>
      <div style={{ height: 6, display: "flex" }}>
        <div style={{ flex: 1, background: COLORS.green }} />
        <div style={{ flex: 1, background: COLORS.gold }} />
        <div style={{ flex: 1, background: COLORS.red }} />
      </div>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "26px 0 22px 0", borderBottom: `1px solid ${COLORS.line}`, gap: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <MaliFlag width={54} height={37} style={{ borderRadius: 3, boxShadow: "0 1px 3px rgba(0,0,0,0.18)" }} />
            <div>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 12, letterSpacing: "0.14em", color: COLORS.slate, textTransform: "uppercase" }}>République du Mali</div>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 21, fontWeight: 700, color: COLORS.ink, marginTop: 6 }}>{facilityName}</div>
              <div style={{ fontSize: 13.5, color: COLORS.slate, marginTop: 4 }}>🧪 Laboratoire</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 13, color: COLORS.slate }}>Connecté en tant que</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.ink }}>{userData.firstName} {userData.lastName}</div>
            </div>
            <button onClick={logout} style={{ padding: "10px 20px", backgroundColor: "transparent", color: COLORS.red, border: `1.5px solid ${COLORS.red}`, borderRadius: 6, cursor: "pointer", fontSize: 14, fontWeight: 600 }}>
              Déconnexion
            </button>
          </div>
        </div>

        <div style={{ marginTop: 20 }}>
          <NotificationsBanner hospitalId={null} />
        </div>

        <div style={{ display: "flex", gap: 4, marginTop: 20, borderBottom: `2px solid ${COLORS.line}` }}>
          {["requests", "tests"].map((tab) => (
            <button key={tab} onClick={() => setMainTab(tab)}
              style={{
                padding: "13px 22px", border: "none", background: "none", cursor: "pointer",
                fontSize: 15, fontWeight: mainTab === tab ? 700 : 500,
                color: mainTab === tab ? COLORS.ink : COLORS.slate,
                borderBottom: mainTab === tab ? `3px solid ${COLORS.ink}` : "3px solid transparent",
                marginBottom: -2,
              }}>
              {tab === "requests" ? "📋 Demandes" : "🧪 Analyses"}
            </button>
          ))}
        </div>

        {mainTab === "requests" && (
          <>
        <div style={{ display: "flex", gap: 4, marginTop: 20, borderBottom: `2px solid ${COLORS.line}` }}>
          {["active", "completed", "all"].map((tab) => (
            <button key={tab} onClick={() => setFilterStatus(tab)}
              style={{
                padding: "13px 22px", border: "none", background: "none", cursor: "pointer",
                fontSize: 15, fontWeight: filterStatus === tab ? 700 : 500,
                color: filterStatus === tab ? "#2E5C8C" : COLORS.slate,
                borderBottom: filterStatus === tab ? "3px solid #2E5C8C" : "3px solid transparent",
                marginBottom: -2,
              }}>
              {tab === "active" ? `En cours (${activeCount})` : tab === "completed" ? "Terminées" : "Toutes"}
            </button>
          ))}
        </div>

        <div style={{ marginTop: 18 }}>
          <input
            type="text"
            placeholder="🔍 Rechercher par téléphone, identifiant patient ou nom…"
            value={phoneSearch}
            onChange={(e) => setPhoneSearch(e.target.value)}
            style={{
              width: "100%", maxWidth: 420, padding: "11px 16px", borderRadius: 8,
              border: `1px solid ${COLORS.line}`, fontSize: 14, boxSizing: "border-box",
              fontFamily: FONT_BODY,
            }}
          />
          {phoneSearch.trim() && (
            <span style={{ marginLeft: 10, fontSize: 12.5, color: COLORS.slate }}>
              {filtered.length} résultat{filtered.length === 1 ? "" : "s"}
            </span>
          )}
        </div>

        <div style={{ padding: "20px 0 50px" }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 40, backgroundColor: COLORS.card, borderRadius: 10, textAlign: "center", color: COLORS.slate, border: `1.5px dashed ${COLORS.line}` }}>
              {phoneSearch.trim()
                ? "Aucune demande ne correspond à ce numéro."
                : `Aucune demande ${filterStatus === "active" ? "en cours" : filterStatus === "completed" ? "terminée" : ""} pour l'instant.`}
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {filtered.map((r) => {
                const sc = STATUS_COLORS[r.status] || STATUS_COLORS.pending;
                const nextStatus = STATUS_FLOW[STATUS_FLOW.indexOf(r.status) + 1];
                const isEnteringResults = enteringResultsFor === r.id;
                return (
                  <div key={r.id} style={{ padding: 20, backgroundColor: COLORS.card, borderRadius: 10, border: `1px solid ${COLORS.line}`, borderLeft: `5px solid ${sc.text}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                          <div style={{ fontWeight: 700, color: COLORS.ink, fontSize: 16 }}>{r.patientName}</div>
                          {r.patientId && (
                            <div style={{ fontSize: 12, color: COLORS.slate }}>{r.patientId}</div>
                          )}
                          {r.patientPhone && (
                            <div style={{ fontSize: 13.5, color: "#2E5C8C", fontWeight: 700 }}>📞 {r.patientPhone}</div>
                          )}
                        </div>
                        <div style={{ fontSize: 12.5, color: COLORS.slate, marginTop: 3 }}>
                          Demandé par {r.doctorName} · {r.createdAt ? new Date(r.createdAt).toLocaleString("fr-FR") : ""}
                        </div>
                        {r.diagnosis && (
                          <div style={{ fontSize: 12.5, color: "#2E5C8C", marginTop: 3 }}>🩺 {r.diagnosis}</div>
                        )}
                      </div>
                      <span style={{ padding: "5px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700, backgroundColor: sc.bg, color: sc.text }}>
                        {STATUS_LABELS[r.status] || r.status}
                      </span>
                    </div>

                    <div style={{ marginTop: 14, display: "grid", gap: 6 }}>
                      {r.tests.map((t, i) => (
                        <div key={i} style={{ padding: "8px 12px", backgroundColor: COLORS.paper, borderRadius: 6, fontSize: 13.5 }}>
                          <strong>{t.name}</strong>{t.sampleType ? ` — ${t.sampleType}` : ""}
                          {t.notes && <div style={{ color: COLORS.slate, fontSize: 12.5, marginTop: 2 }}>{t.notes}</div>}
                          {isEnteringResults ? (
                            <textarea
                              placeholder="Résultat…"
                              value={resultDrafts[i] || ""}
                              onChange={(e) => setResultDrafts((d) => ({ ...d, [i]: e.target.value }))}
                              rows={2}
                              style={{ width: "100%", marginTop: 6, padding: "8px 10px", borderRadius: 5, border: `1px solid ${COLORS.line}`, fontSize: 13, boxSizing: "border-box", resize: "vertical", fontFamily: FONT_BODY }}
                            />
                          ) : t.result ? (
                            <div style={{ marginTop: 6, padding: "6px 10px", backgroundColor: "#E9F7EC", borderRadius: 5, fontSize: 12.5 }}>
                              <strong>Résultat :</strong> {t.result}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>

                    {isEnteringResults ? (
                      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                        <button onClick={() => confirmResults(r)} style={{ padding: "10px 18px", backgroundColor: "#2E5C8C", color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 13.5 }}>
                          Confirmer les résultats
                        </button>
                        <button onClick={() => { setEnteringResultsFor(null); setResultDrafts({}); }} style={{ padding: "10px 18px", backgroundColor: "transparent", color: COLORS.slate, border: `1px solid ${COLORS.line}`, borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13.5 }}>
                          Annuler
                        </button>
                      </div>
                    ) : nextStatus && (
                      <button onClick={() => advanceStatus(r)} style={{
                        marginTop: 14, padding: "10px 18px", backgroundColor: "#2E5C8C", color: "white", border: "none",
                        borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 13.5,
                      }}>
                        {nextStatus === "completed" ? "Saisir les résultats" : `Marquer « ${STATUS_LABELS[nextStatus]} »`}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
          </>
        )}

        {mainTab === "tests" && (
          <div style={{ padding: "24px 0 50px" }}>
            <div style={{ padding: 20, marginBottom: 24, backgroundColor: COLORS.card, borderRadius: 10, border: `1px solid ${COLORS.line}`, borderTop: "4px solid " + COLORS.gold }}>
              <div style={{ fontWeight: 700, color: COLORS.ink, marginBottom: 14, fontSize: 14.5 }}>Ajouter une analyse au menu</div>
              <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr auto", gap: 10 }}>
                <input placeholder="Nom de l'analyse *" value={newTestForm.name} onChange={(e) => setNewTestForm({ ...newTestForm, name: e.target.value })} disabled={addingTest} style={testFieldStyle} />
                <input placeholder="Catégorie (ex: Hématologie)" value={newTestForm.category} onChange={(e) => setNewTestForm({ ...newTestForm, category: e.target.value })} disabled={addingTest} style={testFieldStyle} />
                <input placeholder="Type d'échantillon" value={newTestForm.sampleType} onChange={(e) => setNewTestForm({ ...newTestForm, sampleType: e.target.value })} disabled={addingTest} style={testFieldStyle} />
                <input placeholder="Délai (ex: 24h)" value={newTestForm.turnaroundTime} onChange={(e) => setNewTestForm({ ...newTestForm, turnaroundTime: e.target.value })} disabled={addingTest} style={testFieldStyle} />
                <button onClick={addTest} disabled={addingTest} style={{
                  padding: "10px 20px", backgroundColor: COLORS.green, color: "white", border: "none",
                  borderRadius: 6, cursor: addingTest ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 13.5,
                  opacity: addingTest ? 0.7 : 1, whiteSpace: "nowrap",
                }}>
                  {addingTest ? "Ajout…" : "+ Ajouter"}
                </button>
              </div>
            </div>

            {testMenu.length === 0 ? (
              <div style={{ padding: 40, backgroundColor: COLORS.card, borderRadius: 10, textAlign: "center", color: COLORS.slate, border: `1.5px dashed ${COLORS.line}` }}>
                Aucune analyse au menu pour l'instant.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {testMenu.map((test) => (
                  <div key={test.id} style={{
                    padding: "14px 18px", backgroundColor: test.active ? COLORS.card : "#FCF3F3", borderRadius: 10, border: `1px solid ${COLORS.line}`,
                    display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12,
                  }}>
                    <div>
                      <div style={{ fontWeight: 700, color: COLORS.ink, fontSize: 15 }}>
                        {test.name} {!test.active && <span style={{ color: COLORS.red, fontSize: 11 }}>(désactivée)</span>}
                      </div>
                      <div style={{ fontSize: 11.5, color: COLORS.slate, marginTop: 2 }}>
                        {test.labTestId} · {test.category || "—"} · {test.sampleType || "—"}{test.turnaroundTime ? ` · ${test.turnaroundTime}` : ""}
                      </div>
                    </div>
                    <button onClick={() => toggleTestActive(test)} style={{ padding: "6px 14px", backgroundColor: test.active ? "#6c757d" : COLORS.green, color: "white", border: "none", borderRadius: 5, cursor: "pointer", fontWeight: 700, fontSize: 12.5 }}>
                      {test.active ? "Désactiver" : "Réactiver"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ borderTop: `1px solid ${COLORS.line}`, padding: "18px 0", textAlign: "center", fontSize: 12.5, color: COLORS.slate }}>
          République du Mali — Ministère de la Santé · Système de gestion hospitalière
        </div>
      </div>
    </div>
  );
}

const testFieldStyle = {
  width: "100%", padding: "9px 12px", borderRadius: 6,
  border: "1px solid #E6E2D8", fontSize: 13.5, boxSizing: "border-box",
  fontFamily: "'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
};