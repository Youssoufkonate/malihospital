import { useState, useEffect, useCallback } from "react";
import { auth, db } from "../firebase";
import { collection, doc, updateDoc, getDoc, query, where, addDoc, onSnapshot } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";

export default function Doctor() {
  const [allTickets, setAllTickets] = useState([]);
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("active");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const nav = useNavigate();

  const loadTickets = useCallback((user) => {
    setLoading(true);
    
    console.log("🔍 Querying tickets for department:", user.department);
    
    const q = query(
      collection(db, "tickets"),
      where("department", "==", user.department)
    );

    const unsubscribe = onSnapshot(q, 
      (snapshot) => {
        const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        
        console.log("📋 Total tickets found for", user.department, ":", list.length);
        console.log("📋 Tickets:", list);
        
        list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        setAllTickets(list);
        setLoading(false);
      },
      (error) => {
        console.error("Error loading tickets:", error);
        if (error.code === 'permission-denied') {
          alert("⚠️ Pas de permission. Votre compte nécessite peut-être une approbation.");
        }
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const checkAuthAndLoad = async () => {
      if (!auth.currentUser) {
        nav("/");
        return;
      }

      try {
        const userSnap = await getDoc(doc(db, "users", auth.currentUser.uid));
        
        if (!userSnap.exists()) {
          alert("❌ Données utilisateur introuvables.");
          await signOut(auth);
          nav("/");
          return;
        }

        const user = userSnap.data();
        setUserData(user);

        console.log("👤 Doctor User Data:", user);
        console.log("🏥 Doctor Department:", user.department);

        if (user.disabled) {
          alert("❌ Votre compte a été désactivé. Contactez l'administrateur.");
          await signOut(auth);
          nav("/");
          return;
        }

        if (!user.approved) {
          setPageLoading(false);
          return;
        }

        if (user.role !== "doctor") {
          alert("❌ Accès refusé. Cette page est réservée aux médecins.");
          await signOut(auth);
          nav("/");
          return;
        }

        if (!user.department) {
          alert("❌ Votre compte n'a pas de département assigné. Contactez l'administrateur.");
          setPageLoading(false);
          return;
        }

        loadTickets(user);
        setPageLoading(false);
      } catch (e) {
        console.error("Error loading user data:", e);
        alert("Erreur de chargement des données: " + e.message);
        setPageLoading(false);
      }
    };

    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user) {
        checkAuthAndLoad();
      } else {
        nav("/");
      }
    });

    return () => unsubscribe();
  }, [nav, loadTickets]);

  const updateStatus = async (ticketId, newStatus) => {
    try {
      await updateDoc(doc(db, "tickets", ticketId), {
        status: newStatus,
        updatedAt: new Date().toISOString(),
        updatedBy: auth.currentUser.uid
      });
      console.log("✅ Ticket status updated to:", newStatus);
    } catch (e) {
      console.error("Error updating ticket:", e);
      alert("❌ Erreur de mise à jour: " + e.message);
    }
  };

  const callPatient = async (ticket) => {
    try {
      if (!ticket.ticketNumber || !ticket.patientName) {
        alert("❌ Données de ticket invalides");
        return;
      }

      if (!userData?.room) {
        alert("❌ Numéro de chambre non défini. Contactez l'administrateur.");
        return;
      }

      // Debug logging
      console.log("🔍 Ticket department:", ticket.department);
      console.log("🔍 Doctor department:", userData.department);
      console.log("🔍 Do they match?", ticket.department === userData.department);

      const callData = {
        ticketNumber: ticket.ticketNumber,
        patientName: ticket.patientName,
        department: ticket.department, // Use the ticket's department
        doctorId: auth.currentUser.uid,
        doctorName: `Dr. ${userData.firstName} ${userData.lastName}`,
        calledAt: new Date().toISOString(),
        room: userData.room
      };

      console.log("📝 Creating call with data:", callData);

      const docRef = await addDoc(collection(db, "calls"), callData);
      
      console.log("✅ Call created with ID:", docRef.id);
      console.log("✅ Call document created successfully in 'calls' collection");

      // Update ticket status if it's waiting
      if (ticket.status === "waiting") {
        await updateStatus(ticket.id, "in-progress");
      }

      alert(`📢 Appelé: ${ticket.patientName} (${ticket.ticketNumber}) à la chambre ${userData.room}`);
    } catch (e) {
      console.error("❌ Full error:", e);
      console.error("❌ Error code:", e.code);
      console.error("❌ Error message:", e.message);
      
      if (e.code === 'permission-denied') {
        alert("❌ Permission refusée pour créer un appel.\n\nVérifiez que:\n1. Votre compte est approuvé\n2. Vous êtes connecté en tant que médecin\n3. Les règles Firestore autorisent les médecins à créer des appels");
      } else {
        alert("❌ Erreur d'appel du patient: " + e.message);
      }
    }
  };

  const logout = async () => {
    await signOut(auth);
    nav("/");
  };

  const getFilteredTickets = () => {
    let filtered = allTickets;

    if (activeTab === "active") {
      filtered = filtered.filter(t => t.status === "waiting" || t.status === "in-progress");
    } else if (activeTab === "completed") {
      filtered = filtered.filter(t => t.status === "completed");
    }

    if (searchTerm) {
      filtered = filtered.filter(t => 
        t.patientName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.ticketNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.symptoms?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    if (activeTab === "active" && filterStatus !== "all") {
      filtered = filtered.filter(t => t.status === filterStatus);
    }

    return filtered;
  };

  if (pageLoading) {
    return (
      <div style={{ 
        padding: 30, 
        textAlign: 'center',
        fontSize: 18,
        marginTop: 50,
        background: 'linear-gradient(135deg, #228B22 0%, #FFD700 100%)',
        minHeight: '100vh',
        color: 'white'
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
          maxWidth: 500,
          backgroundColor: 'white',
          border: '3px solid #FFD700',
          borderRadius: 8,
          textAlign: 'center'
        }}>
          <h2>⚠️ Compte en attente d'approbation</h2>
          <p>Votre compte a été créé mais attend l'approbation de l'administrateur.</p>
          <p>Veuillez contacter votre administrateur système pour activer votre compte.</p>
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

  if (!userData?.department) {
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
          maxWidth: 500,
          backgroundColor: 'white',
          border: '3px solid #dc3545',
          borderRadius: 8,
          textAlign: 'center'
        }}>
          <h2>⚠️ Configuration Requise</h2>
          <p>Votre compte n'a pas de département assigné.</p>
          <p>Veuillez contacter l'administrateur pour configurer votre département et votre numéro de chambre.</p>
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

  const filteredTickets = getFilteredTickets();
  const activeCount = allTickets.filter(t => t.status === "waiting" || t.status === "in-progress").length;
  const completedCount = allTickets.filter(t => t.status === "completed").length;

  return (
    <div style={{ 
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #228B22 0%, #FFD700 100%)',
      padding: 30 
    }}>
      
      <div style={{ 
        maxWidth: 1400,
        margin: '0 auto',
        backgroundColor: 'white',
        borderRadius: 10,
        padding: 30,
        boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
      }}><img src="/Mali.jpg" alt="Logo" style={{ height: 60 }} />
        <div style={{ 
          display: "flex", 
          justifyContent: "space-between", 
          alignItems: "center",
          marginBottom: 20,
          paddingBottom: 20,
          borderBottom: '3px solid #228B22'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
            
            <div>
              <h1 style={{ margin: 0, color: '#228B22' }}>
                👨‍⚕️ Bonjour, Dr. {userData.firstName} {userData.lastName}
              </h1>
              <p style={{ color: "#666", margin: '5px 0 0 0' }}>
                Département: {userData.department} | Chambre: {userData.room}
              </p>
              <p style={{ color: '#28a745', margin: '5px 0 0 0', fontWeight: 'bold' }}>
                Statut: ✅ Approuvé
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

        <div style={{ 
          display: 'flex', 
          gap: 10, 
          marginBottom: 20,
          borderBottom: '2px solid #dee2e6'
        }}>
          <button
            onClick={() => setActiveTab("active")}
            style={{
              padding: '12px 24px',
              border: 'none',
              borderBottom: activeTab === "active" ? '3px solid #228B22' : 'none',
              backgroundColor: activeTab === "active" ? '#f8f9fa' : 'transparent',
              cursor: 'pointer',
              fontWeight: activeTab === "active" ? 'bold' : 'normal',
              fontSize: 16,
              color: activeTab === "active" ? '#228B22' : '#666'
            }}
          >
            🏠 File d'attente ({activeCount})
          </button>
          <button
            onClick={() => setActiveTab("completed")}
            style={{
              padding: '12px 24px',
              border: 'none',
              borderBottom: activeTab === "completed" ? '3px solid #228B22' : 'none',
              backgroundColor: activeTab === "completed" ? '#f8f9fa' : 'transparent',
              cursor: 'pointer',
              fontWeight: activeTab === "completed" ? 'bold' : 'normal',
              fontSize: 16,
              color: activeTab === "completed" ? '#228B22' : '#666'
            }}
          >
            ✅ Complétés ({completedCount})
          </button>
        </div>

        <div style={{ 
          display: 'flex', 
          gap: 15, 
          marginBottom: 20,
          padding: 15,
          backgroundColor: '#FFF8DC',
          borderRadius: 8,
          border: '2px solid #FFD700'
        }}>
          <input
            type="text"
            placeholder="🔍 Rechercher par nom, numéro ou symptômes..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              flex: 1,
              padding: '10px',
              borderRadius: '4px',
              border: '1px solid #ccc',
              fontSize: 14
            }}
          />
          {activeTab === "active" && (
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              style={{
                padding: '10px',
                borderRadius: '4px',
                border: '1px solid #ccc',
                fontSize: 14
              }}
            >
              <option value="all">Tous les statuts</option>
              <option value="waiting">En attente</option>
              <option value="in-progress">En cours</option>
            </select>
          )}
        </div>

        <h2 style={{ marginTop: 30, color: '#228B22' }}>
          📋 {activeTab === "active" ? "Patients en attente" : "Patients complétés"} - {userData.department}
        </h2>
      
        {loading ? (
          <p style={{ marginTop: 20, color: "#666" }}>Chargement des tickets...</p>
        ) : filteredTickets.length === 0 ? (
          <div style={{
            marginTop: 20,
            padding: 40,
            backgroundColor: '#f8f9fa',
            borderRadius: 8,
            textAlign: 'center',
            color: '#666',
            border: '2px dashed #dee2e6'
          }}>
            <p style={{ fontSize: 18 }}>
              {activeTab === "active" ? "Aucun patient dans la file d'attente" : "Aucun patient complété"}
            </p>
            <p style={{ fontSize: 14 }}>
              {activeTab === "active" ? "En attente de nouveaux tickets..." : "Les tickets complétés apparaîtront ici"}
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto', marginTop: 20 }}>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              backgroundColor: 'white',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
            }}>
              <thead>
                <tr style={{ backgroundColor: '#228B22', color: 'white' }}>
                  <th style={{ padding: 15, textAlign: 'left' }}>Ticket #</th>
                  <th style={{ padding: 15, textAlign: 'left' }}>Patient</th>
                  <th style={{ padding: 15, textAlign: 'left' }}>Âge</th>
                  <th style={{ padding: 15, textAlign: 'left' }}>Sexe</th>
                  <th style={{ padding: 15, textAlign: 'left' }}>Symptômes</th>
                  <th style={{ padding: 15, textAlign: 'left' }}>Statut</th>
                  <th style={{ padding: 15, textAlign: 'left' }}>Créé le</th>
                  <th style={{ padding: 15, textAlign: 'left' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTickets.map(t => (
                  <tr key={t.id} style={{
                    backgroundColor: 
                      t.status === "waiting" ? "#fff3cd" : 
                      t.status === "in-progress" ? "#cfe2ff" : 
                      "#d4edda",
                    borderBottom: '1px solid #dee2e6'
                  }}>
                    <td style={{ padding: 15, fontWeight: "bold", color: "#228B22" }}>
                      {t.ticketNumber || "N/A"}
                    </td>
                    <td style={{ padding: 15, fontWeight: "bold" }}>{t.patientName}</td>
                    <td style={{ padding: 15 }}>{t.age} ans</td>
                    <td style={{ padding: 15 }}>{t.sex || "-"}</td>
                    <td style={{ padding: 15, maxWidth: 200, fontSize: 14 }}>
                      {t.symptoms || "-"}
                    </td>
                    <td style={{ padding: 15 }}>
                      {t.status === "waiting" && (
                        <span style={{ 
                          padding: '5px 10px',
                          borderRadius: 4,
                          backgroundColor: '#ffc107',
                          color: '#000',
                          fontWeight: 'bold',
                          fontSize: 12
                        }}>
                          ⏳ EN ATTENTE
                        </span>
                      )}
                      {t.status === "in-progress" && (
                        <span style={{ 
                          padding: '5px 10px',
                          borderRadius: 4,
                          backgroundColor: '#007bff',
                          color: 'white',
                          fontWeight: 'bold',
                          fontSize: 12
                        }}>
                          🔄 EN COURS
                        </span>
                      )}
                      {t.status === "completed" && (
                        <span style={{ 
                          padding: '5px 10px',
                          borderRadius: 4,
                          backgroundColor: '#28a745',
                          color: 'white',
                          fontWeight: 'bold',
                          fontSize: 12
                        }}>
                          ✅ COMPLÉTÉ
                        </span>
                      )}
                    </td>
                    <td style={{ padding: 15, fontSize: 12, color: '#666' }}>
                      {new Date(t.createdAt).toLocaleString('fr-FR')}
                    </td>
                    <td style={{ padding: 15 }}>
                      <div style={{ display: "flex", gap: 8, flexDirection: "column" }}>
                        {(t.status === "waiting" || t.status === "in-progress") && (
                          <button 
                            onClick={() => callPatient(t)}
                            style={{ 
                              backgroundColor: "#007bff", 
                              color: 'white',
                              padding: "10px 15px",
                              border: 'none',
                              borderRadius: 4,
                              cursor: 'pointer',
                              fontWeight: 'bold',
                              fontSize: 14
                            }}
                          >
                            📢 Appeler
                          </button>
                        )}
                        
                        {t.status === "waiting" && (
                          <button 
                            onClick={() => updateStatus(t.id, "in-progress")}
                            style={{ 
                              backgroundColor: "#17a2b8",
                              color: 'white',
                              padding: "10px 15px",
                              border: 'none',
                              borderRadius: 4,
                              cursor: 'pointer',
                              fontWeight: 'bold',
                              fontSize: 14
                            }}
                          >
                            ▶ Commencer
                          </button>
                        )}
                        
                        {t.status === "in-progress" && (
                          <button 
                            onClick={() => updateStatus(t.id, "completed")} 
                            style={{ 
                              backgroundColor: "#28a745",
                              color: 'white',
                              padding: "10px 15px",
                              border: 'none',
                              borderRadius: 4,
                              cursor: 'pointer',
                              fontWeight: 'bold',
                              fontSize: 14
                            }}
                          >
                            ✓ Terminer
                          </button>
                        )}
                        
                        {t.status === "completed" && (
                          <span style={{ 
                            padding: "10px 15px",
                            color: '#28a745',
                            fontWeight: 'bold',
                            fontSize: 14
                          }}>
                            Terminé ✓
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
