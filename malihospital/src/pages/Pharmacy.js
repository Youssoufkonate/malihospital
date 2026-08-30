import { useState, useEffect, useRef } from "react";
import ChangePassword from "./ChangePassword";
import SessionsButton from "../components/SessionsButton";
import { auth, db } from "../firebase";
import { doc, getDoc, collection, query, where, onSnapshot, updateDoc, runTransaction } from "firebase/firestore";
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

const STATUS_FLOW = ["pending", "preparing", "ready", "collected"];
const STATUS_LABELS = { pending: "En attente", preparing: "En préparation", ready: "Prête", collected: "Remise au patient" };
const STATUS_COLORS = {
  pending: { bg: COLORS.warnBg, text: COLORS.warnText },
  preparing: { bg: "#E8F0FB", text: "#2E5C8C" },
  ready: { bg: COLORS.successBg, text: COLORS.successText },
  collected: { bg: "#EDECE7", text: COLORS.slate },
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

export default function Pharmacy() {
  const [userData, setUserData] = useState(null);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [facilityName, setFacilityName] = useState("");
  const [pageLoading, setPageLoading] = useState(true);
  const [prescriptions, setPrescriptions] = useState([]);
  const [filterStatus, setFilterStatus] = useState("active"); // active | collected | all
  const [phoneSearch, setPhoneSearch] = useState("");
  const [mainTab, setMainTab] = useState("prescriptions"); // prescriptions | inventory
  const [inventory, setInventory] = useState([]);
  const [newInventoryForm, setNewInventoryForm] = useState({
    genericName: "", brandNames: "", activeIngredients: "", therapeuticCategory: "",
    atcCode: "", dosageForm: "Comprimé", strength: "", route: "Orale",
    prescriptionRequired: true, storageConditions: "", commonIndications: "",
    quantityAvailable: "", minimumStockLevel: "10", expirationDate: "",
  });
  const [addingInventory, setAddingInventory] = useState(false);
  const inventoryUnsubRef = useRef(null);
  const nav = useNavigate();
  const unsubRef = useRef(null);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user) checkAuthAndLoad();
      else {
        if (unsubRef.current) unsubRef.current();
        if (inventoryUnsubRef.current) inventoryUnsubRef.current();
        nav("/");
      }
    });
    return () => {
      unsubscribe();
      if (unsubRef.current) unsubRef.current();
      if (inventoryUnsubRef.current) inventoryUnsubRef.current();
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
        alert("❌ Votre compte a été désactivé.");
        await signOut(auth);
        nav("/");
        return;
      }
      if (user.role !== "pharmacy") {
        alert("❌ Accès refusé. Cette page est réservée au personnel de pharmacie.");
        await signOut(auth);
        nav("/");
        return;
      }
      if (!user.facilityId) {
        alert("❌ Votre compte n'est rattaché à aucune pharmacie. Contactez l'administrateur.");
        await signOut(auth);
        nav("/");
        return;
      }
      const facilitySnap = await getDoc(doc(db, "pharmacies", user.facilityId));
      if (!facilitySnap.exists() || facilitySnap.data().active === false) {
        alert("❌ Cette pharmacie a été désactivée.");
        await signOut(auth);
        nav("/");
        return;
      }
      setFacilityName(facilitySnap.data().name);
      setUserData(user);
      loadPrescriptions(user);
      loadInventory(user);
      setPageLoading(false);
    } catch (e) {
      alert("Erreur de chargement: " + e.message);
      setPageLoading(false);
    }
  };

  const loadPrescriptions = (user) => {
    const q = query(collection(db, "prescriptions"), where("pharmacyId", "==", user.facilityId));
    unsubRef.current = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      setPrescriptions(list);
    }, (e) => console.error("Error loading prescriptions:", e));
  };

  const loadInventory = (user) => {
    const q = query(collection(db, "inventory"), where("facilityId", "==", user.facilityId));
    inventoryUnsubRef.current = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => (a.genericName || "").localeCompare(b.genericName || ""));
      setInventory(list);
    }, (e) => console.error("Error loading inventory:", e));
  };

  const advanceStatus = async (prescription) => {
    const currentIndex = STATUS_FLOW.indexOf(prescription.status);
    const nextStatus = STATUS_FLOW[currentIndex + 1];
    if (!nextStatus) return;
    try {
      const updates = { status: nextStatus };
      updates[`${nextStatus}At`] = new Date().toISOString();
      updates[`${nextStatus}By`] = auth.currentUser.uid;
      await updateDoc(doc(db, "prescriptions", prescription.id), updates);

      if (nextStatus === "collected") {
        await deductInventoryForPrescription(prescription);
      }
    } catch (e) {
      alert("❌ Erreur: " + e.message);
    }
  };

  // Best-effort — never blocks marking a prescription as delivered, even
  // if a specific line can't be matched to inventory. Only medications the
  // doctor actually picked from this pharmacy's own list (medicineId set,
  // and it directly IS that inventory document's own ID now — no separate
  // lookup needed) can be auto-deducted; free-typed ones are skipped since
  // there's nothing to match against. Quantity is a free-text field on the
  // prescription (e.g. "20 comprimés"), so this extracts the leading
  // number — if that fails, that line is skipped rather than guessed at.
  const deductInventoryForPrescription = async (prescription) => {
    for (const med of prescription.medications || []) {
      if (!med.medicineId) continue;
      const match = (med.quantity || "").match(/\d+/);
      if (!match) continue;
      const amount = parseInt(match[0], 10);
      if (!amount || amount <= 0) continue;

      try {
        const invRef = doc(db, "inventory", med.medicineId);
        await runTransaction(db, async (tx) => {
          const snap = await tx.get(invRef);
          if (!snap.exists()) return; // stock entry may have since been removed — skip, don't fail the whole delivery
          const current = snap.data().quantityAvailable || 0;
          tx.update(invRef, { quantityAvailable: Math.max(0, current - amount), updatedAt: new Date().toISOString() });
        });
      } catch (e) {
        console.warn(`Could not auto-deduct inventory for ${med.name}:`, e);
      }
    }
  };

  // Atomic per-pharmacy Medicine ID (MED-000001, etc., scoped to just this
  // facility's own counter) — same transaction pattern used for patient
  // IDs and ticket numbers, so two staff adding stock at the same moment
  // can never collide on the same ID.
  const addInventoryItem = async () => {
    const {
      genericName, brandNames, activeIngredients, therapeuticCategory, atcCode,
      dosageForm, strength, route, prescriptionRequired, storageConditions, commonIndications,
      quantityAvailable, minimumStockLevel, expirationDate,
    } = newInventoryForm;
    if (!genericName.trim()) return alert("❌ Le nom générique est obligatoire.");
    if (quantityAvailable === "" || Number(quantityAvailable) < 0) return alert("❌ Quantité invalide.");

    setAddingInventory(true);
    try {
      const counterRef = doc(db, "inventoryCounters", userData.facilityId);
      const invRef = doc(collection(db, "inventory"));
      await runTransaction(db, async (tx) => {
        const counterSnap = await tx.get(counterRef);
        const nextNumber = (counterSnap.exists() ? (counterSnap.data().count || 0) : 0) + 1;
        const medicineId = `MED-${String(nextNumber).padStart(6, "0")}`;
        tx.set(counterRef, { count: nextNumber }, { merge: true });
        tx.set(invRef, {
          facilityType: userData.facilityType,
          facilityId: userData.facilityId,
          medicineId,
          genericName: genericName.trim(),
          brandNames: brandNames.split(",").map((s) => s.trim()).filter(Boolean),
          activeIngredients: activeIngredients.split(",").map((s) => s.trim()).filter(Boolean),
          therapeuticCategory: therapeuticCategory.trim(),
          atcCode: atcCode.trim(),
          dosageForm,
          strength: strength.trim(),
          route,
          prescriptionRequired,
          storageConditions: storageConditions.trim(),
          commonIndications: commonIndications.trim(),
          quantityAvailable: Number(quantityAvailable),
          minimumStockLevel: Number(minimumStockLevel) || 0,
          expirationDate: expirationDate || null,
          createdAt: new Date().toISOString(),
          createdBy: auth.currentUser.uid,
          lastRestockedAt: new Date().toISOString(),
          lastRestockedBy: auth.currentUser.uid,
        });
      });
      setNewInventoryForm({
        genericName: "", brandNames: "", activeIngredients: "", therapeuticCategory: "",
        atcCode: "", dosageForm: "Comprimé", strength: "", route: "Orale",
        prescriptionRequired: true, storageConditions: "", commonIndications: "",
        quantityAvailable: "", minimumStockLevel: "10", expirationDate: "",
      });
    } catch (e) {
      alert("❌ Erreur: " + e.message);
    }
    setAddingInventory(false);
  };

  const restockItem = async (item) => {
    const input = window.prompt(`Ajouter combien d'unités à "${item.genericName}" (stock actuel : ${item.quantityAvailable}) ?`);
    if (input === null) return;
    const amount = parseInt(input, 10);
    if (!amount || amount <= 0) return alert("❌ Quantité invalide.");
    try {
      await runTransaction(db, async (tx) => {
        const ref = doc(db, "inventory", item.id);
        const snap = await tx.get(ref);
        if (!snap.exists()) return;
        const current = snap.data().quantityAvailable || 0;
        tx.update(ref, { quantityAvailable: current + amount, lastRestockedAt: new Date().toISOString(), lastRestockedBy: auth.currentUser.uid });
      });
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

  const filtered = prescriptions.filter((p) => {
    if (filterStatus === "active" && p.status === "collected") return false;
    if (filterStatus === "collected" && p.status !== "collected") return false;
    if (phoneSearch.trim()) {
      const term = phoneSearch.trim().toLowerCase();
      const digits = phoneSearch.replace(/\s+/g, "");
      const patientDigits = (p.patientPhone || "").replace(/\s+/g, "");
      const matchesPhone = patientDigits.includes(digits);
      const matchesId = (p.patientId || "").toLowerCase().includes(term);
      const matchesName = (p.patientName || "").toLowerCase().includes(term);
      if (!matchesPhone && !matchesId && !matchesName) return false;
    }
    return true;
  });
  const activeCount = prescriptions.filter((p) => p.status !== "collected").length;

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
              <div style={{ fontSize: 13.5, color: COLORS.slate, marginTop: 4 }}>💊 Pharmacie</div>
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
          <NotificationsBanner hospitalId={null} />
        </div>

        <div style={{ display: "flex", gap: 4, marginTop: 20, borderBottom: `2px solid ${COLORS.line}` }}>
          {["prescriptions", "inventory"].map((tab) => (
            <button key={tab} onClick={() => setMainTab(tab)}
              style={{
                padding: "13px 22px", border: "none", background: "none", cursor: "pointer",
                fontSize: 15, fontWeight: mainTab === tab ? 700 : 500,
                color: mainTab === tab ? COLORS.ink : COLORS.slate,
                borderBottom: mainTab === tab ? `3px solid ${COLORS.ink}` : "3px solid transparent",
                marginBottom: -2,
              }}>
              {tab === "prescriptions" ? "📋 Ordonnances" : "📦 Inventaire"}
            </button>
          ))}
        </div>

        {mainTab === "prescriptions" && (
          <>
        <div style={{ display: "flex", gap: 4, marginTop: 20, borderBottom: `2px solid ${COLORS.line}` }}>
          {["active", "collected", "all"].map((tab) => (
            <button key={tab} onClick={() => setFilterStatus(tab)}
              style={{
                padding: "13px 22px", border: "none", background: "none", cursor: "pointer",
                fontSize: 15, fontWeight: filterStatus === tab ? 700 : 500,
                color: filterStatus === tab ? "#0F7A6E" : COLORS.slate,
                borderBottom: filterStatus === tab ? "3px solid #0F7A6E" : "3px solid transparent",
                marginBottom: -2,
              }}>
              {tab === "active" ? `En cours (${activeCount})` : tab === "collected" ? "Remises" : "Toutes"}
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
                ? "Aucune ordonnance ne correspond à ce numéro."
                : `Aucune ordonnance ${filterStatus === "active" ? "en cours" : filterStatus === "collected" ? "remise" : ""} pour l'instant.`}
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {filtered.map((p) => {
                const sc = STATUS_COLORS[p.status] || STATUS_COLORS.pending;
                const nextStatus = STATUS_FLOW[STATUS_FLOW.indexOf(p.status) + 1];
                return (
                  <div key={p.id} style={{ padding: 20, backgroundColor: COLORS.card, borderRadius: 10, border: `1px solid ${COLORS.line}`, borderLeft: `5px solid ${sc.text}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                          <div style={{ fontWeight: 700, color: COLORS.ink, fontSize: 16 }}>{p.patientName}</div>
                          {p.patientId && (
                            <div style={{ fontSize: 12, color: COLORS.slate }}>{p.patientId}</div>
                          )}
                          {p.patientPhone && (
                            <div style={{ fontSize: 13.5, color: "#0F7A6E", fontWeight: 700 }}>📞 {p.patientPhone}</div>
                          )}
                        </div>
                        <div style={{ fontSize: 12.5, color: COLORS.slate, marginTop: 3 }}>
                          Prescrit par {p.doctorName} · {p.createdAt ? new Date(p.createdAt).toLocaleString("fr-FR") : ""}
                        </div>
                        {p.diagnosis && (
                          <div style={{ fontSize: 12.5, color: "#2E5C8C", marginTop: 3 }}>🩺 {p.diagnosis}</div>
                        )}
                      </div>
                      <span style={{ padding: "5px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700, backgroundColor: sc.bg, color: sc.text }}>
                        {STATUS_LABELS[p.status] || p.status}
                      </span>
                    </div>

                    <div style={{ marginTop: 14, display: "grid", gap: 6 }}>
                      {p.medications.map((m, i) => (
                        <div key={i} style={{ padding: "8px 12px", backgroundColor: COLORS.paper, borderRadius: 6, fontSize: 13.5 }}>
                          <strong>{m.name}</strong>{m.dosage ? ` — ${m.dosage}` : ""}{m.quantity ? ` · Qté: ${m.quantity}` : ""}{m.duration ? ` · ${m.duration}` : ""}
                          {m.instructions && <div style={{ color: COLORS.slate, fontSize: 12.5, marginTop: 2 }}>{m.instructions}</div>}
                        </div>
                      ))}
                    </div>

                    {nextStatus && (
                      <button onClick={() => advanceStatus(p)} style={{
                        marginTop: 14, padding: "10px 18px", backgroundColor: "#0F7A6E", color: "white", border: "none",
                        borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 13.5,
                      }}>
                        Marquer « {STATUS_LABELS[nextStatus]} »
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

        {mainTab === "inventory" && (
          <div style={{ padding: "24px 0 50px" }}>
            <div style={{ padding: 20, marginBottom: 24, backgroundColor: COLORS.card, borderRadius: 10, border: `1px solid ${COLORS.line}`, borderTop: "4px solid " + COLORS.gold }}>
              <div style={{ fontWeight: 700, color: COLORS.ink, marginBottom: 14, fontSize: 14.5 }}>Ajouter un médicament au stock</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <input placeholder="Nom générique *" value={newInventoryForm.genericName} onChange={(e) => setNewInventoryForm({ ...newInventoryForm, genericName: e.target.value })} disabled={addingInventory} style={inventoryFieldStyle} />
                <input placeholder="Noms commerciaux (séparés par des virgules)" value={newInventoryForm.brandNames} onChange={(e) => setNewInventoryForm({ ...newInventoryForm, brandNames: e.target.value })} disabled={addingInventory} style={inventoryFieldStyle} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <input placeholder="Principe(s) actif(s) (séparés par des virgules)" value={newInventoryForm.activeIngredients} onChange={(e) => setNewInventoryForm({ ...newInventoryForm, activeIngredients: e.target.value })} disabled={addingInventory} style={inventoryFieldStyle} />
                <input placeholder="Catégorie thérapeutique" value={newInventoryForm.therapeuticCategory} onChange={(e) => setNewInventoryForm({ ...newInventoryForm, therapeuticCategory: e.target.value })} disabled={addingInventory} style={inventoryFieldStyle} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <input placeholder="Code ATC" value={newInventoryForm.atcCode} onChange={(e) => setNewInventoryForm({ ...newInventoryForm, atcCode: e.target.value })} disabled={addingInventory} style={inventoryFieldStyle} />
                <select value={newInventoryForm.dosageForm} onChange={(e) => setNewInventoryForm({ ...newInventoryForm, dosageForm: e.target.value })} disabled={addingInventory} style={inventoryFieldStyle}>
                  {["Comprimé", "Gélule", "Sirop", "Injection", "Inhalateur", "Sachet (à diluer)", "Pommade", "Suppositoire", "Solution"].map((d) => (<option key={d}>{d}</option>))}
                </select>
                <select value={newInventoryForm.route} onChange={(e) => setNewInventoryForm({ ...newInventoryForm, route: e.target.value })} disabled={addingInventory} style={inventoryFieldStyle}>
                  {["Orale", "Intraveineuse", "Intramusculaire", "Sous-cutanée", "Inhalation", "Topique", "Rectale"].map((r) => (<option key={r}>{r}</option>))}
                </select>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <input placeholder="Dosage (ex: 500mg)" value={newInventoryForm.strength} onChange={(e) => setNewInventoryForm({ ...newInventoryForm, strength: e.target.value })} disabled={addingInventory} style={inventoryFieldStyle} />
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: COLORS.ink, cursor: "pointer" }}>
                  <input type="checkbox" checked={newInventoryForm.prescriptionRequired} onChange={(e) => setNewInventoryForm({ ...newInventoryForm, prescriptionRequired: e.target.checked })} disabled={addingInventory} />
                  Ordonnance requise
                </label>
              </div>
              <input placeholder="Conditions de conservation" value={newInventoryForm.storageConditions} onChange={(e) => setNewInventoryForm({ ...newInventoryForm, storageConditions: e.target.value })} disabled={addingInventory} style={inventoryFieldStyle} />
              <input placeholder="Indications courantes" value={newInventoryForm.commonIndications} onChange={(e) => setNewInventoryForm({ ...newInventoryForm, commonIndications: e.target.value })} disabled={addingInventory} style={inventoryFieldStyle} />

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 4 }}>
                <input type="number" min="0" placeholder="Quantité en stock *" value={newInventoryForm.quantityAvailable} onChange={(e) => setNewInventoryForm({ ...newInventoryForm, quantityAvailable: e.target.value })} disabled={addingInventory} style={inventoryFieldStyle} />
                <input type="number" min="0" placeholder="Seuil minimum" value={newInventoryForm.minimumStockLevel} onChange={(e) => setNewInventoryForm({ ...newInventoryForm, minimumStockLevel: e.target.value })} disabled={addingInventory} style={inventoryFieldStyle} />
                <input type="date" value={newInventoryForm.expirationDate} onChange={(e) => setNewInventoryForm({ ...newInventoryForm, expirationDate: e.target.value })} disabled={addingInventory} style={inventoryFieldStyle} />
              </div>

              <button onClick={addInventoryItem} disabled={addingInventory} style={{
                width: "100%", padding: 12, backgroundColor: COLORS.green, color: "white", border: "none",
                borderRadius: 6, cursor: addingInventory ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 14,
                opacity: addingInventory ? 0.7 : 1, marginTop: 8,
              }}>
                {addingInventory ? "Ajout…" : "+ Ajouter au stock"}
              </button>
            </div>

            {inventory.length === 0 ? (
              <div style={{ padding: 40, backgroundColor: COLORS.card, borderRadius: 10, textAlign: "center", color: COLORS.slate, border: `1.5px dashed ${COLORS.line}` }}>
                Aucun médicament en stock pour l'instant.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {inventory.map((item) => {
                  const isLow = item.quantityAvailable <= (item.minimumStockLevel || 0);
                  const daysToExpiry = item.expirationDate ? Math.ceil((new Date(item.expirationDate) - new Date()) / (1000 * 60 * 60 * 24)) : null;
                  const isExpired = daysToExpiry != null && daysToExpiry < 0;
                  const isExpiringSoon = daysToExpiry != null && daysToExpiry >= 0 && daysToExpiry <= 30;
                  return (
                    <div key={item.id} style={{
                      padding: "16px 20px", backgroundColor: COLORS.card, borderRadius: 10, border: `1px solid ${COLORS.line}`,
                      borderLeft: `5px solid ${isExpired ? COLORS.red : isLow ? "#8A5A00" : COLORS.green}`,
                      display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 14,
                    }}>
                      <div>
                        <div style={{ fontWeight: 700, color: COLORS.ink, fontSize: 15 }}>
                          {item.genericName} {item.strength}
                        </div>
                        <div style={{ fontSize: 11.5, color: COLORS.slate, marginTop: 2 }}>
                          {item.medicineId} · {item.therapeuticCategory || "—"} · {item.dosageForm}
                          {item.brandNames?.length > 0 && ` · ${item.brandNames.join(", ")}`}
                        </div>
                        <div style={{ fontSize: 12.5, color: COLORS.slate, marginTop: 5, display: "flex", gap: 10, flexWrap: "wrap" }}>
                          <span style={{ color: isLow ? "#8A5A00" : COLORS.slate, fontWeight: isLow ? 700 : 400 }}>
                            En stock : {item.quantityAvailable} {isLow && "⚠️ Stock bas"}
                          </span>
                          <span>Seuil minimum : {item.minimumStockLevel}</span>
                          {item.expirationDate && (
                            <span style={{ color: isExpired ? COLORS.red : isExpiringSoon ? "#8A5A00" : COLORS.slate, fontWeight: (isExpired || isExpiringSoon) ? 700 : 400 }}>
                              Expire le {new Date(item.expirationDate).toLocaleDateString("fr-FR")}
                              {isExpired && " — ⚠️ Expiré"}
                              {isExpiringSoon && ` — ⚠️ Dans ${daysToExpiry} jour${daysToExpiry === 1 ? "" : "s"}`}
                            </span>
                          )}
                        </div>
                      </div>
                      <button onClick={() => restockItem(item)} style={{ padding: "8px 16px", backgroundColor: "#0F7A6E", color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 13, whiteSpace: "nowrap" }}>
                        + Réapprovisionner
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <p style={{ fontSize: 11.5, color: COLORS.slate, marginTop: 16, fontStyle: "italic" }}>
              Le stock diminue automatiquement lorsqu'une ordonnance est marquée « remise au patient », uniquement pour les
              médicaments choisis depuis le catalogue avec une quantité numérique reconnaissable.
            </p>
          </div>
        )}

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

const inventoryFieldStyle = {
  width: "100%", padding: "9px 12px", marginBottom: 10, borderRadius: 6,
  border: "1px solid #E6E2D8", fontSize: 13.5, boxSizing: "border-box",
  fontFamily: "'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
};