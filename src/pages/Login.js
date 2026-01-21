import { useState, useEffect } from "react";
import { signInWithEmailAndPassword, setPersistence, browserLocalPersistence } from "firebase/auth";
import { auth, db } from "../firebase";
import { doc, getDoc } from "firebase/firestore";
import { useNavigate } from "react-router-dom";

export default function Login() {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const nav = useNavigate();

  useEffect(() => {
    // Check if user is already logged in
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user) {
        try {
          const userDoc = await getDoc(doc(db, "users", user.uid));
          if (userDoc.exists()) {
            const userData = userDoc.data();
            
            if (userData.disabled) {
              setMsg("❌ Votre compte a été désactivé.");
              await auth.signOut();
              setCheckingAuth(false);
              return;
            }

            if (!userData.approved) {
              setMsg("⏳ Votre compte est en attente d'approbation.");
              setCheckingAuth(false);
              return;
            }

            // Redirect based on role
            if (userData.role === "admin") {
              nav("/admin");
            } else if (userData.role === "doctor") {
              nav("/doctor");
            } else if (userData.role === "accueil") {
              nav("/accueil");
            }
          }
        } catch (error) {
          console.error("Error checking user:", error);
          setCheckingAuth(false);
        }
      } else {
        setCheckingAuth(false);
      }
    });

    return () => unsubscribe();
  }, [nav]);

  const login = async () => {
    if (!email || !pass) {
      setMsg("❌ Veuillez remplir tous les champs");
      return;
    }

    setLoading(true);
    setMsg("");

    try {
      // Set persistence to LOCAL so user stays logged in
      await setPersistence(auth, browserLocalPersistence);
      
      const result = await signInWithEmailAndPassword(auth, email, pass);
      const userDoc = await getDoc(doc(db, "users", result.user.uid));

      if (!userDoc.exists()) {
        setMsg("❌ Données utilisateur introuvables");
        await auth.signOut();
        setLoading(false);
        return;
      }

      const userData = userDoc.data();

      if (userData.disabled) {
        setMsg("❌ Votre compte a été désactivé. Contactez l'administrateur.");
        await auth.signOut();
        setLoading(false);
        return;
      }

      if (!userData.approved) {
        setMsg("⏳ Votre compte est en attente d'approbation par l'administrateur.");
        await auth.signOut();
        setLoading(false);
        return;
      }

      // Redirect based on role
      if (userData.role === "admin") {
        nav("/admin");
      } else if (userData.role === "doctor") {
        nav("/doctor");
      } else if (userData.role === "accueil") {
        nav("/accueil");
      } else {
        setMsg("❌ Rôle utilisateur invalide");
        await auth.signOut();
        setLoading(false);
      }
    } catch (e) {
      console.error("Login error:", e);
      if (e.code === "auth/user-not-found" || e.code === "auth/wrong-password") {
        setMsg("❌ Email ou mot de passe incorrect");
      } else if (e.code === "auth/invalid-credential") {
        setMsg("❌ Email ou mot de passe incorrect");
      } else if (e.code === "auth/too-many-requests") {
        setMsg("❌ Trop de tentatives. Réessayez plus tard.");
      } else if (e.code === "auth/network-request-failed") {
        setMsg("❌ Erreur réseau. Vérifiez votre connexion internet.");
      } else {
        setMsg("❌ " + e.message);
      }
      setLoading(false);
    }
  };

  if (checkingAuth) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #228B22 0%, #FFD700 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <div style={{
          backgroundColor: 'white',
          padding: 40,
          borderRadius: 10,
          textAlign: 'center',
          border: '3px solid #228B22'
        }}>
          <h2 style={{ color: '#228B22' }}>Chargement...</h2>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #228B22 0%, #FFD700 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20
    }}>
      <div style={{
        padding: 40,
        maxWidth: 450,
        width: '100%',
        backgroundColor: 'white',
        borderRadius: 10,
        boxShadow: '0 8px 16px rgba(0,0,0,0.2)',
        border: '3px solid #228B22'
      }}>
        {/* Header with Mali Flag Colors */}
        <div style={{
          textAlign: 'center',
          marginBottom: 30,
          padding: 20,
          background: 'linear-gradient(to right, #14B53A 33%, #FCD116 33%, #FCD116 66%, #CE1126 66%)',
          borderRadius: 8,
          marginLeft: -40,
          marginRight: -40,
          marginTop: -40
        }}>
          <img src="/Mali.jpg" alt="Logo Mali" style={{ height: 70, marginBottom: 10 }} />
          <h1 style={{
            margin: '10px 0',
            color: 'white',
            textShadow: '2px 2px 4px rgba(0,0,0,0.5)',
            fontSize: 28
          }}>
            🏥 SYSTÈME HOSPITALIER
          </h1>
          <p style={{
            margin: 0,
            color: 'white',
            fontWeight: 'bold',
            textShadow: '1px 1px 2px rgba(0,0,0,0.5)'
          }}>
            République du Mali
          </p>
        </div>

        <h2 style={{
          textAlign: 'center',
          color: '#228B22',
          marginBottom: 30
        }}>
          🔐 Connexion
        </h2>

        <input
          placeholder="Email"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyPress={e => e.key === 'Enter' && login()}
          disabled={loading}
          style={{
            width: '100%',
            padding: '12px',
            marginBottom: '15px',
            borderRadius: '6px',
            border: '2px solid #228B22',
            fontSize: 15,
            boxSizing: 'border-box'
          }}
        />

        <input
          type="password"
          placeholder="Mot de passe"
          value={pass}
          onChange={e => setPass(e.target.value)}
          onKeyPress={e => e.key === 'Enter' && login()}
          disabled={loading}
          style={{
            width: '100%',
            padding: '12px',
            marginBottom: '20px',
            borderRadius: '6px',
            border: '2px solid #228B22',
            fontSize: 15,
            boxSizing: 'border-box'
          }}
        />

        <button
          onClick={login}
          disabled={loading}
          style={{
            width: '100%',
            padding: '15px',
            backgroundColor: '#228B22',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: '18px',
            fontWeight: 'bold',
            marginBottom: 15,
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
          }}
        >
          {loading ? "Connexion..." : "Se Connecter"}
        </button>

        <button
          onClick={() => nav("/signup")}
          disabled={loading}
          style={{
            width: '100%',
            padding: '12px',
            backgroundColor: '#FFD700',
            color: '#000',
            border: '2px solid #228B22',
            borderRadius: '6px',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: '16px',
            fontWeight: 'bold'
          }}
        >
          Créer un Compte
        </button>

        {msg && (
          <div style={{
            padding: 15,
            borderRadius: 6,
            marginTop: 15,
            textAlign: 'center',
            fontWeight: 'bold',
            backgroundColor: msg.startsWith("✅") ? "#d4edda" : "#f8d7da",
            color: msg.startsWith("✅") ? "#155724" : "#721c24",
            border: `2px solid ${msg.startsWith("✅") ? "#c3e6cb" : "#f5c6cb"}`
          }}>
            {msg}
          </div>
        )}

        <div style={{
          marginTop: 20,
          textAlign: 'center',
          fontSize: 12,
          color: '#666'
        }}>
          © 2026 - Système Hospitalier du Mali
        </div>
      </div>
    </div>
  );
}