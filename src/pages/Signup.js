import { useState } from "react";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { auth, db } from "../firebase";
import { doc, setDoc, getDoc } from "firebase/firestore";
import { useNavigate } from "react-router-dom";

export default function Signup() {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [sex, setSex] = useState("Homme");
  const [role, setRole] = useState("accueil");
  const [dept, setDept] = useState("Pédiatrie");
  const [room, setRoom] = useState("");
  const [adminCode, setAdminCode] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [showAdminOption, setShowAdminOption] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const nav = useNavigate();

  const ADMIN_SECRET_CODE = "HOSPITAL_MALI_2025";

  const signup = async () => {
    if (!first || !last || !email || !pass) {
      setMsg("❌ Veuillez remplir tous les champs");
      return;
    }

    if (!acceptedTerms || !acceptedPrivacy) {
      setMsg("❌ Veuillez accepter les Conditions d'Utilisation et la Politique de Confidentialité");
      return;
    }

    if (role === "admin" && adminCode !== ADMIN_SECRET_CODE) {
      setMsg("❌ Code administrateur invalide");
      return;
    }

    if (role === "doctor" && !room) {
      setMsg("❌ Veuillez spécifier le numéro de chambre");
      return;
    }

    setLoading(true);
    setMsg("");

    try {
      const res = await createUserWithEmailAndPassword(auth, email, pass);

      let isFirstUser = false;
      try {
        const configDoc = await getDoc(doc(db, "config", "setup"));
        isFirstUser = !configDoc.exists();
      } catch (err) {
        isFirstUser = false;
      }

      const shouldApprove = isFirstUser || (role === "admin" && adminCode === ADMIN_SECRET_CODE);

      await setDoc(doc(db, "users", res.user.uid), {
        firstName: first,
        lastName: last,
        email,
        sex,
        role,
        department: role === "doctor" ? dept : null,
        room: role === "doctor" ? room : null,
        approved: shouldApprove,
        disabled: false,
        createdAt: new Date().toISOString(),
        acceptedTerms: true,
        acceptedPrivacy: true,
        termsAcceptedAt: new Date().toISOString()
      });

      if (isFirstUser) {
        try {
          await setDoc(doc(db, "config", "setup"), {
            initialized: true,
            firstUserCreated: new Date().toISOString()
          });
        } catch (err) {
          console.log("Could not create config doc:", err);
        }
      }

      if (shouldApprove) {
        setMsg("✅ Compte administrateur créé! Vous pouvez vous connecter maintenant.");
      } else {
        setMsg("✅ Compte créé! En attente de l'approbation de l'administrateur.");
      }
      
      setTimeout(() => {
        nav("/");
      }, 2000);

    } catch (e) {
      console.error("Signup error:", e);
      if (e.code === "auth/network-request-failed") {
        setMsg("❌ Erreur réseau. Vérifiez votre connexion internet.");
      } else if (e.code === "auth/email-already-in-use") {
        setMsg("❌ Cet email est déjà enregistré.");
      } else if (e.code === "auth/weak-password") {
        setMsg("❌ Le mot de passe doit contenir au moins 6 caractères.");
      } else if (e.code === "auth/invalid-email") {
        setMsg("❌ Adresse email invalide.");
      } else {
        setMsg("❌ " + e.message);
      }
      setLoading(false);
    }
  };

  // Terms Modal
  if (showTerms) {
    return (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        zIndex: 1000,
        overflowY: 'auto'
      }}>
        <div style={{
          backgroundColor: 'white',
          padding: 40,
          borderRadius: 10,
          maxWidth: 800,
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          border: '3px solid #228B22'
        }}>
          <h2 style={{ color: '#228B22', textAlign: 'center', marginBottom: 20 }}>
            📜 Conditions d'Utilisation
          </h2>
          <div style={{ fontSize: 14, lineHeight: 1.8, color: '#333' }}>
            <p><strong>Système Hospitalier – République du Mali</strong></p>
            <p><em>Dernière mise à jour : 20 janvier 2026</em></p>
            
            <h3 style={{ color: '#228B22', marginTop: 20 }}>1. Objet</h3>
            <p>Les présentes Conditions d'Utilisation régissent l'accès et l'utilisation du système informatique hospitalier (« le Système ») destiné à la gestion des patients, du personnel et des files d'attente au sein des établissements de santé de la République du Mali.</p>
            <p>En utilisant ce Système, vous acceptez pleinement et sans réserve les présentes conditions.</p>
            
            <h3 style={{ color: '#228B22', marginTop: 20 }}>2. Accès au Système</h3>
            <p>L'accès est strictement réservé :</p>
            <ul>
              <li>au personnel autorisé de l'hôpital,</li>
              <li>aux administrateurs habilités,</li>
              <li>et aux utilisateurs disposant d'un compte validé.</li>
            </ul>
            <p>Tout accès non autorisé est interdit et peut faire l'objet de sanctions disciplinaires et/ou judiciaires.</p>
            
            <h3 style={{ color: '#228B22', marginTop: 20 }}>3. Création de Compte</h3>
            <p>L'utilisateur s'engage à fournir des informations exactes, complètes et à jour. Chaque compte est personnel et confidentiel. Il est interdit de partager ses identifiants.</p>
            
            <h3 style={{ color: '#228B22', marginTop: 20 }}>4. Utilisation Autorisée</h3>
            <p>Vous vous engagez à :</p>
            <ul>
              <li>Utiliser le Système uniquement à des fins professionnelles et médicales,</li>
              <li>Respecter la confidentialité des données patients,</li>
              <li>Ne pas modifier ou supprimer des données sans autorisation.</li>
            </ul>
            
            <h3 style={{ color: '#228B22', marginTop: 20 }}>5. Responsabilités</h3>
            <p>L'hôpital met tout en œuvre pour assurer la sécurité et la disponibilité du Système. Toutefois, il ne saurait être tenu responsable des interruptions techniques ou pertes de données indépendantes de sa volonté.</p>
            
            <h3 style={{ color: '#228B22', marginTop: 20 }}>6. Suspension ou Résiliation</h3>
            <p>L'hôpital se réserve le droit de suspendre ou supprimer tout compte en cas de :</p>
            <ul>
              <li>Non-respect des présentes conditions,</li>
              <li>Usage frauduleux ou abusif,</li>
              <li>Violation des règles internes.</li>
            </ul>
            
            <h3 style={{ color: '#228B22', marginTop: 20 }}>7. Droit Applicable</h3>
            <p>Les présentes Conditions sont régies par les lois de la République du Mali. Tout litige sera soumis aux juridictions compétentes du Mali.</p>
            
            <p style={{ textAlign: 'center', marginTop: 30, fontWeight: 'bold' }}>
              © 2026 – Système Hospitalier – République du Mali
            </p>
          </div>
          
          <button
            onClick={() => setShowTerms(false)}
            style={{
              width: '100%',
              padding: '15px',
              backgroundColor: '#228B22',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '16px',
              fontWeight: 'bold',
              marginTop: 20
            }}
          >
            Fermer
          </button>
        </div>
      </div>
    );
  }

  // Privacy Modal
  if (showPrivacy) {
    return (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        zIndex: 1000,
        overflowY: 'auto'
      }}>
        <div style={{
          backgroundColor: 'white',
          padding: 40,
          borderRadius: 10,
          maxWidth: 800,
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          border: '3px solid #228B22'
        }}>
          <h2 style={{ color: '#228B22', textAlign: 'center', marginBottom: 20 }}>
            🔒 Politique de Confidentialité
          </h2>
          <div style={{ fontSize: 14, lineHeight: 1.8, color: '#333' }}>
            <p><strong>Système Hospitalier – République du Mali</strong></p>
            
            <h3 style={{ color: '#228B22', marginTop: 20 }}>1. Collecte des Données</h3>
            <p>Nous collectons uniquement les données nécessaires au bon fonctionnement du Système :</p>
            <ul>
              <li>Nom, prénom, email,</li>
              <li>Rôle professionnel,</li>
              <li>Département et chambre (pour les médecins),</li>
              <li>Informations liées à l'activité hospitalière.</li>
            </ul>
            
            <h3 style={{ color: '#228B22', marginTop: 20 }}>2. Utilisation des Données</h3>
            <p>Les données sont utilisées pour :</p>
            <ul>
              <li>La gestion des comptes utilisateurs,</li>
              <li>L'organisation des services médicaux,</li>
              <li>La sécurité et la traçabilité des accès.</li>
            </ul>
            
            <h3 style={{ color: '#228B22', marginTop: 20 }}>3. Protection des Données</h3>
            <p>Nous mettons en place des mesures techniques et organisationnelles pour protéger vos données contre :</p>
            <ul>
              <li>L'accès non autorisé,</li>
              <li>La perte,</li>
              <li>La modification ou la divulgation illicite.</li>
            </ul>
            
            <h3 style={{ color: '#228B22', marginTop: 20 }}>4. Confidentialité Médicale</h3>
            <p>Les données liées aux patients sont strictement confidentielles. Seul le personnel autorisé peut y accéder dans le cadre de ses fonctions.</p>
            
            <h3 style={{ color: '#228B22', marginTop: 20 }}>5. Partage des Données</h3>
            <p>Aucune donnée personnelle n'est vendue ni partagée avec des tiers, sauf obligation légale ou autorisation officielle.</p>
            
            <h3 style={{ color: '#228B22', marginTop: 20 }}>6. Durée de Conservation</h3>
            <p>Les données sont conservées pendant la durée nécessaire à l'activité hospitalière et conformément aux lois maliennes en vigueur.</p>
            
            <h3 style={{ color: '#228B22', marginTop: 20 }}>7. Vos Droits</h3>
            <p>Vous avez le droit de :</p>
            <ul>
              <li>Accéder à vos données,</li>
              <li>Demander leur correction,</li>
              <li>Demander leur suppression (sous réserve d'obligations légales).</li>
            </ul>
            
            <h3 style={{ color: '#228B22', marginTop: 20 }}>8. Contact</h3>
            <p>Pour toute question relative à cette Politique, veuillez contacter l'administration de l'hôpital.</p>
            
            <p style={{ textAlign: 'center', marginTop: 30, fontWeight: 'bold' }}>
              © 2026 – Système Hospitalier – République du Mali
            </p>
          </div>
          
          <button
            onClick={() => setShowPrivacy(false)}
            style={{
              width: '100%',
              padding: '15px',
              backgroundColor: '#228B22',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '16px',
              fontWeight: 'bold',
              marginTop: 20
            }}
          >
            Fermer
          </button>
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
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
      </div>
      <img src="/Mali.jpg" alt="Logo" style={{ height: 60, marginRight: 20 }} /> &nbsp;&nbsp;
      <div style={{ 
        padding: 40,
        maxWidth: 500,
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
          <h1 style={{ 
            margin: '20px 0 10px',
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
          📝 Créer un Compte
        </h2>

        <input 
          placeholder="Prénom" 
          value={first}
          onChange={e => setFirst(e.target.value)} 
          disabled={loading}
          style={{
            width: '100%',
            padding: '12px',
            marginBottom: '12px',
            borderRadius: '6px',
            border: '2px solid #228B22',
            fontSize: 15,
            boxSizing: 'border-box'
          }}
        />
        
        <input 
          placeholder="Nom" 
          value={last}
          onChange={e => setLast(e.target.value)} 
          disabled={loading}
          style={{
            width: '100%',
            padding: '12px',
            marginBottom: '12px',
            borderRadius: '6px',
            border: '2px solid #228B22',
            fontSize: 15,
            boxSizing: 'border-box'
          }}
        />
        
        <input 
          placeholder="Email" 
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)} 
          disabled={loading}
          style={{
            width: '100%',
            padding: '12px',
            marginBottom: '12px',
            borderRadius: '6px',
            border: '2px solid #228B22',
            fontSize: 15,
            boxSizing: 'border-box'
          }}
        />
        
        <input 
          type="password" 
          placeholder="Mot de passe (min 6 caractères)" 
          value={pass}
          onChange={e => setPass(e.target.value)} 
          disabled={loading}
          style={{
            width: '100%',
            padding: '12px',
            marginBottom: '12px',
            borderRadius: '6px',
            border: '2px solid #228B22',
            fontSize: 15,
            boxSizing: 'border-box'
          }}
        />

        <select 
          value={sex} 
          onChange={e => setSex(e.target.value)} 
          disabled={loading}
          style={{
            width: '100%',
            padding: '12px',
            marginBottom: '12px',
            borderRadius: '6px',
            border: '2px solid #228B22',
            fontSize: 15,
            boxSizing: 'border-box'
          }}
        >
          <option value="Homme">Homme</option>
          <option value="Femme">Femme</option>
        </select>

        <select 
          value={role} 
          onChange={e => setRole(e.target.value)} 
          disabled={loading}
          style={{
            width: '100%',
            padding: '12px',
            marginBottom: '12px',
            borderRadius: '6px',
            border: '2px solid #228B22',
            fontSize: 15,
            boxSizing: 'border-box'
          }}
        >
          <option value="accueil">Accueil</option>
          <option value="doctor">Médecin</option>
          {showAdminOption && <option value="admin">Administrateur</option>}
        </select>

        {role === "doctor" && (
          <>
            <select 
              value={dept} 
              onChange={e => setDept(e.target.value)} 
              disabled={loading}
              style={{
                width: '100%',
                padding: '12px',
                marginBottom: '12px',
                borderRadius: '6px',
                border: '2px solid #228B22',
                fontSize: 15,
                boxSizing: 'border-box'
              }}
            >
              <option value="Pédiatrie">Pédiatrie</option>
              <option value="Général">Général</option>
              <option value="Maternité">Maternité</option>
              <option value="Cardiologie">Cardiologie</option>
            </select>
            
            <input
              placeholder="Numéro de chambre (ex: 101)"
              value={room}
              onChange={e => setRoom(e.target.value)}
              disabled={loading}
              style={{
                width: '100%',
                padding: '12px',
                marginBottom: '12px',
                borderRadius: '6px',
                border: '2px solid #228B22',
                fontSize: 15,
                boxSizing: 'border-box'
              }}
            />
          </>
        )}

        {role === "admin" && (
          <input
            type="password"
            placeholder="Code Secret Administrateur"
            value={adminCode}
            onChange={e => setAdminCode(e.target.value)}
            disabled={loading}
            style={{
              width: '100%',
              padding: '12px',
              marginBottom: '12px',
              borderRadius: '6px',
              border: '2px solid #FFD700',
              fontSize: 15,
              boxSizing: 'border-box',
              backgroundColor: '#FFF8DC'
            }}
          />
        )}

        {/* Terms and Privacy Checkboxes */}
        <div style={{
          padding: '15px',
          backgroundColor: '#FFF8DC',
          borderRadius: '6px',
          border: '2px solid #FFD700',
          marginBottom: '15px'
        }}>
          <label style={{
            display: 'flex',
            alignItems: 'flex-start',
            cursor: 'pointer',
            marginBottom: '10px',
            fontSize: 14
          }}>
            <input
              type="checkbox"
              checked={acceptedTerms}
              onChange={e => setAcceptedTerms(e.target.checked)}
              disabled={loading}
              style={{
                marginRight: 10,
                marginTop: 3,
                cursor: 'pointer',
                width: 18,
                height: 18
              }}
            />
            <span>
              J'accepte les{' '}
              <span
                onClick={(e) => {
                  e.preventDefault();
                  setShowTerms(true);
                }}
                style={{
                  color: '#228B22',
                  textDecoration: 'underline',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                Conditions d'Utilisation
              </span>
            </span>
          </label>

          <label style={{
            display: 'flex',
            alignItems: 'flex-start',
            cursor: 'pointer',
            fontSize: 14
          }}>
            <input
              type="checkbox"
              checked={acceptedPrivacy}
              onChange={e => setAcceptedPrivacy(e.target.checked)}
              disabled={loading}
              style={{
                marginRight: 10,
                marginTop: 3,
                cursor: 'pointer',
                width: 18,
                height: 18
              }}
            />
            <span>
              J'accepte la{' '}
              <span
                onClick={(e) => {
                  e.preventDefault();
                  setShowPrivacy(true);
                }}
                style={{
                  color: '#228B22',
                  textDecoration: 'underline',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                Politique de Confidentialité
              </span>
            </span>
          </label>
        </div>

        <button 
          onClick={signup} 
          disabled={loading || !acceptedTerms || !acceptedPrivacy}
          style={{
            width: '100%',
            padding: '15px',
            backgroundColor: (!acceptedTerms || !acceptedPrivacy) ? '#ccc' : '#228B22',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: (loading || !acceptedTerms || !acceptedPrivacy) ? 'not-allowed' : 'pointer',
            fontSize: '18px',
            fontWeight: 'bold',
            marginBottom: 15,
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
            opacity: (!acceptedTerms || !acceptedPrivacy) ? 0.6 : 1
          }}
        >
          {loading ? "Création..." : "Créer le Compte"}
        </button>

        <button 
          onClick={() => nav("/")} 
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
          ← Retour à la Connexion
        </button>

        <div 
          onClick={() => setShowAdminOption(prev => !prev)} 
          style={{ 
            marginTop: 20, 
            textAlign: 'center', 
            fontSize: 10, 
            color: '#ccc',
            cursor: 'pointer',
            userSelect: 'none'
          }}
        >
          v1.0 - Mali
        </div>

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
      </div>
    </div>
  );
}