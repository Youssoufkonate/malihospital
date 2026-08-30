import { useState, useEffect } from "react";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { auth, db } from "../firebase";
import { doc, setDoc, getDoc } from "firebase/firestore";
import { useNavigate } from "react-router-dom";

// NOTE: There is intentionally no public signup for hospitals, hospital
// admins, doctors, or receptionists anymore.
//   - Super Admin creates hospitals (and their Hospital Admin) from /superadmin
//   - Hospital Admin creates Doctors/Receptionists from /admin
// This page's only job is to create the very first Super Admin account, and
// it locks itself once that account exists (config/setup doc is created).

const COLORS = {
  parchment: "#F6EEDD",
  ink: "#211C16",
  inkSoft: "#3B332A",
  clay: "#B5502F",
  gold: "#D9A441",
  line: "#D8C9A8",
  danger: "#9A2B1F",
  dangerBg: "#F6E3DD",
  success: "#1F5C3A",
  successBg: "#E3EEE3",
};

const inputStyle = {
  width: "100%",
  padding: "13px 14px",
  marginBottom: 12,
  borderRadius: 8,
  border: `1.5px solid ${COLORS.line}`,
  background: "#FFFDF8",
  fontSize: 15,
  color: COLORS.ink,
  boxSizing: "border-box",
  fontFamily: "'Work Sans', sans-serif",
};

