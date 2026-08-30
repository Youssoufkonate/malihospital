import { useState } from "react";
import { auth } from "../firebase";
import {
  multiFactor,
  TotpMultiFactorGenerator,
  reauthenticateWithCredential,
  EmailAuthProvider,
} from "firebase/auth";

const COLORS = {
  green: "#14B53A", red: "#CE1126", ink: "#1B2A1F", slate: "#5B6B63",
  paper: "#FAF9F5", card: "#FFFFFF", line: "#E6E2D8",
  dangerBg: "#FBEAEC", dangerText: "#A31221",
};
const FONT_DISPLAY = "'Georgia', 'Iowan Old Style', 'Times New Roman', serif";
const FONT_BODY = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

/**
 * TOTP (authenticator app) enrollment — Google Authenticator, Authy, etc.
 * Deliberately TOTP rather than SMS: it's free (no per-message cost) and
 * doesn't depend on a phone network, which matters for a Mali-wide
 * deployment where SMS delivery reliability across carriers is a real
 * variable.
 *
 * REQUIRES a one-time setup step in Firebase Console that this code
 * can't do on its own: Authentication -> Settings -> User actions (or
 * "Multi-factor authentication" section) -> enable TOTP as a second
 * factor. If that's not enabled, enrollment will fail with a clear
 * Firebase error explaining the same thing.
 *
 * Firebase requires a RECENT sign-in to enroll a new MFA factor (this
 * is deliberate on Firebase's part — it stops someone who stole an
 * already-open session from adding their own factor to lock the real
 * owner out). If enrollment fails with "requires-recent-login", this
 * component asks for the password again and retries automatically.
 */
