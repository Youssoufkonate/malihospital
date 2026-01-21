import { useState, useEffect } from "react";
import { auth, db } from "../firebase";
import { collection, addDoc, query, orderBy, onSnapshot, getDoc, doc, updateDoc } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";

export default function Accueil() {
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [sex, setSex] = useState("Homme");
  const [symptoms, setSymptoms] = useState("");
  const [dept, setDept] = useState("Pédiatrie");
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [userData, setUserData] = useState(null);
  const [pageLoading, setPageLoading] = useState(true);
  const nav = useNavigate();

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user) {
        checkAuth();
      } else {
        nav("/");
      }
    });

    return () => unsubscribe();
  }, [nav]);

  const checkAuth = async () => {
    if (!auth.currentUser) {
      nav("/");
      return;
    }
    await loadUserData();
    setPageLoading(false);
  };

  const loadUserData = async () => {
    try {
      const userSnap = await getDoc(doc(db, "users", auth.currentUser.uid));
      if (!userSnap.exists()) {
        alert("❌ Données utilisateur introuvables. Veuillez vous réinscrire.");
        await signOut(auth);
        nav("/");
        return;
      }

      const data = userSnap.data();
      setUserData(data);

      // Update last login
      await updateDoc(doc(db, "users", auth.currentUser.uid), {
        lastLoginAt: new Date().toISOString()
      });

      // Check if disabled
      if (data.disabled) {
        alert("❌ Votre compte a été désactivé. Contactez l'administrateur.");
        await signOut(auth);
        nav("/");
        return;
      }

      if (!data.approved) return;

      if (data.role !== "accueil") {
        alert("❌ Accès refusé.");
        await signOut(auth);
        nav("/");
        return;
      }

      loadTickets();
    } catch (e) {
      alert("Erreur de chargement des données: " + e.message);
    }
  };

  const loadTickets = () => {
    const q = query(collection(db, "tickets"), orderBy("createdAt", "desc"));
    onSnapshot(q, snapshot => {
      const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      // Filter tickets from last 24 hours
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentTickets = list.filter(t => new Date(t.createdAt) > twentyFourHoursAgo);
      setTickets(recentTickets);
    });
  };

  const createTicket = async () => {
    if (!name || !age) return alert("Veuillez remplir le nom et l'âge du patient");
    if (!userData?.approved) return alert("Compte pas encore approuvé");

    setLoading(true);

    try {
      const deptLetter = dept.charAt(0).toUpperCase();
      const randomNum = Math.floor(100 + Math.random() * 900);
      const ticketNumber = `${deptLetter}-${randomNum}`;

      const ticketData = {
        ticketNumber,
        patientName: name,
        age: parseInt(age),
        sex,
        symptoms: symptoms || "",
        department: dept,
        status: "waiting",
        createdAt: new Date().toISOString(),
        createdBy: auth.currentUser.uid,
        createdByName: `${userData.firstName} ${userData.lastName}`
      };

      await addDoc(collection(db, "tickets"), ticketData);

      // Print ticket
      printTicket(ticketData);

      setName("");
      setAge("");
      setSex("Homme");
      setSymptoms("");
      setLoading(false);

      alert(`✅ Ticket créé: ${ticketNumber}`);
    } catch (e) {
      alert("❌ Erreur de création du ticket: " + e.message);
      setLoading(false);
    }
  };

  const printTicket = (ticketData) => {
    const printWindow = window.open('', '', 'height=600,width=400');
    printWindow.document.write(`
      <html>
        <head>
          <title>Ticket ${ticketData.ticketNumber}</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              padding: 20px;
              background: linear-gradient(135deg, #228B22 0%, #FFD700 100%);
            }
            .ticket {
              background: white;
              padding: 30px;
              border-radius: 10px;
              box-shadow: 0 4px 6px rgba(0,0,0,0.1);
              border: 3px solid #228B22;
            }
            .header {
              text-align: center;
              border-bottom: 3px solid #FFD700;
              padding-bottom: 15px;
              margin-bottom: 20px;
            }
            .header h1 {
              color: #228B22;
              margin: 10px 0;
              font-size: 24px;
            }
            .ticket-number {
              font-size: 48px;
              font-weight: bold;
              text-align: center;
              color: #228B22;
              margin: 20px 0;
              padding: 20px;
              background: #FFF8DC;
              border-radius: 8px;
              border: 2px solid #FFD700;
            }
            .info {
              margin: 15px 0;
              font-size: 16px;
            }
            .info strong {
              color: #228B22;
            }
            .footer {
              margin-top: 30px;
              padding-top: 15px;
              border-top: 2px dashed #228B22;
              text-align: center;
              font-size: 12px;
              color: #666;
            }
          </style>
        </head>
        <body>
          <div class="ticket">
            <div class="header">
              <h1>🏥 RÉPUBLIQUE DU MALI</h1>
              <h2 style="color: #666; margin: 5px 0;">Système Hospitalier</h2>
            </div>
            <div class="ticket-number">${ticketData.ticketNumber}</div>
            <div class="info">
              <strong>Patient:</strong> ${ticketData.patientName}
            </div>
            <div class="info">
              <strong>Âge:</strong> ${ticketData.age} ans
            </div>
            <div class="info">
              <strong>Sexe:</strong> ${ticketData.sex}
            </div>
            <div class="info">
              <strong>Département:</strong> ${ticketData.department}
            </div>
            <div class="info">
              <strong>Symptômes:</strong> ${ticketData.symptoms || "Non spécifié"}
            </div>
            <div class="info">
              <strong>Date:</strong> ${new Date(ticketData.createdAt).toLocaleString('fr-FR')}
            </div>
            <div class="info">
              <strong>Créé par:</strong> ${ticketData.createdByName}
            </div>
            <div class="footer">
              <p>Veuillez garder ce ticket et attendre votre appel</p>
              <p>Please keep this ticket and wait for your call</p>
            </div>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 250);
  };

  const logout = async () => {
    await signOut(auth);
    nav("/");
  };

  if (pageLoading) {
    return (
      <div style={{ 
        padding: 30,
        background: 'linear-gradient(135deg, #228B22 0%, #FFD700 100%)',
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'white',
        fontSize: 18
      }}>
        Chargement...
      </div>
    );
  }

  if (!userData?.approved) {
    return (
      <div style={{ 
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #228B22 0%, #FFD700 100%)',
        padding: 30,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <div style={{ 
          padding: 30,
          backgroundColor: 'white',
          borderRadius: 8,
          textAlign: 'center',
          maxWidth: 500,
          border: '3px solid #FFD700'
        }}>
          <h2>⚠️ Compte en attente d'approbation</h2>
          <p>Veuillez attendre l'approbation de l'administrateur.</p>
          <button 
            onClick={logout}
            style={{
              marginTop: 20,
              padding: '10px 20px',
              backgroundColor: '#dc3545',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 16
            }}
          >
            Déconnexion
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ 
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #228B22 0%, #FFD700 100%)',
      padding: 30 
    }}>
      <div style={{ 
        maxWidth: 1200,
        margin: '0 auto',
        backgroundColor: 'white',
        borderRadius: 10,
        padding: 30,
        boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
      }}>
        {/* Header */}
        <img src="/Mali.jpg" alt="Logo" style={{ height: 70 }} />
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginBottom: 30,
          paddingBottom: 20,
          borderBottom: '3px solid #228B22'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
            
            <div>
              <h1 style={{ margin: 0, color: '#228B22' }}>
                🏥 Tableau de Bord Accueil
              </h1>
              <p style={{ color: '#666', margin: '5px 0 0 0' }}>
                Bienvenue, {userData?.firstName} {userData?.lastName}
              </p>
            </div>
          </div>
          <button 
            onClick={logout}
            style={{
              padding: '10px 20px',
              backgroundColor: '#dc3545',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 16,
              fontWeight: 'bold'
            }}
          >
            Déconnexion
          </button>
        </div>

        {/* Form */}
        <div style={{ 
          maxWidth: 600,
          margin: '0 auto 40px',
          padding: 30,
          backgroundColor: '#FFF8DC',
          borderRadius: 8,
          border: '2px solid #FFD700'
        }}>
          <h2 style={{ color: '#228B22', marginTop: 0 }}>Créer un nouveau ticket</h2>
          
          <input 
            placeholder="Nom du patient" 
            value={name}
            onChange={e => setName(e.target.value)} 
            disabled={loading}
            style={{
              width: '100%',
              padding: '12px',
              marginBottom: '15px',
              borderRadius: '4px',
              border: '2px solid #228B22',
              fontSize: 16,
              boxSizing: 'border-box'
            }}
          />
          
          <input 
            type="number" 
            placeholder="Âge" 
            value={age}
            onChange={e => setAge(e.target.value)} 
            disabled={loading}
            style={{
              width: '100%',
              padding: '12px',
              marginBottom: '15px',
              borderRadius: '4px',
              border: '2px solid #228B22',
              fontSize: 16,
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
              marginBottom: '15px',
              borderRadius: '4px',
              border: '2px solid #228B22',
              fontSize: 16,
              boxSizing: 'border-box'
            }}
          >
            <option>Homme</option>
            <option>Femme</option>
          </select>
          
          <textarea 
            placeholder="Symptômes" 
            value={symptoms}
            onChange={e => setSymptoms(e.target.value)} 
            disabled={loading}
            style={{
              width: '100%',
              padding: '12px',
              marginBottom: '15px',
              borderRadius: '4px',
              border: '2px solid #228B22',
              fontSize: 16,
              minHeight: 100,
              boxSizing: 'border-box',
              fontFamily: 'Arial, sans-serif'
            }}
          />
          
          <select 
            value={dept} 
            onChange={e => setDept(e.target.value)} 
            disabled={loading}
            style={{
              width: '100%',
              padding: '12px',
              marginBottom: '15px',
              borderRadius: '4px',
              border: '2px solid #228B22',
              fontSize: 16,
              boxSizing: 'border-box'
            }}
          >
            <option>Pédiatrie</option>
            <option>Général</option>
            <option>Maternité</option>
            <option>Cardiologie</option>
          </select>

          <button 
            onClick={createTicket} 
            disabled={loading}
            style={{
              width: '100%',
              padding: '15px',
              backgroundColor: '#228B22',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '18px',
              fontWeight: 'bold'
            }}
          >
            {loading ? "Création en cours..." : "🎫 Créer et Imprimer le Ticket"}
          </button>
        </div>

        {/* Recent Tickets */}
        <div>
          <h2 style={{ color: '#228B22' }}>📋 Tickets Récents (24 dernières heures)</h2>
          
          {tickets.length === 0 ? (
            <div style={{
              padding: 40,
              backgroundColor: '#f8f9fa',
              borderRadius: 8,
              textAlign: 'center',
              color: '#666',
              border: '2px dashed #dee2e6'
            }}>
              <p style={{ fontSize: 18 }}>Aucun ticket récent</p>
            </div>
          ) : (
            <div style={{ 
              display: 'grid',
              gap: 15,
              marginTop: 20
            }}>
              {tickets.map(t => (
                <div 
                  key={t.id}
                  style={{
                    padding: 20,
                    backgroundColor: 
                      t.status === "waiting" ? "#fff3cd" : 
                      t.status === "in-progress" ? "#cfe2ff" : 
                      "#d4edda",
                    borderRadius: 8,
                    border: '2px solid ' + (
                      t.status === "waiting" ? "#ffc107" : 
                      t.status === "in-progress" ? "#007bff" : 
                      "#28a745"
                    ),
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 15
                  }}
                >
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ 
                      fontSize: 24,
                      fontWeight: 'bold',
                      color: '#228B22',
                      marginBottom: 5
                    }}>
                      {t.ticketNumber}
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 'bold' }}>
                      {t.patientName}
                    </div>
                    <div style={{ fontSize: 14, color: '#666', marginTop: 5 }}>
                      {t.age} ans • {t.sex} • {t.department}
                    </div>
                  </div>
                  <div style={{ 
                    display: 'flex',
                    alignItems: 'center',
                    gap: 15
                  }}>
                    <span style={{
                      padding: '8px 16px',
                      borderRadius: 4,
                      backgroundColor: 
                        t.status === "waiting" ? '#ffc107' : 
                        t.status === "in-progress" ? '#007bff' : '#28a745',
                      color: t.status === "waiting" ? '#000' : 'white',
                      fontWeight: 'bold',
                      fontSize: 14
                    }}>
                      {t.status === "waiting" ? "⏳ EN ATTENTE" :
                       t.status === "in-progress" ? "🔄 EN COURS" :
                       "✅ COMPLÉTÉ"}
                    </span>
                    <button
                      onClick={() => printTicket(t)}
                      style={{
                        padding: '8px 16px',
                        backgroundColor: '#17a2b8',
                        color: 'white',
                        border: 'none',
                        borderRadius: 4,
                        cursor: 'pointer',
                        fontWeight: 'bold',
                        fontSize: 14
                      }}
                    >
                      🖨️ Réimprimer
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}