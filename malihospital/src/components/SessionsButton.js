import { useState, useEffect } from "react";
import { db, auth } from "../firebase";
import { collection, query, where, onSnapshot, doc, updateDoc, writeBatch } from "firebase/firestore";
import { getOrCreateSessionId } from "../utils/deviceInfo";

const COLORS = {
  green: "#14B53A", red: "#CE1126", ink: "#1B2A1F", slate: "#5B6B63",
  paper: "#FAF9F5", card: "#FFFFFF", line: "#E6E2D8",
  successBg: "#E9F7EC", successText: "#1E7B34",
};
const FONT_DISPLAY = "'Georgia', 'Iowan Old Style', 'Times New Roman', serif";
const FONT_BODY = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

function timeAgo(iso) {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  return `il y a ${days} jour${days > 1 ? "s" : ""}`;
}

/**
 * Drop into any dashboard's header to give the logged-in user visibility
 * and control over every browser/device they're currently signed into —
 * revoking one takes effect within moments on that device, wherever it
 * is, via the live listener in SessionGuard.
 */
export default function SessionsButton() {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [revoking, setRevoking] = useState(null); // sessionId currently being revoked, or "all"
  const currentSessionId = getOrCreateSessionId();

  useEffect(() => {
    if (!open || !auth.currentUser) return;
    const q = query(collection(db, "sessions"), where("uid", "==", auth.currentUser.uid));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((s) => !s.revoked);
      list.sort((a, b) => new Date(b.lastActivityAt) - new Date(a.lastActivityAt));
      setSessions(list);
    }, (e) => console.error("Error loading sessions:", e));
    return () => unsub();
  }, [open]);

  const revokeOne = async (sessionId) => {
    setRevoking(sessionId);
    try {
      await updateDoc(doc(db, "sessions", sessionId), { revoked: true, revokedAt: new Date().toISOString(), revokedBy: "self" });
    } catch (e) {
      alert("❌ Erreur: " + e.message);
    }
    setRevoking(null);
  };

  const revokeAll = async () => {
    if (!window.confirm("Déconnecter TOUS vos appareils, y compris celui-ci ? Vous devrez vous reconnecter.")) return;
    setRevoking("all");
    try {
      const batch = writeBatch(db);
      sessions.forEach((s) => {
        batch.update(doc(db, "sessions", s.id), { revoked: true, revokedAt: new Date().toISOString(), revokedBy: "self" });
      });
      await batch.commit();
    } catch (e) {
      alert("❌ Erreur: " + e.message);
    }
    setRevoking(null);
  };

  return (
    <>
      <button onClick={() => setOpen(true)} style={{
        padding: "10px 16px", backgroundColor: "transparent", color: COLORS.slate, border: `1.5px solid ${COLORS.line}`,
        borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13, fontFamily: FONT_BODY,
      }}>
        🖥️ Sessions actives
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{ position: "fixed", inset: 0, backgroundColor: "rgba(27,42,31,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 1000 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: "#fff", borderRadius: 14, width: "min(520px, 100%)", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.35)", borderTop: "6px solid #2E5C8C", fontFamily: FONT_BODY }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "22px 28px 0" }}>
              <h2 style={{ margin: 0, fontFamily: FONT_DISPLAY, fontSize: 20, color: COLORS.ink }}>Votre compte</h2>
              <button onClick={() => setOpen(false)} aria-label="Fermer" style={{ width: 34, height: 34, borderRadius: "50%", border: "none", backgroundColor: COLORS.paper, color: COLORS.ink, fontSize: 17, fontWeight: 700, cursor: "pointer" }}>✕</button>
            </div>

            <div style={{ padding: "20px 28px 26px" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.slate, textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 12 }}>
                Sessions actives
              </div>

              {sessions.length === 0 ? (
                <p style={{ color: COLORS.slate, fontSize: 14 }}>Chargement…</p>
              ) : (
                <div style={{ display: "grid", gap: 8, marginBottom: 18 }}>
                  {sessions.map((s) => {
                    const isThisDevice = s.id === currentSessionId;
                    return (
                      <div key={s.id} style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8,
                        padding: "12px 14px", backgroundColor: isThisDevice ? COLORS.successBg : COLORS.paper, borderRadius: 8,
                        border: `1px solid ${isThisDevice ? COLORS.successText : COLORS.line}`,
                      }}>
                        <div>
                          <div style={{ fontWeight: 700, color: COLORS.ink, fontSize: 13.5 }}>
                            {s.deviceLabel || "Appareil inconnu"} {isThisDevice && <span style={{ color: COLORS.successText, fontSize: 11 }}>(cet appareil)</span>}
                          </div>
                          <div style={{ fontSize: 11.5, color: COLORS.slate, marginTop: 2 }}>
                            Dernière activité : {timeAgo(s.lastActivityAt)}
                          </div>
                        </div>
                        {!isThisDevice && (
                          <button onClick={() => revokeOne(s.id)} disabled={revoking === s.id} style={{
                            padding: "6px 14px", backgroundColor: COLORS.red, color: "white", border: "none",
                            borderRadius: 5, cursor: revoking === s.id ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 600,
                          }}>
                            {revoking === s.id ? "…" : "Révoquer"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <button onClick={revokeAll} disabled={revoking === "all" || sessions.length === 0} style={{
                width: "100%", padding: 12, backgroundColor: "transparent", color: COLORS.red, border: `1.5px solid ${COLORS.red}`,
                borderRadius: 8, cursor: revoking === "all" ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 13.5,
                opacity: revoking === "all" ? 0.6 : 1,
              }}>
                {revoking === "all" ? "Déconnexion en cours…" : "Déconnecter tous les appareils"}
              </button>
              <p style={{ fontSize: 11.5, color: COLORS.slate, marginTop: 8, marginBottom: 0 }}>
                Ceci vous déconnectera aussi de cet appareil-ci.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}