export default function MfaSetup({ onClose, onEnrolled }) {
  const [step, setStep] = useState("start"); // start | reauth | verify
  const [totpSecret, setTotpSecret] = useState(null);
  const [code, setCode] = useState("");
  const [reauthPassword, setReauthPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const generateSecret = async () => {
    setLoading(true);
    setError("");
    try {
      const session = await multiFactor(auth.currentUser).getSession();
      const secret = await TotpMultiFactorGenerator.generateSecret(session);
      setTotpSecret(secret);
      setStep("verify");
    } catch (e) {
      if (e.code === "auth/requires-recent-login") {
        setStep("reauth");
      } else if (e.code === "auth/operation-not-allowed" || e.message?.includes("TOTP")) {
        setError("La double authentification TOTP n'est pas activée pour ce projet. Un administrateur technique doit l'activer dans Firebase Console → Authentication → Paramètres.");
      } else {
        setError(e.message);
      }
    }
    setLoading(false);
  };

  const reauthenticate = async () => {
    if (!reauthPassword) return;
    setLoading(true);
    setError("");
    try {
      const credential = EmailAuthProvider.credential(auth.currentUser.email, reauthPassword);
      await reauthenticateWithCredential(auth.currentUser, credential);
      setReauthPassword("");
      await generateSecret();
    } catch (e) {
      setError(e.code === "auth/wrong-password" || e.code === "auth/invalid-credential" ? "Mot de passe incorrect." : e.message);
      setLoading(false);
    }
  };

  const completeEnrollment = async () => {
    if (!code.trim()) return;
    setLoading(true);
    setError("");
    try {
      const assertion = TotpMultiFactorGenerator.assertionForEnrollment(totpSecret, code.trim());
      await multiFactor(auth.currentUser).enroll(assertion, "Application d'authentification");
      onEnrolled();
    } catch (e) {
      setError(e.code === "auth/invalid-verification-code" ? "Code invalide — vérifiez l'heure de votre téléphone et réessayez." : e.message);
    }
    setLoading(false);
  };

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, backgroundColor: "rgba(27,42,31,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 2000 }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: "#fff", borderRadius: 14, width: "min(480px, 100%)", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.35)", borderTop: "6px solid #6B4226", fontFamily: FONT_BODY }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "22px 28px 0" }}>
          <h2 style={{ margin: 0, fontFamily: FONT_DISPLAY, fontSize: 20, color: COLORS.ink }}>🔐 Double authentification</h2>
          <button onClick={onClose} aria-label="Fermer" style={{ width: 34, height: 34, borderRadius: "50%", border: "none", backgroundColor: COLORS.paper, color: COLORS.ink, fontSize: 17, fontWeight: 700, cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ padding: "20px 28px 26px" }}>
          {error && (
            <div style={{ padding: "10px 14px", marginBottom: 16, borderRadius: 6, backgroundColor: COLORS.dangerBg, color: COLORS.dangerText, fontSize: 13, fontWeight: 500 }}>
              ❌ {error}
            </div>
          )}

          {step === "start" && (
            <div>
              <p style={{ fontSize: 14, color: COLORS.slate, marginTop: 0 }}>
                Ajoute une étape de vérification supplémentaire à la connexion, via une application
                comme Google Authenticator ou Authy. Même si votre mot de passe est compromis, un
                attaquant ne pourra pas se connecter sans votre téléphone.
              </p>
              <button onClick={generateSecret} disabled={loading} style={{
                width: "100%", padding: 13, backgroundColor: "#6B4226", color: "white", border: "none",
                borderRadius: 8, cursor: loading ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 14.5,
                opacity: loading ? 0.7 : 1,
              }}>
                {loading ? "Chargement…" : "Commencer la configuration"}
              </button>
            </div>
          )}

          {step === "reauth" && (
            <div>
              <p style={{ fontSize: 14, color: COLORS.slate, marginTop: 0 }}>
                Pour des raisons de sécurité, veuillez confirmer votre mot de passe avant de continuer.
              </p>
              <input
                type="password"
                placeholder="Mot de passe"
                value={reauthPassword}
                onChange={(e) => setReauthPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && reauthenticate()}
                style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${COLORS.line}`, fontSize: 14, boxSizing: "border-box", marginBottom: 14 }}
              />
              <button onClick={reauthenticate} disabled={loading || !reauthPassword} style={{
                width: "100%", padding: 13, backgroundColor: "#6B4226", color: "white", border: "none",
                borderRadius: 8, cursor: (loading || !reauthPassword) ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 14.5,
                opacity: (loading || !reauthPassword) ? 0.7 : 1,
              }}>
                {loading ? "Vérification…" : "Confirmer"}
              </button>
            </div>
          )}

          {step === "verify" && totpSecret && (
            <div>
              <p style={{ fontSize: 13.5, color: COLORS.slate, marginTop: 0 }}>
                1. Ouvrez votre application d'authentification (Google Authenticator, Authy, etc.)<br />
                2. Ajoutez un compte manuellement et entrez cette clé :
              </p>
              <div style={{
                padding: "12px 14px", backgroundColor: COLORS.paper, borderRadius: 8, border: `1px solid ${COLORS.line}`,
                fontFamily: "monospace", fontSize: 15, letterSpacing: "1px", textAlign: "center", marginBottom: 16, wordBreak: "break-all",
              }}>
                {totpSecret.secretKey}
              </div>
              <p style={{ fontSize: 13.5, color: COLORS.slate }}>
                3. Entrez le code à 6 chiffres généré par l'application :
              </p>
              <input
                type="text"
                inputMode="numeric"
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={(e) => e.key === "Enter" && completeEnrollment()}
                style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${COLORS.line}`, fontSize: 20, letterSpacing: "4px", textAlign: "center", boxSizing: "border-box", marginBottom: 16, fontFamily: "monospace" }}
              />
              <button onClick={completeEnrollment} disabled={loading || code.length !== 6} style={{
                width: "100%", padding: 13, backgroundColor: COLORS.green, color: "white", border: "none",
                borderRadius: 8, cursor: (loading || code.length !== 6) ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 14.5,
                opacity: (loading || code.length !== 6) ? 0.7 : 1,
              }}>
                {loading ? "Vérification…" : "Activer la double authentification"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}