import { useState, useEffect } from "react";
import { db, auth } from "../firebase";
import { collection, doc, getDoc, addDoc, query, where, onSnapshot } from "firebase/firestore";

const COLORS = {
  green: "#14B53A", red: "#CE1126", ink: "#1B2A1F", slate: "#5B6B63",
  paper: "#FAF9F5", card: "#FFFFFF", line: "#E6E2D8",
  successBg: "#E9F7EC", successText: "#1E7B34",
  warnBg: "#FDF3E3", warnText: "#8A5A00",
  dangerBg: "#FBEAEC", dangerText: "#A31221",
};
const FONT_DISPLAY = "'Georgia', 'Iowan Old Style', 'Times New Roman', serif";
const FONT_BODY = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

const STATUS_LABELS = { pending: "En attente", approved: "Approuvée", fulfilled: "Fournie", denied: "Refusée" };
const STATUS_COLORS = {
  pending: { bg: COLORS.warnBg, text: COLORS.warnText },
  approved: { bg: "#E8F0FB", text: "#2E5C8C" },
  fulfilled: { bg: COLORS.successBg, text: COLORS.successText },
  denied: { bg: COLORS.dangerBg, text: COLORS.dangerText },
};

/**
 * Drop this into any staff dashboard (Doctor, Nurse, Accueil, Supervisor,
 * AdminPanel) to let that person request supplies — gloves, scissors,
 * gauze, anything consumable — either from the hospital admin's central
 * stock or from a specific department's own stock. This is deliberately
 * NOT the pharmacy inventory system: that's what a pharmacy sells to
 * patients, this is what departments consume internally.
 */
