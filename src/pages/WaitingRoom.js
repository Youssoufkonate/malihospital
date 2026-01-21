import { useState, useEffect, useRef } from "react";
import { db } from "../firebase";
import { collection, query, orderBy, limit, onSnapshot, where } from "firebase/firestore";

export default function WaitingRoom() {
  const [currentCall, setCurrentCall] = useState(null);
  const [recentCalls, setRecentCalls] = useState([]);
  const [showAnimation, setShowAnimation] = useState(false);
  const [department, setDepartment] = useState("");
  const lastCallId = useRef(null);

  // Get department from URL parameter or allow selection
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const dept = urlParams.get('department');
    if (dept) {
      setDepartment(dept);
    }
  }, []);

  useEffect(() => {
    if (!department) return;

    console.log("🏥 Loading waiting room for department:", department);

    const q = query(
      collection(db, "calls"),
      where("department", "==", department),
      orderBy("calledAt", "desc"),
      limit(5)
    );

    const unsubscribe = onSnapshot(
      q, 
      (snapshot) => {
        console.log("📡 Snapshot received, docs count:", snapshot.docs.length);
        
        const calls = snapshot.docs.map(d => {
          const data = d.data();
          console.log("📞 Call doc:", { id: d.id, ...data });
          return { id: d.id, ...data };
        });

        if (calls.length === 0) {
          console.log("⚠️ No calls found for department:", department);
          setCurrentCall(null);
          setRecentCalls([]);
          return;
        }

        const latestCall = calls[0];
        console.log("🔔 Latest call:", latestCall);
        console.log("🔔 Latest call ID:", latestCall.id);
        console.log("🔔 Last processed call ID:", lastCallId.current);

        const isNewCall = latestCall.id !== lastCallId.current;
        console.log("🔔 Is this a new call?", isNewCall);

        if (isNewCall) {
          console.log("✅ Processing NEW call:", latestCall.ticketNumber);
          
          lastCallId.current = latestCall.id;
          setCurrentCall(latestCall);
          setRecentCalls(calls.slice(1));

          setShowAnimation(true);
          setTimeout(() => setShowAnimation(false), 3000);

          speakCall(latestCall);
        } else {
          console.log("⏭️ Same call as before, updating recent calls only");
          setRecentCalls(calls.slice(1));
        }
      },
      (error) => {
        console.error("❌ Error loading calls:", error);
        if (error.code === 'failed-precondition') {
          console.error("❌ FIRESTORE INDEX REQUIRED!");
          console.error("Create composite index for: collection='calls', fields=[department ASC, calledAt DESC]");
          alert("⚠️ Index Firestore requis!\n\nAllez dans Firebase Console > Firestore > Indexes\nCréez un index composite:\n- Collection: calls\n- Champs: department (ASC), calledAt (DESC)");
        }
      }
    );

    return () => unsubscribe();
  }, [department]);

  const speakCall = (call) => {
    if (!window.speechSynthesis) {
      console.warn("⚠️ Speech synthesis not available");
      return;
    }

    console.log(`🔊 Speaking call for ticket:`, call.ticketNumber);

    const spellTicketNumberFrench = (ticketNum) => {
      return ticketNum.split('').map(char => {
        if (char === '-') return ', ';
        const letterMap = {
          'P': 'Pé', 'G': 'Jé', 'M': 'Emme', 'C': 'Cé',
          'A': 'Ah', 'B': 'Bé', 'D': 'Dé', 'E': 'Euh',
          'F': 'Effe', 'H': 'Ache', 'I': 'I', 'J': 'Ji',
          'K': 'Ka', 'L': 'Elle', 'N': 'Enne', 'O': 'O',
          'Q': 'Ku', 'R': 'Erre', 'S': 'Esse', 'T': 'Té',
          'U': 'U', 'V': 'Vé', 'W': 'Double-vé', 'X': 'Iks',
          'Y': 'I-grec', 'Z': 'Zède',
          '0': 'zéro', '1': 'un', '2': 'deux', '3': 'trois',
          '4': 'quatre', '5': 'cinq', '6': 'six', '7': 'sept',
          '8': 'huit', '9': 'neuf'
        };
        return letterMap[char.toUpperCase()] || char;
      }).join(', ');
    };

    const spellTicketNumberBambara = (ticketNum) => {
      return ticketNum.split('').map(char => {
        if (char === '-') return ', ';
        const letterMap = {
          'P': 'Pé', 'G': 'Jé', 'M': 'Emme', 'C': 'Cé',
          'A': 'Ah', 'B': 'Bé', 'D': 'Dé', 'E': 'Euh',
          'F': 'Effe', 'H': 'Ache', 'I': 'I', 'J': 'Ji',
          'K': 'Ka', 'L': 'Elle', 'N': 'Enne', 'O': 'O',
          'Q': 'Ku', 'R': 'Erre', 'S': 'Esse', 'T': 'Té',
          'U': 'U', 'V': 'Vé', 'W': 'Double-vé', 'X': 'Iks',
          'Y': 'I-grec', 'Z': 'Zède',
          '0': 'zéro', '1': 'un', '2': 'deux', '3': 'trois',
          '4': 'quatre', '5': 'cinq', '6': 'six', '7': 'sept',
          '8': 'huit', '9': 'neuf'
        };
        return letterMap[char.toUpperCase()] || char;
      }).join(', ');
    };

    const ticketSpelledFrench = spellTicketNumberFrench(call.ticketNumber);
    const ticketSpelledBambara = spellTicketNumberBambara(call.ticketNumber);
    
    const french = `Ticket ${ticketSpelledFrench}. 
    ${call.patientName}. 
    Veuillez vous présenter au service ${call.department}, à la chambre ${call.room}.`;

    const bambara = `Tiké ${ticketSpelledBambara}, ${call.patientName}. 
    taa ${call.department} la, chambre ${call.room} kono.`;

    const voices = window.speechSynthesis.getVoices();

    const frenchVoice =
      voices.find(v => v.lang.startsWith("fr") && v.name.toLowerCase().includes("male")) ||
      voices.find(v => v.lang.startsWith("fr")) ||
      voices[0];
    
    const frUtter = new SpeechSynthesisUtterance(french);
    frUtter.lang = "fr-FR";
    frUtter.voice = frenchVoice;
    frUtter.rate = 0.85;
    frUtter.pitch = 0.9;

    const bmUtter = new SpeechSynthesisUtterance(bambara);
    bmUtter.lang = "fr-FR";
    bmUtter.voice = frenchVoice;
    bmUtter.rate = 0.65;
    bmUtter.pitch = 0.9;
    
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(frUtter);
    
    setTimeout(() => {
      window.speechSynthesis.speak(bmUtter);
    }, 6000);
  };

  // Department selection screen
  if (!department) {
    return (
      <div style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #228B22 0%, #FFD700 50%, #CE1126 100%)",
        padding: 40,
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }}>
        <div style={{
          backgroundColor: "white",
          padding: 60,
          borderRadius: 20,
          boxShadow: "0 15px 50px rgba(0,0,0,0.4)",
          border: "6px solid #228B22",
          textAlign: "center",
          maxWidth: 600
        }}>
          <h1 style={{ color: "#228B22", marginBottom: 30, fontSize: 36 }}>
            🏥 Sélectionnez le Département
          </h1>
          <p style={{ color: "#666", marginBottom: 40, fontSize: 18 }}>
            Select Department
          </p>
          
          <div style={{ display: "grid", gap: 15 }}>
            {["Pédiatrie", "Général", "Maternité", "Cardiologie"].map(dept => (
              <button
                key={dept}
                onClick={() => setDepartment(dept)}
                style={{
                  padding: "20px 30px",
                  fontSize: 20,
                  backgroundColor: "#228B22",
                  color: "white",
                  border: "none",
                  borderRadius: 10,
                  cursor: "pointer",
                  fontWeight: "bold",
                  transition: "all 0.3s"
                }}
                onMouseOver={(e) => {
                  e.target.style.backgroundColor = "#FFD700";
                  e.target.style.color = "#228B22";
                }}
                onMouseOut={(e) => {
                  e.target.style.backgroundColor = "#228B22";
                  e.target.style.color = "white";
                }}
              >
                {dept}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #228B22 0%, #FFD700 50%, #CE1126 100%)",
      padding: 40,
      color: "white",
      fontFamily: "Arial, sans-serif",
      position: "relative"
    }}>
      {/* Bandeau avec les couleurs du drapeau malien */}
      <div style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 20,
        background: "linear-gradient(to right, #14B53A 33.33%, #FCD116 33.33%, #FCD116 66.66%, #CE1126 66.66%)"
      }} />

      {/* Bouton de changement de département */}
      <button
        onClick={() => {
          setDepartment("");
          setCurrentCall(null);
          setRecentCalls([]);
          lastCallId.current = null;
        }}
        style={{
          position: "absolute",
          top: 30,
          right: 40,
          padding: "10px 20px",
          backgroundColor: "#CE1126",
          color: "white",
          border: "none",
          borderRadius: 8,
          cursor: "pointer",
          fontWeight: "bold",
          fontSize: 14,
          zIndex: 10
        }}
      >
        
        🔄 Changer Département
      </button>
        
      {/* Test Speech Button */}
      <button
        onClick={() => {
          const testCall = {
            ticketNumber: "TEST-001",
            patientName: "Test Patient",
            department: department,
            room: "101"
          };
          console.log("🧪 Testing speech with:", testCall);
          speakCall(testCall);
        }}
        style={{
          position: "absolute",
          top: 80,
          right: 40,
          padding: "10px 20px",
          backgroundColor: "#007bff",
          color: "white",
          border: "none",
          borderRadius: 8,
          cursor: "pointer",
          fontWeight: "bold",
          fontSize: 14,
          zIndex: 10
        }}
      >
        🧪 Test Audio
      </button>

      {/* Show Available Voices Button */}
      <button
        onClick={() => {
          const voices = window.speechSynthesis.getVoices();
          console.log("🔊 All available voices:");
          voices.forEach((voice, i) => {
            console.log(`${i}: ${voice.name} (${voice.lang}) ${voice.default ? '⭐ DEFAULT' : ''}`);
          });
          alert(`Found ${voices.length} voices. Check console for details.`);
        }}
        style={{
          position: "absolute",
          top: 130,
          right: 40,
          padding: "10px 20px",
          backgroundColor: "#6c757d",
          color: "white",
          border: "none",
          borderRadius: 8,
          cursor: "pointer",
          fontWeight: "bold",
          fontSize: 14,
          zIndex: 10
        }}
      >
        🔊 Show Voices
      </button>

      {/* En-tête */}
      <img src="/Mali.jpg" alt="Logo" style={{ height: 50 }} />
      <div style={{
        textAlign: "center",
        marginTop: 30,
        marginBottom: 60
      }}>
        <h1 style={{
          fontSize: 56,
          margin: "0 0 10px 0",
          textShadow: "3px 3px 6px rgba(0,0,0,0.5)",
          color: "white",
          fontWeight: "bold"
        }}>
          🏥 SALLE D'ATTENTE
        </h1>
        <h2 style={{
          fontSize: 32,
          margin: 0,
          textShadow: "2px 2px 4px rgba(0,0,0,0.4)",
          color: "#FFF8DC",
          fontWeight: "normal"
        }}>
          République du Mali
        </h2>
        <p style={{
          fontSize: 24,
          margin: "10px 0 0 0",
          textShadow: "1px 1px 2px rgba(0,0,0,0.3)",
          color: "#FFD700",
          fontWeight: "bold"
        }}>
          Département: {department}
        </p>
        <p style={{
          fontSize: 18,
          margin: "5px 0 0 0",
          textShadow: "1px 1px 2px rgba(0,0,0,0.3)",
          color: "#FFD700"
        }}>
          Système Hospitalier National
        </p>
      </div>

      {/* Appel actuel */}
      {currentCall ? (
        <div style={{
          backgroundColor: "white",
          color: "#333",
          padding: 60,
          borderRadius: 20,
          textAlign: "center",
          marginBottom: 40,
          boxShadow: "0 15px 50px rgba(0,0,0,0.4)",
          transform: showAnimation ? "scale(1.05)" : "scale(1)",
          transition: "transform 0.3s ease",
          border: showAnimation ? "6px solid #FFD700" : "6px solid #228B22",
          position: "relative",
          overflow: "hidden"
        }}>
          {showAnimation && (
            <div style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: "linear-gradient(45deg, transparent 30%, rgba(255,215,0,0.1) 50%, transparent 70%)",
              animation: "shimmer 1.5s infinite",
              pointerEvents: "none"
            }} />
          )}

          <div style={{ position: "relative", zIndex: 1 }}>
            <h2 style={{ 
              fontSize: 36, 
              marginBottom: 20, 
              color: "#228B22",
              fontWeight: "bold",
              textTransform: "uppercase",
              animation: showAnimation ? "pulse 1s ease-in-out" : "none"
            }}>
              🔔 APPEL EN COURS
            </h2>
            
            <div style={{ 
              fontSize: 96, 
              fontWeight: "bold", 
              margin: "30px 0",
              color: showAnimation ? "#FFD700" : "#228B22",
              textShadow: "3px 3px 6px rgba(0,0,0,0.2)",
              transition: "color 0.3s ease",
              padding: "20px",
              background: "linear-gradient(135deg, #FFF8DC 0%, #FFFACD 100%)",
              borderRadius: 15,
              border: "4px solid #228B22",
              display: "inline-block",
              minWidth: 300
            }}>
              {currentCall.ticketNumber}
            </div>
            
            <div style={{ 
              fontSize: 52, 
              color: "#CE1126", 
              marginTop: 30,
              fontWeight: "bold",
              textShadow: "2px 2px 4px rgba(0,0,0,0.1)"
            }}>
              {currentCall.patientName}
            </div>
            
            <div style={{ 
              fontSize: 36, 
              marginTop: 25,
              padding: "15px 30px",
              backgroundColor: "#228B22",
              color: "white",
              borderRadius: 10,
              display: "inline-block",
              marginBottom: 10
            }}>
              {currentCall.department}
            </div>
            
            <div style={{ 
              fontSize: 42, 
              marginTop: 15,
              color: "#228B22",
              fontWeight: "bold"
            }}>
              Chambre {currentCall.room}
            </div>

            <div style={{
              marginTop: 30,
              padding: 20,
              backgroundColor: "#FFF8DC",
              borderRadius: 10,
              border: "2px solid #FFD700"
            }}>
              <p style={{ 
                fontSize: 20, 
                color: "#666", 
                margin: 0,
                fontWeight: "bold"
              }}>
                Veuillez vous présenter immédiatement
              </p>
              <p style={{ 
                fontSize: 16, 
                color: "#999", 
                margin: "5px 0 0 0"
              }}>
                Please proceed immediately
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div style={{
          backgroundColor: "white",
          color: "#666",
          padding: 80,
          borderRadius: 20,
          textAlign: "center",
          marginBottom: 40,
          boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
          border: "6px solid #228B22"
        }}>
          <div style={{ 
            fontSize: 72, 
            marginBottom: 20,
            opacity: 0.5
          }}>
            ⏳
          </div>
          <h2 style={{ 
            fontSize: 40, 
            color: "#228B22",
            marginBottom: 15
          }}>
            Aucun appel actif
          </h2>
          <p style={{ 
            fontSize: 24, 
            color: "#999"
          }}>
            Veuillez patienter pour votre appel
          </p>
          <p style={{ 
            fontSize: 20, 
            color: "#bbb",
            marginTop: 10
          }}>
            Please wait for your call
          </p>
        </div>
      )}

      {/* Appels récents */}
      {recentCalls.length > 0 && (
        <div style={{
          backgroundColor: "rgba(255, 255, 255, 0.95)",
          color: "#333",
          padding: 30,
          borderRadius: 15,
          marginTop: 20,
          boxShadow: "0 8px 20px rgba(0,0,0,0.3)",
          border: "3px solid #FFD700"
        }}>
          <h3 style={{ 
            fontSize: 28, 
            marginBottom: 25,
            textAlign: 'center',
            color: '#228B22',
            borderBottom: "3px solid #FFD700",
            paddingBottom: 15
          }}>
            📋 Appels Récents / Recent Calls
          </h3>
          <div style={{ display: 'grid', gap: 15 }}>
            {recentCalls.map((call, index) => (
              <div key={call.id} style={{
                padding: 20,
                backgroundColor: index % 2 === 0 ? '#FFF8DC' : '#f8f9fa',
                borderRadius: 10,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: 20,
                border: '2px solid #228B22',
                transition: "all 0.3s ease"
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                  <div style={{
                    backgroundColor: '#228B22',
                    color: 'white',
                    padding: '10px 15px',
                    borderRadius: 8,
                    fontWeight: 'bold',
                    fontSize: 24
                  }}>
                    {call.ticketNumber}
                  </div>
                  <div>
                    <div style={{ fontWeight: 'bold', color: '#333', fontSize: 22 }}>
                      {call.patientName}
                    </div>
                    <div style={{ color: '#666', fontSize: 16, marginTop: 5 }}>
                      {call.department} → Chambre {call.room}
                    </div>
                  </div>
                </div>
                <div style={{ 
                  fontSize: 14, 
                  color: '#999',
                  textAlign: 'right'
                }}>
                  <div>{new Date(call.calledAt).toLocaleTimeString('fr-FR')}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{
        textAlign: 'center',
        marginTop: 40,
        padding: 20,
        color: 'white',
        fontSize: 16,
        textShadow: "1px 1px 2px rgba(0,0,0,0.5)"
      }}>
        <p style={{ margin: 0 }}>
          🏥 Système Hospitalier National - République du Mali
        </p>
        <p style={{ margin: "5px 0 0 0", fontSize: 14, opacity: 0.8 }}>
          National Hospital System - Republic of Mali
        </p>
      </div>

      <style>
        {`
          @keyframes pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.8; transform: scale(1.05); }
          }
          
          @keyframes shimmer {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(100%); }
          }
        `}
      </style>
    </div>
  );
}