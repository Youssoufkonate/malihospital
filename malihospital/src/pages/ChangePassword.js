import { useState } from "react";
import { auth, functions } from "../firebase";
import { httpsCallable } from "firebase/functions";
import {
  reauthenticateWithCredential,
  EmailAuthProvider,
  updatePassword,
} from "firebase/auth";

const COLORS = {
  green: "#14B53A", red: "#CE1126", ink: "#1B2A1F", slate: "#5B6B63",
  paper: "#FAF9F5", card: "#FFFFFF", line: "#E6E2D8", dangerBg: "#FBEAEC", dangerText: "#A31221",
};
const FONT_DISPLAY = "'Georgia', 'Iowan Old Style', 'Times New Roman', serif";
const FONT_BODY = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

/**
 * Self-service password change. This is what the 45-day expiry reminder
 * email points people to — rather than Firebase's own generic hosted
 * reset page, which would leave us with no reliable way to know the
 * password was actually changed. Doing it in-app means we can update
 * passwordLastChangedAt in Firestore in the SAME action, which is what
 * lets the reminder system actually reset its 45-day clock correctly.
 */
export default function ChangePassword({ onClose }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const submit = async () => {
    setError("");
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError("Veuillez remplir tous les champs.");
      return;
    }
    if (newPassword.length < 6) {
      setError("Le nouveau mot de passe doit contenir au moins 6 caractères.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    if (newPassword === currentPassword) {
      setError("Le nouveau mot de passe doit être différent de l'ancien.");
      return;
    }

    setLoading(true);
    try {
      // Checked BEFORE touching the real Firebase Auth password at
      // all — if this rejects, nothing about the account has changed
      // yet, so there's nothing to undo.
      const checkCall = httpsCallable(functions, "checkPasswordNotReused");
      await checkCall({ newPassword });

      const credential = EmailAuthProvider.credential(auth.currentUser.email, currentPassword);
      await reauthenticateWithCredential(auth.currentUser, credential);
      await updatePassword(auth.currentUser, newPassword);

      // Records the new password's hash into the reuse-history and
      // stamps passwordLastChangedAt server-side — this is what lets
      // the 45-day reminder system reset its clock correctly.
      const recordCall = httpsCallable(functions, "recordPasswordChange");
      await recordCall({ newPassword });

      setSuccess(true);
    } catch (e) {
      if (e.code === "auth/wrong-password" || e.code === "auth/invalid-credential") {
        setError("Mot de passe actuel incorrect.");
      } else if (e.code === "auth/weak-password") {
        setError("Ce mot de passe est trop faible.");
      } else if (e.code === "functions/already-exists") {
        setError(e.message);
      } else {
        setError(e.message);
      }
    }
    setLoading(false);
  };

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, backgroundColor: "rgba(27,42,31,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 2000 }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: "#fff", borderRadius: 14, width: "min(440px, 100%)", boxShadow: "0 20px 60px rgba(0,0,0,0.35)", borderTop: "6px solid #6B4226", fontFamily: FONT_BODY }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "22px 28px 0" }}>
          <h2 style={{ margin: 0, fontFamily: FONT_DISPLAY, fontSize: 20, color: COLORS.ink }}>Changer le mot de passe</h2>
          <button onClick={onClose} aria-label="Fermer" style={{ width: 34, height: 34, borderRadius: "50%", border: "none", backgroundColor: COLORS.paper, color: COLORS.ink, fontSize: 17, fontWeight: 700, cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ padding: "20px 28px 26px" }}>
          {success ? (
            <div>
              <div style={{ padding: "12px 14px", marginBottom: 18, borderRadius: 6, backgroundColor: "#E9F7EC", color: "#1E7B34", fontSize: 14, fontWeight: 500 }}>
                ✅ Mot de passe mis à jour avec succès.
              </div>
              <button onClick={onClose} style={{ width: "100%", padding: 13, backgroundColor: "#6B4226", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 14.5 }}>
                Fermer
              </button>
            </div>
          ) : (
            <>
              {error && (
                <div style={{ padding: "10px 14px", marginBottom: 16, borderRadius: 6, backgroundColor: COLORS.dangerBg, color: COLORS.dangerText, fontSize: 13, fontWeight: 500 }}>
                  ❌ {error}
                </div>
              )}
              <input
                type="password"
                placeholder="Mot de passe actuel"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${COLORS.line}`, fontSize: 14, boxSizing: "border-box", marginBottom: 12 }}
              />
              <input
                type="password"
                placeholder="Nouveau mot de passe (min. 6 caractères)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${COLORS.line}`, fontSize: 14, boxSizing: "border-box", marginBottom: 12 }}
              />
              <input
                type="password"
                placeholder="Confirmer le nouveau mot de passe"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${COLORS.line}`, fontSize: 14, boxSizing: "border-box", marginBottom: 18 }}
              />
              <button onClick={submit} disabled={loading} style={{
                width: "100%", padding: 13, backgroundColor: "#6B4226", color: "white", border: "none",
                borderRadius: 8, cursor: loading ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 14.5,
                opacity: loading ? 0.7 : 1,
              }}>
                {loading ? "Mise à jour…" : "Mettre à jour le mot de passe"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}