export default function SupplyRequestButton({ hospitalId, department }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("new"); // new | mine
  const [departments, setDepartments] = useState([]);
  const [form, setForm] = useState({ target: "hospitalAdmin", targetDepartment: "", itemName: "", quantity: "", notes: "" });
  const [submitting, setSubmitting] = useState(false);
  const [myRequests, setMyRequests] = useState([]);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!open || !hospitalId) return;
    getDoc(doc(db, "hospitals", hospitalId))
      .then((snap) => setDepartments(snap.exists() ? (snap.data().departments || []) : []))
      .catch((e) => console.error("Error loading departments:", e));
  }, [open, hospitalId]);

  useEffect(() => {
    if (!open || tab !== "mine" || !auth.currentUser) return;
    const q = query(collection(db, "supplyRequests"), where("requesterId", "==", auth.currentUser.uid));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      setMyRequests(list);
    }, (e) => console.error("Error loading my requests:", e));
    return () => unsub();
  }, [open, tab]);

  const submitRequest = async () => {
    if (!form.itemName.trim()) return setMsg("❌ Veuillez indiquer le matériel demandé.");
    if (!form.quantity || Number(form.quantity) <= 0) return setMsg("❌ Veuillez indiquer une quantité valide.");
    if (form.target === "department" && !form.targetDepartment) return setMsg("❌ Veuillez choisir un département.");
    setSubmitting(true);
    setMsg("");
    try {
      const userSnap = await getDoc(doc(db, "users", auth.currentUser.uid));
      const userData = userSnap.exists() ? userSnap.data() : {};
      await addDoc(collection(db, "supplyRequests"), {
        requesterId: auth.currentUser.uid,
        requesterName: `${userData.firstName || ""} ${userData.lastName || ""}`.trim() || "—",
        requesterRole: userData.role || "—",
        requesterDepartment: department || null,
        hospitalId,
        targetDepartment: form.target === "department" ? form.targetDepartment : null,
        itemName: form.itemName.trim(),
        quantity: Number(form.quantity),
        notes: form.notes.trim(),
        status: "pending",
        createdAt: new Date().toISOString(),
      });
      setMsg("✅ Demande envoyée.");
      setForm({ target: "hospitalAdmin", targetDepartment: "", itemName: "", quantity: "", notes: "" });
    } catch (e) {
      setMsg("❌ Erreur: " + e.message);
    }
    setSubmitting(false);
  };

  return (
    <>
      <button onClick={() => { setOpen(true); setMsg(""); }} style={{
        padding: "10px 18px", backgroundColor: "#6B4226", color: "white", border: "none",
        borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 13.5, fontFamily: FONT_BODY,
      }}>
        📦 Demander du matériel
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{ position: "fixed", inset: 0, backgroundColor: "rgba(27,42,31,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 1000 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: "#fff", borderRadius: 14, width: "min(560px, 100%)", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.35)", borderTop: "6px solid #6B4226", fontFamily: FONT_BODY }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "22px 28px 0" }}>
              <h2 style={{ margin: 0, fontFamily: FONT_DISPLAY, fontSize: 20, color: COLORS.ink }}>📦 Matériel</h2>
              <button onClick={() => setOpen(false)} aria-label="Fermer" style={{ width: 34, height: 34, borderRadius: "50%", border: "none", backgroundColor: COLORS.paper, color: COLORS.ink, fontSize: 17, fontWeight: 700, cursor: "pointer" }}>✕</button>
            </div>

            <div style={{ display: "flex", gap: 4, padding: "16px 28px 0", borderBottom: `1px solid ${COLORS.line}` }}>
              {["new", "mine"].map((t) => (
                <button key={t} onClick={() => setTab(t)}
                  style={{
                    padding: "10px 16px", border: "none", background: "none", cursor: "pointer",
                    fontSize: 13.5, fontWeight: tab === t ? 700 : 500,
                    color: tab === t ? "#6B4226" : COLORS.slate,
                    borderBottom: tab === t ? "3px solid #6B4226" : "3px solid transparent",
                    marginBottom: -1,
                  }}>
                  {t === "new" ? "Nouvelle demande" : "Mes demandes"}
                </button>
              ))}
            </div>

            <div style={{ padding: "20px 28px 26px" }}>
              {msg && (
                <div style={{
                  padding: "10px 14px", marginBottom: 14, borderRadius: 6, fontSize: 13, fontWeight: 500,
                  backgroundColor: msg.startsWith("✅") ? COLORS.successBg : COLORS.dangerBg,
                  color: msg.startsWith("✅") ? COLORS.successText : COLORS.dangerText,
                }}>
                  {msg}
                </div>
              )}

              {tab === "new" && (
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: COLORS.slate, marginBottom: 8 }}>Demander à</label>
                  <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                    <button type="button" onClick={() => setForm({ ...form, target: "hospitalAdmin", targetDepartment: "" })}
                      style={{
                        padding: "7px 14px", borderRadius: 20, cursor: "pointer", fontSize: 12.5, fontWeight: 600,
                        border: `1px solid ${form.target === "hospitalAdmin" ? "#6B4226" : COLORS.line}`,
                        backgroundColor: form.target === "hospitalAdmin" ? "#6B4226" : "#fff",
                        color: form.target === "hospitalAdmin" ? "#fff" : COLORS.slate,
                      }}>
                      Administration (stock central)
                    </button>
                    <button type="button" onClick={() => setForm({ ...form, target: "department" })}
                      style={{
                        padding: "7px 14px", borderRadius: 20, cursor: "pointer", fontSize: 12.5, fontWeight: 600,
                        border: `1px solid ${form.target === "department" ? "#6B4226" : COLORS.line}`,
                        backgroundColor: form.target === "department" ? "#6B4226" : "#fff",
                        color: form.target === "department" ? "#fff" : COLORS.slate,
                      }}>
                      Un département
                    </button>
                  </div>
                  {form.target === "department" && (
                    <select
                      value={form.targetDepartment}
                      onChange={(e) => setForm({ ...form, targetDepartment: e.target.value })}
                      style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${COLORS.line}`, fontSize: 14, boxSizing: "border-box", marginBottom: 14 }}
                    >
                      <option value="">Choisir un département…</option>
                      {departments.map((d) => (<option key={d}>{d}</option>))}
                    </select>
                  )}

                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: COLORS.slate, marginBottom: 8 }}>Matériel demandé</label>
                  <input
                    placeholder="ex: Gants en latex (taille M)"
                    value={form.itemName}
                    onChange={(e) => setForm({ ...form, itemName: e.target.value })}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${COLORS.line}`, fontSize: 14, boxSizing: "border-box", marginBottom: 14 }}
                  />

                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: COLORS.slate, marginBottom: 8 }}>Quantité</label>
                  <input
                    type="number" min="1"
                    value={form.quantity}
                    onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${COLORS.line}`, fontSize: 14, boxSizing: "border-box", marginBottom: 14 }}
                  />

                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: COLORS.slate, marginBottom: 8 }}>Notes (optionnel)</label>
                  <textarea
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    rows={2}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${COLORS.line}`, fontSize: 14, boxSizing: "border-box", marginBottom: 18, fontFamily: FONT_BODY, resize: "vertical" }}
                  />

                  <button onClick={submitRequest} disabled={submitting} style={{
                    width: "100%", padding: 13, backgroundColor: "#6B4226", color: "white", border: "none",
                    borderRadius: 8, cursor: submitting ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 14.5,
                    opacity: submitting ? 0.7 : 1,
                  }}>
                    {submitting ? "Envoi…" : "Envoyer la demande"}
                  </button>
                </div>
              )}

              {tab === "mine" && (
                myRequests.length === 0 ? (
                  <p style={{ color: COLORS.slate, fontSize: 14 }}>Aucune demande pour l'instant.</p>
                ) : (
                  <div style={{ display: "grid", gap: 8 }}>
                    {myRequests.map((r) => {
                      const sc = STATUS_COLORS[r.status] || STATUS_COLORS.pending;
                      return (
                        <div key={r.id} style={{ padding: "12px 14px", backgroundColor: COLORS.paper, borderRadius: 8, border: `1px solid ${COLORS.line}` }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                            <div>
                              <div style={{ fontWeight: 700, color: COLORS.ink, fontSize: 13.5 }}>{r.itemName} × {r.quantity}</div>
                              <div style={{ fontSize: 11.5, color: COLORS.slate, marginTop: 2 }}>
                                À {r.targetDepartment ? r.targetDepartment : "l'administration"} · {new Date(r.createdAt).toLocaleDateString("fr-FR")}
                              </div>
                              {r.notes && <div style={{ fontSize: 12, color: COLORS.slate, marginTop: 4 }}>{r.notes}</div>}
                            </div>
                            <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, backgroundColor: sc.bg, color: sc.text, whiteSpace: "nowrap" }}>
                              {STATUS_LABELS[r.status] || r.status}
                            </span>
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
      )}
    </>
  );
}