export default function Signup() {
  const [checking, setChecking] = useState(true);
  const [bootstrapAvailable, setBootstrapAvailable] = useState(false);
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const configDoc = await getDoc(doc(db, "config", "setup"));
        setBootstrapAvailable(!configDoc.exists());
      } catch (e) {
        console.error("Error checking bootstrap state:", e);
        setBootstrapAvailable(false);
      }
      setChecking(false);
    })();
  }, []);

  const createSuperAdmin = async () => {
    if (!first || !last || !email || !pass) {
      setMsg("❌ Veuillez remplir tous les champs");
      return;
    }
    setLoading(true);
    setMsg("");

    try {
      const res = await createUserWithEmailAndPassword(auth, email, pass);

      await setDoc(doc(db, "users", res.user.uid), {
        firstName: first,
        lastName: last,
        email,
        role: "superadmin",
        hospitalId: null,
        approved: true,
        disabled: false,
        createdAt: new Date().toISOString(),
      });

      // This flips bootstrapAvailable to false for everyone else forever.
      await setDoc(doc(db, "config", "setup"), {
        initialized: true,
        firstUserCreated: new Date().toISOString(),
      });

      setMsg("✅ Compte Super Administrateur créé ! Redirection...");
      setTimeout(() => nav("/"), 1500);
    } catch (e) {
      console.error("Bootstrap signup error:", e);
      if (e.code === "auth/email-already-in-use") {
        setMsg("❌ Cet email est déjà enregistré.");
      } else if (e.code === "auth/weak-password") {
        setMsg("❌ Le mot de passe doit contenir au moins 6 caractères.");
      } else {
        setMsg("❌ " + e.message);
      }
      setLoading(false);
    }
  };

  if (checking) {
    return <div style={{ padding: 40, fontFamily: "'Work Sans', sans-serif" }}>Chargement...</div>;
  }

  if (!bootstrapAvailable) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: `
          radial-gradient(circle at 15% 20%, rgba(0, 128, 0, 0.08), transparent 28%),
          radial-gradient(circle at 85% 80%, rgba(206, 17, 38, 0.07), transparent 28%),
          ${COLORS.parchment}
        `,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        fontFamily: "'Work Sans', sans-serif",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Decorative Malian-inspired shapes */}
      <div
        style={{
          position: "absolute",
          top: -90,
          left: -90,
          width: 260,
          height: 260,
          borderRadius: "50%",
          background: "rgba(0, 128, 0, 0.08)",
        }}
      />

      <div
        style={{
          position: "absolute",
          bottom: -100,
          right: -80,
          width: 280,
          height: 280,
          borderRadius: "50%",
          background: "rgba(206, 17, 38, 0.07)",
        }}
      />

      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 6,
          background:
            "linear-gradient(90deg, #00843D 0%, #00843D 33.33%, #FCD116 33.33%, #FCD116 66.66%, #CE1126 66.66%, #CE1126 100%)",
        }}
      />

      <div
        style={{
          width: "100%",
          maxWidth: 520,
          background: "rgba(255, 253, 248, 0.98)",
          borderRadius: 22,
          border: "1px solid rgba(92, 73, 51, 0.12)",
          boxShadow: "0 24px 70px rgba(45, 35, 20, 0.14)",
          overflow: "hidden",
          position: "relative",
          zIndex: 2,
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "32px 32px 26px",
            textAlign: "center",
            background:
              "linear-gradient(135deg, rgba(0,132,61,0.08), rgba(252,209,22,0.07))",
            borderBottom: "1px solid rgba(92, 73, 51, 0.08)",
          }}
        >
          {/* Logo / Icon */}
          <div
            style={{
              width: 76,
              height: 76,
              margin: "0 auto 18px",
              borderRadius: 20,
              background:
                "linear-gradient(135deg, #00843D 0%, #006B32 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 10px 24px rgba(0, 132, 61, 0.22)",
              position: "relative",
            }}
          >
            <div
              style={{
                width: 42,
                height: 42,
                border: "3px solid #FFFDF8",
                borderRadius: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#FFFDF8",
                fontSize: 26,
                fontWeight: 800,
              }}
            >
              +
            </div>

            {/* Small gold accent */}
            <div
              style={{
                position: "absolute",
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "#FCD116",
                top: 8,
                right: 8,
              }}
            />
          </div>

          <div
            style={{
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: "1.8px",
              textTransform: "uppercase",
              color: "#00843D",
              marginBottom: 9,
            }}
          >
            Accès sécurisé
          </div>

          <h2
            style={{
              color: "#27231E",
              margin: 0,
              fontSize: 27,
              lineHeight: 1.25,
              fontWeight: 800,
            }}
          >
            Inscription publique désactivée
          </h2>
        </div>

        {/* Content */}
        <div
          style={{
            padding: "30px 34px 34px",
          }}
        >
          <p
            style={{
              color: "#625B52",
              lineHeight: 1.75,
              fontSize: 15.5,
              margin: "0 0 24px",
              textAlign: "center",
            }}
          >
            Pour garantir la sécurité des données hospitalières, les comptes
            ne peuvent pas être créés publiquement.
          </p>

          {/* Information box */}
          <div
            style={{
              background: "#F8F5EC",
              border: "1px solid #E7DFCF",
              borderRadius: 14,
              padding: "18px 18px",
              marginBottom: 25,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 13,
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  minWidth: 36,
                  borderRadius: 10,
                  background: "rgba(0, 132, 61, 0.11)",
                  color: "#00843D",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 18,
                  fontWeight: 800,
                }}
              >
                ✓
              </div>

              <div>
                <div
                  style={{
                    color: "#302B25",
                    fontWeight: 800,
                    fontSize: 14,
                    marginBottom: 5,
                  }}
                >
                  Comment obtenir un accès ?
                </div>

                <div
                  style={{
                    color: "#70685E",
                    fontSize: 14,
                    lineHeight: 1.6,
                  }}
                >
                  Le{" "}
                  <strong style={{ color: "#00843D" }}>
                    Super Administrateur
                  </strong>{" "}
                  crée les comptes des hôpitaux, tandis que
                  l'administrateur de votre hôpital crée les comptes du
                  personnel.
                </div>
              </div>
            </div>
          </div>

          <p
            style={{
              color: "#756D63",
              fontSize: 13.5,
              lineHeight: 1.6,
              textAlign: "center",
              margin: "0 0 22px",
            }}
          >
            Si vous travaillez dans un établissement hospitalier, contactez
            votre administrateur afin d'obtenir vos identifiants de connexion.
          </p>

          {/* Back button */}
          <button
            onClick={() => nav("/")}
            style={{
              width: "100%",
              padding: "14px 20px",
              background:
                "linear-gradient(135deg, #00843D 0%, #006F34 100%)",
              color: "#FFFDF8",
              border: "none",
              borderRadius: 11,
              cursor: "pointer",
              fontWeight: 800,
              fontSize: 15,
              letterSpacing: "0.1px",
              boxShadow: "0 8px 20px rgba(0, 132, 61, 0.20)",
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-1px)";
              e.currentTarget.style.boxShadow =
                "0 11px 25px rgba(0, 132, 61, 0.27)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow =
                "0 8px 20px rgba(0, 132, 61, 0.20)";
            }}
          >
            ← Retour à la connexion
          </button>
        </div>

        {/* Bottom Malian color stripe */}
        <div
          style={{
            height: 5,
            background:
              "linear-gradient(90deg, #00843D 0%, #00843D 33.33%, #FCD116 33.33%, #FCD116 66.66%, #CE1126 66.66%, #CE1126 100%)",
          }}
        />
      </div>
    </div>
  );
}
  return (
    <div style={{ minHeight: "100vh", background: COLORS.parchment, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: "'Work Sans', sans-serif" }}>
      <div style={{ maxWidth: 460, width: "100%", background: "#FFFDF8", padding: 40, borderRadius: 14, border: `1px solid ${COLORS.line}`, boxShadow: "0 20px 50px rgba(33,28,22,0.18)" }}>
        <h2 style={{ margin: "0 0 6px", color: COLORS.ink, fontFamily: "'Fraunces', serif" }}>
          Configuration initiale
        </h2>
        <p style={{ margin: "0 0 24px", color: "#8A7F6C", fontSize: 13.5, lineHeight: 1.6 }}>
          Aucun compte n'existe encore dans ce système. Créez le compte <strong>Super Administrateur</strong>,
          qui pourra ensuite créer des hôpitaux et leurs administrateurs.
        </p>

        <input placeholder="Prénom" value={first} onChange={(e) => setFirst(e.target.value)} disabled={loading} style={inputStyle} />
        <input placeholder="Nom" value={last} onChange={(e) => setLast(e.target.value)} disabled={loading} style={inputStyle} />
        <input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={loading} style={inputStyle} />
        <input placeholder="Mot de passe (min 6 caractères)" type="password" value={pass} onChange={(e) => setPass(e.target.value)} disabled={loading} style={inputStyle} />

        <button
          onClick={createSuperAdmin}
          disabled={loading}
          style={{ width: "100%", padding: 14, background: COLORS.clay, color: "#FFFDF8", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 16, cursor: loading ? "not-allowed" : "pointer" }}
        >
          {loading ? "Création..." : "Créer le Super Administrateur"}
        </button>

        {msg && (
          <div
            style={{
              marginTop: 14,
              padding: 12,
              borderRadius: 8,
              textAlign: "center",
              fontWeight: 600,
              background: msg.startsWith("✅") ? COLORS.successBg : COLORS.dangerBg,
              color: msg.startsWith("✅") ? COLORS.success : COLORS.danger,
            }}
          >
            {msg}
          </div>
        )}
      </div>
    </div>
  );
}