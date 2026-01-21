import { useState, useEffect } from "react";
import { db, auth } from "../firebase";
import { collection, getDocs, doc, updateDoc, getDoc, deleteDoc, addDoc, query, where, orderBy, limit } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";

export default function AdminPanel() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [msg, setMsg] = useState("");
  const [activeTab, setActiveTab] = useState("users");
  const [userSubTab, setUserSubTab] = useState("home");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterRole, setFilterRole] = useState("all");
  const [editingUser, setEditingUser] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [stats, setStats] = useState({ byDepartment: [], byDoctor: [], monthly: [] });
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [statsLoading, setStatsLoading] = useState(false);
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [filterAction, setFilterAction] = useState("all");
  
  const nav = useNavigate();

  useEffect(() => {
    checkAuthAndLoad();
  }, []);

  useEffect(() => {
    if (activeTab === "statistics") loadStatistics();
    else if (activeTab === "logs") loadLogs();
  }, [activeTab, selectedYear]);

  const checkAuthAndLoad = async () => {
    if (!auth.currentUser) {
      nav("/");
      return;
    }
    try {
      const userDoc = await getDoc(doc(db, "users", auth.currentUser.uid));
      const userData = userDoc.data();
      setCurrentUser(userData);
      await updateDoc(doc(db, "users", auth.currentUser.uid), {
        lastLoginAt: new Date().toISOString()
      });
      if (userData?.role !== "admin") {
        setMsg("❌ Accès refusé. Administrateurs seulement.");
        setTimeout(() => nav("/"), 2000);
        return;
      }
      if (!userData?.approved) {
        setMsg("❌ Votre compte administrateur n'est pas encore approuvé.");
        setTimeout(() => nav("/"), 2000);
        return;
      }
      await loadUsers();
    } catch (err) {
      console.error("Error loading:", err);
      setMsg("❌ Erreur: " + err.message);
      setLoading(false);
    }
  };

  const loadUsers = async () => {
    try {
      const usersSnap = await getDocs(collection(db, "users"));
      const usersList = usersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setUsers(usersList);
      setLoading(false);
    } catch (err) {
      console.error("Error loading users:", err);
      setMsg("❌ Erreur de chargement des utilisateurs: " + err.message);
      setLoading(false);
    }
  };

  const logAdminAction = async (action, targetUserId, targetUserName, details = {}) => {
    try {
      await addDoc(collection(db, "adminLogs"), {
        adminId: auth.currentUser.uid,
        adminName: `${currentUser.firstName} ${currentUser.lastName}`,
        adminEmail: auth.currentUser.email,
        action, targetUserId, targetUserName, details,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("Error logging action:", error);
    }
  };

  const approveUser = async (userId, user) => {
    try {
      await updateDoc(doc(db, "users", userId), {
        approved: true, disabled: false, deniedAt: null, approvedAt: new Date().toISOString()
      });
      await logAdminAction("approve", userId, `${user.firstName} ${user.lastName}`, { role: user.role, email: user.email });
      setMsg("✅ Utilisateur approuvé!");
      await loadUsers();
      setTimeout(() => setMsg(""), 3000);
    } catch (err) {
      console.error("Error approving user:", err);
      setMsg("❌ Erreur: " + err.message);
    }
  };

  const denyUser = async (userId, user) => {
    try {
      await updateDoc(doc(db, "users", userId), {
        approved: false, disabled: true, deniedAt: new Date().toISOString()
      });
      await logAdminAction("deny", userId, `${user.firstName} ${user.lastName}`, { role: user.role, email: user.email });
      setMsg("✅ Utilisateur refusé!");
      await loadUsers();
      setTimeout(() => setMsg(""), 3000);
    } catch (err) {
      console.error("Error denying user:", err);
      setMsg("❌ Erreur: " + err.message);
    }
  };

  const disableUser = async (userId, user) => {
    try {
      await updateDoc(doc(db, "users", userId), {
        disabled: true, disabledAt: new Date().toISOString()
      });
      await logAdminAction("disable", userId, `${user.firstName} ${user.lastName}`, { role: user.role, email: user.email });
      setMsg("✅ Utilisateur désactivé!");
      await loadUsers();
      setTimeout(() => setMsg(""), 3000);
    } catch (err) {
      console.error("Error disabling user:", err);
      setMsg("❌ Erreur: " + err.message);
    }
  };

  const enableUser = async (userId, user) => {
    try {
      await updateDoc(doc(db, "users", userId), {
        disabled: false, approved: true, disabledAt: null
      });
      await logAdminAction("enable", userId, `${user.firstName} ${user.lastName}`, { role: user.role, email: user.email });
      setMsg("✅ Utilisateur réactivé!");
      await loadUsers();
      setTimeout(() => setMsg(""), 3000);
    } catch (err) {
      console.error("Error enabling user:", err);
      setMsg("❌ Erreur: " + err.message);
    }
  };

  const deleteUser = async (userId, user) => {
    if (!window.confirm(`Êtes-vous sûr de vouloir supprimer ${user.firstName} ${user.lastName}?`)) return;
    try {
      await logAdminAction("delete", userId, `${user.firstName} ${user.lastName}`, 
        { role: user.role, email: user.email, department: user.department || "N/A" });
      await deleteDoc(doc(db, "users", userId));
      setMsg("✅ Utilisateur supprimé!");
      await loadUsers();
      setTimeout(() => setMsg(""), 3000);
    } catch (err) {
      console.error("Error deleting user:", err);
      setMsg("❌ Erreur: " + err.message);
    }
  };

  const deleteAllDenied = async () => {
    if (!window.confirm("Êtes-vous sûr de vouloir supprimer TOUS les utilisateurs refusés?")) return;
    try {
      const deniedUsers = users.filter(u => !u.approved && u.disabled);
      for (const user of deniedUsers) {
        await logAdminAction("delete", user.id, `${user.firstName} ${user.lastName}`, 
          { role: user.role, email: user.email, bulkDelete: true });
        await deleteDoc(doc(db, "users", user.id));
      }
      setMsg(`✅ ${deniedUsers.length} utilisateurs supprimés!`);
      await loadUsers();
      setTimeout(() => setMsg(""), 3000);
    } catch (err) {
      console.error("Error deleting users:", err);
      setMsg("❌ Erreur: " + err.message);
    }
  };

  const startEdit = (user) => {
    setEditingUser(user.id);
    setEditForm({
      firstName: user.firstName, lastName: user.lastName, role: user.role,
      department: user.department || "", room: user.room || ""
    });
  };

  const saveEdit = async (userId, user) => {
    try {
      await updateDoc(doc(db, "users", userId), editForm);
      await logAdminAction("update", userId, `${user.firstName} ${user.lastName}`, 
        { changes: editForm, previousRole: user.role, newRole: editForm.role });
      setMsg("✅ Utilisateur mis à jour!");
      setEditingUser(null);
      await loadUsers();
      setTimeout(() => setMsg(""), 3000);
    } catch (err) {
      console.error("Error updating user:", err);
      setMsg("❌ Erreur: " + err.message);
    }
  };

  const loadStatistics = async () => {
    setStatsLoading(true);
    try {
      const startOfYear = new Date(`${selectedYear}-01-01T00:00:00`);
      const endOfYear = new Date(`${selectedYear}-12-31T23:59:59`);

      const ticketsQuery = query(
        collection(db, "tickets"),
        where("createdAt", ">=", startOfYear.toISOString()),
        where("createdAt", "<=", endOfYear.toISOString())
      );

      const ticketsSnap = await getDocs(ticketsQuery);
      const tickets = ticketsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      const doctorsQuery = query(collection(db, "users"), where("role", "==", "doctor"));
      const doctorsSnap = await getDocs(doctorsQuery);
      const doctors = doctorsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      const deptStats = {};
      tickets.forEach(ticket => {
        const dept = ticket.department || "Non spécifié";
        if (!deptStats[dept]) deptStats[dept] = { total: 0, waiting: 0, inProgress: 0, completed: 0 };
        deptStats[dept].total++;
        if (ticket.status === "waiting") deptStats[dept].waiting++;
        if (ticket.status === "in-progress") deptStats[dept].inProgress++;
        if (ticket.status === "completed") deptStats[dept].completed++;
      });

      const byDepartment = Object.entries(deptStats).map(([name, data]) => ({
        name, ...data, completionRate: data.total > 0 ? ((data.completed / data.total) * 100).toFixed(1) : 0
      }));

      const doctorStats = doctors.map(doctor => {
        const doctorTickets = tickets.filter(t => t.department === doctor.department);
        const completed = doctorTickets.filter(t => t.status === "completed" && t.updatedBy === doctor.id).length;
        return {
          id: doctor.id, name: `Dr. ${doctor.firstName} ${doctor.lastName}`,
          department: doctor.department || "Non assigné", room: doctor.room || "-",
          totalInDept: doctorTickets.length, completed,
          completionRate: doctorTickets.length > 0 ? ((completed / doctorTickets.length) * 100).toFixed(1) : 0
        };
      });

      setStats({ byDepartment, byDoctor: doctorStats.sort((a, b) => b.completed - a.completed), monthly: tickets });
      setStatsLoading(false);
    } catch (error) {
      console.error("Error loading statistics:", error);
      setStatsLoading(false);
    }
  };

  const loadLogs = async () => {
    setLogsLoading(true);
    try {
      const logsQuery = query(collection(db, "adminLogs"), orderBy("timestamp", "desc"), limit(100));
      const logsSnap = await getDocs(logsQuery);
      const logsList = logsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      setLogs(logsList);
      setLogsLoading(false);
    } catch (error) {
      console.error("Error loading logs:", error);
      setLogsLoading(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    nav("/");
  };

  const getFilteredUsers = () => {
    let filtered = users;
    if (userSubTab === "approved") filtered = filtered.filter(u => u.approved && !u.disabled);
    else if (userSubTab === "denied") filtered = filtered.filter(u => !u.approved || u.disabled);
    if (searchTerm) {
      filtered = filtered.filter(u => 
        u.firstName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        u.lastName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        u.email?.toLowerCase().includes(searchTerm.toLowerCase()));
    }
    if (filterRole !== "all") filtered = filtered.filter(u => u.role === filterRole);
    return filtered;
  };

  const getActionIcon = (action) => {
    const icons = { approve: "✅", deny: "❌", disable: "🔒", enable: "🔓", delete: "🗑️", update: "✏️" };
    return icons[action] || "📝";
  };

  const getActionColor = (action) => {
    const colors = { approve: "#28a745", deny: "#dc3545", disable: "#ffc107", enable: "#17a2b8", delete: "#dc3545", update: "#007bff" };
    return colors[action] || "#6c757d";
  };

  const getActionText = (action) => {
    const texts = { approve: "Approuvé", deny: "Refusé", disable: "Désactivé", enable: "Réactivé", delete: "Supprimé", update: "Mis à jour" };
    return texts[action] || action;
  };

  if (loading) {
    return (<div style={{ padding: 30, textAlign: 'center', fontSize: 18, marginTop: 50, backgroundColor: '#FFF8DC' }}>
      Chargement...
    </div>);
  }

  const filteredUsers = getFilteredUsers();
  const approvedCount = users.filter(u => u.approved && !u.disabled).length;
  const deniedCount = users.filter(u => !u.approved || u.disabled).length;
  const filteredLogs = filterAction === "all" ? logs : logs.filter(log => log.action === filterAction);

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #228B22 0%, #FFD700 100%)', padding: 30 }}>
      <div style={{ maxWidth: 1400, margin: "0 auto", backgroundColor: 'white', borderRadius: 10, padding: 30, boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
        
        {/* Header */}
        <img src="/Mali.jpg" alt="Logo" style={{ height: 60 }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30, paddingBottom: 20, borderBottom: '3px solid #228B22' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            

            <div>
              <h1 style={{ margin: 0, color: '#228B22' }}>🏥 Panneau d'Administration</h1>
              <p style={{ color: '#666', margin: '5px 0 0 0' }}>Bienvenue, {currentUser?.firstName} {currentUser?.lastName}</p>
            </div>
          </div>
          <button onClick={handleLogout} style={{ padding: '10px 20px', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: 16, fontWeight: 'bold' }}>
            Déconnexion
          </button>
        </div>

        {/* Message */}
        {msg && (
          <div style={{ padding: 15, marginBottom: 20, backgroundColor: msg.startsWith("✅") ? "#d4edda" : "#f8d7da",
            color: msg.startsWith("✅") ? "#155724" : "#721c24", border: `1px solid ${msg.startsWith("✅") ? "#c3e6cb" : "#f5c6cb"}`,
            borderRadius: 4, fontWeight: 'bold', textAlign: 'center' }}>
            {msg}
          </div>
        )}

        {/* Main Tabs */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 20, borderBottom: '3px solid #dee2e6' }}>
          {['users', 'statistics', 'logs'].map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              style={{ padding: '12px 24px', border: 'none', borderBottom: activeTab === tab ? '4px solid #228B22' : 'none',
                backgroundColor: activeTab === tab ? '#f8f9fa' : 'transparent', cursor: 'pointer',
                fontWeight: activeTab === tab ? 'bold' : 'normal', fontSize: 16,
                color: activeTab === tab ? '#228B22' : '#666' }}>
              {tab === 'users' ? '👥 Utilisateurs' : tab === 'statistics' ? '📊 Statistiques' : '📜 Historique'}
            </button>
          ))}
        </div>

        {/* Users Tab */}
        {activeTab === "users" && (
          <>
            {/* User Sub-tabs */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 10, borderBottom: '2px solid #dee2e6' }}>
              {[{key: 'home', label: `🏠 Tous (${users.length})`}, 
                {key: 'approved', label: `✅ Approuvés (${approvedCount})`},
                {key: 'denied', label: `❌ Refusés (${deniedCount})`}].map(tab => (
                <button key={tab.key} onClick={() => setUserSubTab(tab.key)}
                  style={{ padding: '12px 24px', border: 'none', borderBottom: userSubTab === tab.key ? '3px solid #228B22' : 'none',
                    backgroundColor: userSubTab === tab.key ? '#f8f9fa' : 'transparent', cursor: 'pointer',
                    fontWeight: userSubTab === tab.key ? 'bold' : 'normal', fontSize: 16,
                    color: userSubTab === tab.key ? '#228B22' : '#666' }}>
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: 15, marginBottom: 20, padding: 15, backgroundColor: '#FFF8DC',
              borderRadius: 8, border: '2px solid #FFD700' }}>
              <input type="text" placeholder="🔍 Rechercher par nom ou email..." value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ flex: 1, padding: '10px', borderRadius: '4px', border: '1px solid #ccc', fontSize: 14 }} />
              <select value={filterRole} onChange={(e) => setFilterRole(e.target.value)}
                style={{ padding: '10px', borderRadius: '4px', border: '1px solid #ccc', fontSize: 14 }}>
                <option value="all">Tous les rôles</option>
                <option value="admin">Admin</option>
                <option value="doctor">Médecin</option>
                <option value="accueil">Accueil</option>
              </select>
              {userSubTab === "denied" && (
                <button onClick={deleteAllDenied}
                  style={{ padding: '10px 20px', backgroundColor: '#dc3545', color: 'white', border: 'none',
                    borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
                  🗑️ Supprimer tous
                </button>
              )}
            </div>

            {/* Statistics Summary */}
            <div style={{ marginBottom: 20, padding: 15, backgroundColor: '#f8f9fa', borderRadius: 4, border: '1px solid #dee2e6' }}>
              <h3 style={{ margin: '0 0 10px 0', color: '#228B22' }}>📊 Statistiques</h3>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                {[{label: 'Total', value: users.length, color: '#228B22'},
                  {label: 'Approuvés', value: approvedCount, color: '#28a745'},
                  {label: 'Refusés', value: deniedCount, color: '#dc3545'},
                  {label: 'Médecins', value: users.filter(u => u.role === 'doctor').length, color: '#FFD700'},
                  {label: 'Accueil', value: users.filter(u => u.role === 'accueil').length, color: '#17a2b8'}].map(stat => (
                  <div key={stat.label} style={{ padding: '10px 20px', backgroundColor: 'white',
                    borderRadius: 8, border: `2px solid ${stat.color}` }}>
                    <strong>{stat.label}:</strong> {stat.value}
                  </div>
                ))}
              </div>
            </div>

            {/* Users Table */}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: 'white',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)', borderRadius: 4 }}>
                <thead>
                  <tr style={{ backgroundColor: '#228B22', color: 'white' }}>
                    {['Nom', 'Email', 'Rôle', 'Département', 'Chambre', 'Dernière connexion', 'Statut', 'Actions'].map(h => (
                      <th key={h} style={{ padding: 15, textAlign: 'left' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.length === 0 ? (
                    <tr><td colSpan="8" style={{ padding: 30, textAlign: 'center', color: '#666' }}>
                      Aucun utilisateur trouvé
                    </td></tr>
                  ) : (
                    filteredUsers.map(user => (
                      <tr key={user.id} style={{ borderBottom: '1px solid #dee2e6',
                        backgroundColor: user.disabled ? '#ffe6e6' : 'white' }}>
                        
                        {/* Name */}
                        <td style={{ padding: 15 }}>
                          {editingUser === user.id ? (
                            <div style={{ display: 'flex', gap: 5 }}>
                              <input value={editForm.firstName}
                                onChange={(e) => setEditForm({...editForm, firstName: e.target.value})}
                                style={{ width: 80, padding: 5 }} />
                              <input value={editForm.lastName}
                                onChange={(e) => setEditForm({...editForm, lastName: e.target.value})}
                                style={{ width: 80, padding: 5 }} />
                            </div>
                          ) : (
                            <strong>{user.firstName} {user.lastName}</strong>
                          )}
                        </td>
                        
                        {/* Email */}
                        <td style={{ padding: 15, fontSize: 14 }}>{user.email}</td>
                        
                        {/* Role */}
                        <td style={{ padding: 15 }}>
                          {editingUser === user.id ? (
                            <select value={editForm.role}
                              onChange={(e) => setEditForm({...editForm, role: e.target.value})}
                              style={{ padding: 5 }}>
                              <option value="admin">Admin</option>
                              <option value="doctor">Médecin</option>
                              <option value="accueil">Accueil</option>
                            </select>
                          ) : (
                            <span style={{ padding: '5px 10px', borderRadius: '4px',
                              backgroundColor: user.role === 'admin' ? '#ff9800' : user.role === 'doctor' ? '#2196F3' : '#4CAF50',
                              color: 'white', fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase' }}>
                              {user.role}
                            </span>
                          )}
                        </td>
                        
                        {/* Department */}
                        <td style={{ padding: 15 }}>
                          {editingUser === user.id && editForm.role === 'doctor' ? (
                            <select value={editForm.department}
                              onChange={(e) => setEditForm({...editForm, department: e.target.value})}
                              style={{ padding: 5, width: '100%' }}>
                              <option value="">Sélectionner...</option>
                              <option value="Cardiologie">Cardiologie</option>
                              <option value="Pédiatrie">Pédiatrie</option>
                              <option value="Urgences">Urgences</option>
                              <option value="Chirurgie">Chirurgie</option>
                              <option value="Radiologie">Radiologie</option>
                            </select>
                          ) : (
                            user.department || "-"
                          )}
                        </td>
                        
                        {/* Room */}
                        <td style={{ padding: 15 }}>
                          {editingUser === user.id && editForm.role === 'doctor' ? (
                            <input value={editForm.room}
                              onChange={(e) => setEditForm({...editForm, room: e.target.value})}
                              placeholder="ex: 201" style={{ padding: 5, width: 60 }} />
                          ) : (
                            user.room || "-"
                          )}
                        </td>
                        
                        {/* Last Login */}
                        <td style={{ padding: 15, fontSize: 13 }}>
                          {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString('fr-FR') : "Jamais"}
                        </td>
                        
                        {/* Status */}
                        <td style={{ padding: 15 }}>
                          <span style={{ padding: '5px 1px', borderRadius: 'px', fontSize: 15, fontWeight: 'bold',
                            backgroundColor: user.disabled ? '#dc3545' : user.approved ? '#28a745' : '#ffc107',
                            color: 'white' }}>
                            {user.disabled ? '🔒 Désactivé' : user.approved ? '✅ Approuvé' : '⏳ En attente'}
                          </span>
                        </td>
                        
                        {/* Actions */}
                        <td style={{ padding: 10 }}>
                          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                            {editingUser === user.id ? (
                              <>
                                <button onClick={() => saveEdit(user.id, user)}
                                  style={{ padding: '5px 10px', backgroundColor: '#28a745', color: 'white',
                                    border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: 12 }}>
                                  💾 Sauver
                                </button>
                                <button onClick={() => setEditingUser(null)}
                                  style={{ padding: '5px 10px', backgroundColor: '#6c757d', color: 'white',
                                    border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: 12 }}>
                                  ❌ Annuler
                                </button>
                              </>
                            ) : (
                              <>
                                {!user.approved && (
                                  <button onClick={() => approveUser(user.id, user)}
                                    style={{ padding: '5px 10px', backgroundColor: '#28a745', color: 'white',
                                      border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: 12 }}>
                                    ✅Approver
                                  </button>
                                )}
                                {user.approved && !user.disabled && (
                                  <button onClick={() => denyUser(user.id, user)}
                                    style={{ padding: '5px 10px', backgroundColor: '#ffc107', color: 'white',
                                      border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: 10 }}>
                                    ❌Refuser
                                  </button>
                                )}
                                {user.disabled ? (
                                  <button onClick={() => enableUser(user.id, user)}
                                    style={{ padding: '5px 10px', backgroundColor: '#17a2b8', color: 'white',
                                      border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: 12 }}>
                                    🔓Reactiver
                                  </button>
                                ) : (
                                  <button onClick={() => disableUser(user.id, user)}
                                    style={{ padding: '5px 10px', backgroundColor: '#ff9800', color: 'white',
                                      border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: 12 }}>
                                    🔒Desactiver
                                  </button>
                                )}
                                <button onClick={() => startEdit(user)}
                                  style={{ padding: '5px 10px', backgroundColor: '#007bff', color: 'white',
                                    border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: 12 }}>
                                  ✏️Modifier
                                </button>
                                <button onClick={() => deleteUser(user.id, user)}
                                  style={{ padding: '5px 10px', backgroundColor: '#dc3545', color: 'white',
                                    border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: 12 }}>
                                  🗑️Supprimer
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Statistics Tab */}
        {activeTab === "statistics" && (
          <div>
            <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ color: '#228B22', margin: 0 }}>📊 Statistiques des Tickets</h2>
              <select value={selectedYear} onChange={(e) => setSelectedYear(e.target.value)}
                style={{ padding: '10px', borderRadius: '4px', border: '1px solid #ccc', fontSize: 14 }}>
                {[2024, 2025, 2026, 2027].map(year => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </div>

            {statsLoading ? (
              <div style={{ textAlign: 'center', padding: 50, color: '#666' }}>Chargement des statistiques...</div>
            ) : (
              <>
                {/* Department Statistics */}
                <div style={{ marginBottom: 30 }}>
                  <h3 style={{ color: '#228B22', marginBottom: 15 }}>Par Département</h3>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: 'white',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.1)', borderRadius: 4 }}>
                      <thead>
                        <tr style={{ backgroundColor: '#228B22', color: 'white' }}>
                          <th style={{ padding: 15, textAlign: 'left' }}>Département</th>
                          <th style={{ padding: 15, textAlign: 'left' }}>Total</th>
                          <th style={{ padding: 15, textAlign: 'left' }}>En attente</th>
                          <th style={{ padding: 15, textAlign: 'left' }}>En cours</th>
                          <th style={{ padding: 15, textAlign: 'left' }}>Complétés</th>
                          <th style={{ padding: 15, textAlign: 'left' }}>Taux de complétion</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.byDepartment.length === 0 ? (
                          <tr><td colSpan="6" style={{ padding: 30, textAlign: 'center', color: '#666' }}>
                            Aucune donnée pour l'année {selectedYear}
                          </td></tr>
                        ) : (
                          stats.byDepartment.map(dept => (
                            <tr key={dept.name} style={{ borderBottom: '1px solid #dee2e6' }}>
                              <td style={{ padding: 15, fontWeight: 'bold' }}>{dept.name}</td>
                              <td style={{ padding: 15 }}>{dept.total}</td>
                              <td style={{ padding: 15, color: '#ffc107' }}>{dept.waiting}</td>
                              <td style={{ padding: 15, color: '#17a2b8' }}>{dept.inProgress}</td>
                              <td style={{ padding: 15, color: '#28a745' }}>{dept.completed}</td>
                              <td style={{ padding: 15 }}>
                                <span style={{ padding: '5px 10px', borderRadius: '4px', backgroundColor: '#f8f9fa',
                                  fontWeight: 'bold', color: '#228B22' }}>
                                  {dept.completionRate}%
                                </span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Doctor Statistics */}
                <div>
                  <h3 style={{ color: '#228B22', marginBottom: 15 }}>Performance des Médecins</h3>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: 'white',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.1)', borderRadius: 4 }}>
                      <thead>
                        <tr style={{ backgroundColor: '#228B22', color: 'white' }}>
                          <th style={{ padding: 15, textAlign: 'left' }}>Médecin</th>
                          <th style={{ padding: 15, textAlign: 'left' }}>Département</th>
                          <th style={{ padding: 15, textAlign: 'left' }}>Chambre</th>
                          <th style={{ padding: 15, textAlign: 'left' }}>Total Dept.</th>
                          <th style={{ padding: 15, textAlign: 'left' }}>Complétés</th>
                          <th style={{ padding: 15, textAlign: 'left' }}>Taux</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.byDoctor.length === 0 ? (
                          <tr><td colSpan="6" style={{ padding: 30, textAlign: 'center', color: '#666' }}>
                            Aucun médecin trouvé
                          </td></tr>
                        ) : (
                          stats.byDoctor.map(doctor => (
                            <tr key={doctor.id} style={{ borderBottom: '1px solid #dee2e6' }}>
                              <td style={{ padding: 15, fontWeight: 'bold' }}>{doctor.name}</td>
                              <td style={{ padding: 15 }}>{doctor.department}</td>
                              <td style={{ padding: 15 }}>{doctor.room}</td>
                              <td style={{ padding: 15 }}>{doctor.totalInDept}</td>
                              <td style={{ padding: 15, color: '#28a745', fontWeight: 'bold' }}>{doctor.completed}</td>
                              <td style={{ padding: 15 }}>
                                <span style={{ padding: '5px 10px', borderRadius: '4px', backgroundColor: '#f8f9fa',
                                  fontWeight: 'bold', color: '#228B22' }}>
                                  {doctor.completionRate}%
                                </span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Logs Tab */}
        {activeTab === "logs" && (
          <div>
            <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ color: '#228B22', margin: 0 }}>📜 Historique des Actions</h2>
              <select value={filterAction} onChange={(e) => setFilterAction(e.target.value)}
                style={{ padding: '10px', borderRadius: '4px', border: '1px solid #ccc', fontSize: 14 }}>
                <option value="all">Toutes les actions</option>
                <option value="approve">Approbations</option>
                <option value="deny">Refus</option>
                <option value="disable">Désactivations</option>
                <option value="enable">Réactivations</option>
                <option value="delete">Suppressions</option>
                <option value="update">Modifications</option>
              </select>
            </div>

            {logsLoading ? (
              <div style={{ textAlign: 'center', padding: 50, color: '#666' }}>Chargement de l'historique...</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: 'white',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)', borderRadius: 4 }}>
                  <thead>
                    <tr style={{ backgroundColor: '#228B22', color: 'white' }}>
                      <th style={{ padding: 15, textAlign: 'left' }}>Date/Heure</th>
                      <th style={{ padding: 15, textAlign: 'left' }}>Action</th>
                      <th style={{ padding: 15, textAlign: 'left' }}>Admin</th>
                      <th style={{ padding: 15, textAlign: 'left' }}>Utilisateur Cible</th>
                      <th style={{ padding: 15, textAlign: 'left' }}>Détails</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLogs.length === 0 ? (
                      <tr><td colSpan="5" style={{ padding: 30, textAlign: 'center', color: '#666' }}>
                        Aucun historique trouvé
                      </td></tr>
                    ) : (
                      filteredLogs.map(log => (
                        <tr key={log.id} style={{ borderBottom: '1px solid #dee2e6' }}>
                          <td style={{ padding: 15, fontSize: 13 }}>
                            {new Date(log.timestamp).toLocaleString('fr-FR')}
                          </td>
                          <td style={{ padding: 15 }}>
                            <span style={{ padding: '5px 10px', borderRadius: '4px',
                              backgroundColor: getActionColor(log.action), color: 'white',
                              fontSize: 12, fontWeight: 'bold' }}>
                              {getActionIcon(log.action)} {getActionText(log.action)}
                            </span>
                          </td>
                          <td style={{ padding: 15 }}>
                            <div style={{ fontSize: 14 }}>
                              <strong>{log.adminName}</strong>
                              <div style={{ fontSize: 12, color: '#666' }}>{log.adminEmail}</div>
                            </div>
                          </td>
                          <td style={{ padding: 15, fontWeight: 'bold' }}>{log.targetUserName}</td>
                          <td style={{ padding: 15, fontSize: 13 }}>
                            {log.details.role && <div>Rôle: {log.details.role}</div>}
                            {log.details.email && <div>Email: {log.details.email}</div>}
                            {log.details.department && <div>Département: {log.details.department}</div>}
                            {log.details.bulkDelete && <div style={{ color: '#dc3545' }}>Suppression groupée</div>}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}