import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { db } from "../firebase";
import { collection, query, orderBy, limit, onSnapshot, where, doc } from "firebase/firestore";

const COLORS = {
  parchment: "#F6EEDD", parchmentDeep: "#EDE1C7", ink: "#211C16", inkDeep: "#161210",
  inkSoft: "#3B332A", clay: "#B5502F", clayDeep: "#8F3E23", gold: "#D9A441",
  goldSoft: "#E9C77D", green: "#166A3F", greenSoft: "#1F8A54", line: "#4A4033",
  lineLight: "#D8C9A8", danger: "#9A2B1F",
};

function BogolanPattern({ id, opacity = 1, colorA = COLORS.clay, colorB = COLORS.gold }) {
  return (
    <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, opacity }} preserveAspectRatio="none">
      <defs>
        <pattern id={id} width="60" height="60" patternUnits="userSpaceOnUse">
          <rect width="60" height="60" fill="transparent" />
          <path d="M30 3 L57 30 L30 57 L3 30 Z" fill="none" stroke={colorA} strokeWidth="1.2" opacity="0.5" />
          <circle cx="30" cy="30" r="3.2" fill={colorB} opacity="0.45" />
          <path d="M0 30 H9 M51 30 H60" stroke={colorA} strokeWidth="1" opacity="0.35" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

const GlobalStyle = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700;9..144,900&family=Work+Sans:wght@400;500;600;700&display=swap');
    html, body { margin: 0; }
    @keyframes sh-ticket-pop { 0% { transform: scale(0.85); opacity: 0; } 55% { transform: scale(1.04); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
    @keyframes sh-ring-pulse { 0% { box-shadow: 0 0 0 0 rgba(217,164,65,0.55); } 70% { box-shadow: 0 0 0 34px rgba(217,164,65,0); } 100% { box-shadow: 0 0 0 0 rgba(217,164,65,0); } }
    @keyframes sh-flash { 0% { background: rgba(217,164,65,0.18); } 100% { background: rgba(217,164,65,0); } }
    @keyframes sh-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
    @keyframes sh-fade-up { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    .sh-ticket-ring { animation: sh-ring-pulse 1.8s ease-out; }
    .sh-ticket-value { animation: sh-ticket-pop 0.55s cubic-bezier(0.2, 0.8, 0.2, 1); }
    .sh-flash-overlay { animation: sh-flash 1.2s ease-out; }
    .sh-waiting-dot { animation: sh-blink 1.6s ease-in-out infinite; }
    .sh-recent-row { animation: sh-fade-up 0.35s ease both; }
    .sh-dept-btn { transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease; }
    .sh-dept-btn:hover { transform: translateY(-2px); border-color: ${COLORS.gold} !important; }
    .sh-tool-btn { transition: background 0.15s ease, border-color 0.15s ease, opacity 0.15s ease; }
    .sh-tool-btn:hover { background: rgba(217,164,65,0.14) !important; border-color: ${COLORS.gold} !important; }
  `}</style>
);

function BrandHeader({ title, subtitle }) {
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", gap: 16, padding: "30px 24px 6px" }}>
      <div style={{ width: 54, height: 54, borderRadius: "50%", background: "#FFFDF8", border: `2.5px solid ${COLORS.gold}`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", boxShadow: "0 6px 16px rgba(0,0,0,0.4)", flexShrink: 0 }}>
        <img src="/Mali.jpg" alt="Emblème du Mali" style={{ width: "78%", height: "78%", objectFit: "contain" }} />
      </div>
      <div style={{ textAlign: "left" }}>
        <p style={{ margin: 0, fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: COLORS.goldSoft, fontWeight: 700 }}>
          {subtitle || "République du Mali · Un Peuple – Un But – Une Foi"}
        </p>
        <h1 style={{ margin: "3px 0 0", fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 24, color: COLORS.parchment }}>{title}</h1>
      </div>
    </div>
  );
}

export default function WaitingRoom() {
  const { hospitalId } = useParams();
  const [hospital, setHospital] = useState(null);
  const [hospitalStatus, setHospitalStatus] = useState("checking"); // checking | ok | invalid
  const [currentCall, setCurrentCall] = useState(null);
  const [recentCalls, setRecentCalls] = useState([]);
  const [showAnimation, setShowAnimation] = useState(false);
  const [department, setDepartment] = useState("");
  const [pulseKey, setPulseKey] = useState(0);
  const lastCallId = useRef(null);

  // Validate the hospital referenced by the URL exists and is active.
  // Uses a LIVE listener (not a one-time getDoc) so that if the Hospital
  // Admin adds/renames/removes a department while this TV screen is
  // sitting on the department picker (which could be for a while, on a
  // real deployment), the button list updates on its own — no one has to
  // walk over and refresh the display.
  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, "hospitals", hospitalId),
      (snap) => {
        if (!snap.exists() || snap.data().active === false) {
          setHospitalStatus("invalid");
          return;
        }
        setHospital({ id: snap.id, ...snap.data() });
        setHospitalStatus("ok");
      },
      (error) => {
        console.error("Error loading hospital:", error);
        setHospitalStatus("invalid");
      }
    );
    return () => unsubscribe();
  }, [hospitalId]);

  // If the currently-selected department gets deleted by the admin while
  // someone is already watching it, drop back to the picker screen rather
  // than silently displaying a stale/nonexistent department forever.
  useEffect(() => {
    if (!department || !hospital) return;
    const depts = hospital.departments || [];
    if (!depts.includes(department)) {
      setDepartment("");
      setCurrentCall(null);
      setRecentCalls([]);
      lastCallId.current = null;
    }
  }, [hospital, department]);

  useEffect(() => {
    if (!department || hospitalStatus !== "ok") return;

    const q = query(
      collection(db, "calls"),
      where("hospitalId", "==", hospitalId),
      where("department", "==", department),
      orderBy("calledAt", "desc"),
      limit(5)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const calls = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        if (calls.length === 0) {
          setCurrentCall(null);
          setRecentCalls([]);
          return;
        }
        const latestCall = calls[0];
        const isNewCall = latestCall.id !== lastCallId.current;

        if (isNewCall) {
          lastCallId.current = latestCall.id;
          setCurrentCall(latestCall);
          setRecentCalls(calls.slice(1));
          setPulseKey((k) => k + 1);
          setShowAnimation(true);
          setTimeout(() => setShowAnimation(false), 3000);
          speakCall(latestCall);
        } else {
          setRecentCalls(calls.slice(1));
        }
      },
      (error) => {
        console.error("❌ Error loading calls:", error);
        if (error.code === "failed-precondition") {
          console.error("Create composite index for: collection='calls', fields=[hospitalId ASC, department ASC, calledAt DESC]");
        }
      }
    );

    return () => unsubscribe();
  }, [hospitalId, department, hospitalStatus]);

  const speakCall = (call) => {
    if (!window.speechSynthesis) return;

    const letterMap = {
      P: "Pé", G: "Jé", M: "Emme", C: "Cé", A: "Ah", B: "Bé", D: "Dé", E: "Euh",
      F: "Effe", H: "Ache", I: "I", J: "Ji", K: "Ka", L: "Elle", N: "Enne", O: "O",
      Q: "Ku", R: "Erre", S: "Esse", T: "Té", U: "U", V: "Vé", W: "Double-vé", X: "Iks",
      Y: "I-grec", Z: "Zède",
      0: "zéro", 1: "un", 2: "deux", 3: "trois", 4: "quatre", 5: "cinq", 6: "six", 7: "sept", 8: "huit", 9: "neuf",
    };
    const spellTicketNumber = (ticketNum) =>
      ticketNum.split("").map((char) => (char === "-" ? ", " : letterMap[char.toUpperCase()] || char)).join(", ");

    const ticketSpelled = spellTicketNumber(call.ticketNumber);

    const french = `Ticket ${ticketSpelled}. ${call.patientName}. Veuillez vous présenter au service ${call.department}, à la chambre ${call.room}.`;
    const bambara = `Tiké ${ticketSpelled}, ${call.patientName}. taa ${call.department} la, chambre ${call.room} kono.`;

    const voices = window.speechSynthesis.getVoices();
    const frenchVoice = voices.find((v) => v.lang.startsWith("fr")) || voices[0];

    const frUtter = new SpeechSynthesisUtterance(french);
    frUtter.lang = "fr-FR"; frUtter.voice = frenchVoice; frUtter.rate = 0.85; frUtter.pitch = 0.9;

    const bmUtter = new SpeechSynthesisUtterance(bambara);
    bmUtter.lang = "fr-FR"; bmUtter.voice = frenchVoice; bmUtter.rate = 0.65; bmUtter.pitch = 0.9;

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(frUtter);
    setTimeout(() => window.speechSynthesis.speak(bmUtter), 6000);
  };

  if (hospitalStatus === "checking") {
    return <div style={{ minHeight: "100vh", background: COLORS.inkDeep, color: COLORS.parchment, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Work Sans', sans-serif" }}>Chargement...</div>;
  }

  if (hospitalStatus === "invalid") {
    return (
      <div style={{ minHeight: "100vh", background: COLORS.inkDeep, color: COLORS.parchment, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Work Sans', sans-serif", textAlign: "center", padding: 30 }}>
        <div>
          <h2>⚠️ Lien invalide</h2>
          <p>Cet hôpital n'existe pas ou a été désactivé.</p>
        </div>
      </div>
    );
  }

  if (!department) {
    const availableDepartments = hospital?.departments || [];
    return (
      <div style={{ minHeight: "100vh", background: COLORS.parchment, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px", fontFamily: "'Work Sans', sans-serif", position: "relative", overflow: "hidden" }}>
        <GlobalStyle />
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <BogolanPattern id="pat-page-wr" opacity={0.05} colorA={COLORS.ink} colorB={COLORS.clay} />
        </div>
        <div style={{ position: "relative", maxWidth: 520, width: "100%", backgroundColor: "#FFFDF8", borderRadius: 18, overflow: "hidden", boxShadow: "0 30px 70px rgba(33,28,22,0.22)", border: `1px solid ${COLORS.lineLight}` }}>
          <div style={{ position: "relative", background: COLORS.ink, paddingBottom: 22 }}>
            <BogolanPattern id="pat-wr-brand" opacity={0.14} colorA={COLORS.goldSoft} colorB={COLORS.clay} />
            <div style={{ height: 6, width: "100%", background: `linear-gradient(90deg, ${COLORS.green} 0%, ${COLORS.green} 33.3%, ${COLORS.gold} 33.3%, ${COLORS.gold} 66.6%, ${COLORS.clay} 66.6%, ${COLORS.clay} 100%)` }} />
            <BrandHeader title="Salle d'Attente" subtitle={hospital?.name} />
          </div>
          <div style={{ padding: "34px 36px 40px" }}>
            {availableDepartments.length === 0 ? (
              <>
                <p style={{ margin: "0 0 4px", fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 21, color: COLORS.ink, textAlign: "center" }}>
                  Aucun département configuré
                </p>
                <p style={{ margin: 0, fontSize: 13.5, color: "#8A7F6C", textAlign: "center", lineHeight: 1.6 }}>
                  L'administrateur de l'hôpital doit d'abord ajouter des départements
                  depuis son tableau de bord. Cet écran se mettra à jour automatiquement
                  dès qu'un département sera disponible.
                </p>
              </>
            ) : (
              <>
                <p style={{ margin: "0 0 4px", fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 21, color: COLORS.ink, textAlign: "center" }}>Sélectionnez le département</p>
                <p style={{ margin: "0 0 26px", fontSize: 13, color: "#8A7F6C", textAlign: "center" }}>Select department</p>
                <div style={{ display: "grid", gap: 12 }}>
                  {availableDepartments.map((dept) => (
                    <button key={dept} className="sh-dept-btn" onClick={() => setDepartment(dept)}
                      style={{ padding: "16px 20px", fontSize: 17, backgroundColor: COLORS.parchmentDeep, color: COLORS.ink, border: `1.5px solid ${COLORS.lineLight}`, borderRadius: 10, cursor: "pointer", fontWeight: 600, fontFamily: "'Work Sans', sans-serif", textAlign: "left" }}>
                      {dept}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: COLORS.inkDeep, color: COLORS.parchment, fontFamily: "'Work Sans', sans-serif", position: "relative", overflow: "hidden" }}>
      <GlobalStyle />
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <BogolanPattern id="pat-wr-display" opacity={0.06} colorA={COLORS.goldSoft} colorB={COLORS.clay} />
      </div>
      <div style={{ height: 6, width: "100%", background: `linear-gradient(90deg, ${COLORS.green} 0%, ${COLORS.green} 33.3%, ${COLORS.gold} 33.3%, ${COLORS.gold} 66.6%, ${COLORS.clay} 66.6%, ${COLORS.clay} 100%)` }} />

      <div style={{ position: "absolute", top: 22, right: 24, display: "flex", gap: 8, zIndex: 10 }}>
        <button className="sh-tool-btn" onClick={() => {
          const testCall = { ticketNumber: "TEST-001", patientName: "Test Patient", department, room: "101" };
          speakCall(testCall);
        }} title="Tester l'audio" style={{ padding: "8px 12px", fontSize: 12.5, backgroundColor: "rgba(255,253,248,0.06)", color: COLORS.goldSoft, border: `1px solid ${COLORS.line}`, borderRadius: 7, cursor: "pointer", fontWeight: 600 }}>
          🧪 Test audio
        </button>
        <button className="sh-tool-btn" onClick={() => {
          setDepartment("");
          setCurrentCall(null);
          setRecentCalls([]);
          lastCallId.current = null;
        }} title="Changer de département" style={{ padding: "8px 12px", fontSize: 12.5, backgroundColor: "rgba(181,80,47,0.16)", color: COLORS.goldSoft, border: `1px solid ${COLORS.clay}`, borderRadius: 7, cursor: "pointer", fontWeight: 700 }}>
          🔄 Changer département
        </button>
      </div>

      <BrandHeader title="Salle d'Attente" subtitle={hospital?.name} />
      <p style={{ textAlign: "center", margin: "0 0 4px", fontSize: 15, color: COLORS.goldSoft, fontWeight: 700, letterSpacing: "0.04em" }}>
        Département : {department}
      </p>
      <div style={{ width: 64, height: 3, background: COLORS.clay, borderRadius: 2, margin: "10px auto 30px" }} />

      <div style={{ maxWidth: 880, margin: "0 auto", padding: "0 24px 50px", position: "relative" }}>
        {currentCall ? (
          <div key={pulseKey} className="sh-ticket-ring" style={{ position: "relative", borderRadius: 22, background: `linear-gradient(160deg, ${COLORS.ink} 0%, ${COLORS.inkDeep} 100%)`, border: `3px solid ${showAnimation ? COLORS.gold : COLORS.line}`, boxShadow: "0 24px 60px rgba(0,0,0,0.5)", padding: "44px 40px", textAlign: "center", overflow: "hidden", transition: "border-color 0.3s ease" }}>
            {showAnimation && <div className="sh-flash-overlay" style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />}
            <BogolanPattern id="pat-wr-call" opacity={0.08} colorA={COLORS.goldSoft} colorB={COLORS.clay} />
            <p style={{ position: "relative", margin: "0 0 18px", fontSize: 14, letterSpacing: "0.24em", textTransform: "uppercase", color: "#B9AC93", fontWeight: 700 }}>🔔 Appel en cours</p>
            <div key={currentCall.id + pulseKey} className="sh-ticket-value" style={{ position: "relative", display: "inline-block", fontFamily: "'Fraunces', serif", fontWeight: 900, fontSize: "clamp(56px, 9vw, 110px)", lineHeight: 1, color: COLORS.gold, textShadow: "0 4px 24px rgba(217,164,65,0.35)", padding: "10px 34px", border: `2px solid ${COLORS.gold}`, borderRadius: 16, marginBottom: 8 }}>
              {currentCall.ticketNumber}
            </div>
            <p style={{ position: "relative", margin: "22px 0 0", fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: "clamp(24px, 3.4vw, 36px)", color: COLORS.parchment }}>
              {currentCall.patientName}
            </p>
            <div style={{ position: "relative", display: "flex", gap: 12, justifyContent: "center", marginTop: 22, flexWrap: "wrap" }}>
              <span style={{ padding: "9px 18px", borderRadius: 999, fontSize: 15, fontWeight: 700, background: "rgba(22,106,63,0.28)", color: "#8FD6AC", border: "1px solid #2E7A50" }}>{currentCall.department}</span>
              <span style={{ padding: "9px 18px", borderRadius: 999, fontSize: 15, fontWeight: 700, background: "rgba(217,164,65,0.16)", color: COLORS.goldSoft, border: `1px solid ${COLORS.gold}` }}>Chambre {currentCall.room}</span>
            </div>
            <p style={{ position: "relative", marginTop: 26, fontSize: 15, color: "#B9AC93" }}>Veuillez vous présenter immédiatement · Please proceed immediately</p>
          </div>
        ) : (
          <div style={{ borderRadius: 22, border: `2px dashed ${COLORS.line}`, padding: "60px 40px", textAlign: "center" }}>
            <span className="sh-waiting-dot" style={{ width: 12, height: 12, borderRadius: "50%", background: COLORS.clay, display: "inline-block", marginBottom: 18 }} />
            <p style={{ margin: 0, fontFamily: "'Fraunces', serif", fontSize: 26, color: "#B9AC93" }}>Aucun appel actif</p>
            <p style={{ margin: "8px 0 0", fontSize: 15, color: "#6E6350" }}>Veuillez patienter pour votre appel · Please wait for your call</p>
          </div>
        )}

        {recentCalls.length > 0 && (
          <div style={{ marginTop: 34 }}>
            <p style={{ fontSize: 13, letterSpacing: "0.16em", textTransform: "uppercase", color: "#8A7F6C", fontWeight: 700, marginBottom: 14, textAlign: "center" }}>📋 Appels récents · Recent calls</p>
            <div style={{ display: "grid", gap: 10 }}>
              {recentCalls.map((call, index) => (
                <div key={call.id} className="sh-recent-row" style={{ animationDelay: `${index * 0.05}s`, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderRadius: 12, background: "rgba(255,253,248,0.04)", border: `1px solid ${COLORS.line}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    <span style={{ padding: "7px 13px", borderRadius: 8, fontWeight: 700, fontSize: 16, background: "rgba(181,80,47,0.22)", color: "#E8A386", border: `1px solid ${COLORS.clay}` }}>{call.ticketNumber}</span>
                    <div>
                      <p style={{ margin: 0, fontWeight: 600, fontSize: 16, color: COLORS.parchment }}>{call.patientName}</p>
                      <p style={{ margin: "2px 0 0", fontSize: 13, color: "#8A7F6C" }}>{call.department} → Chambre {call.room}</p>
                    </div>
                  </div>
                  <span style={{ fontSize: 12.5, color: "#6E6350" }}>{new Date(call.calledAt).toLocaleTimeString("fr-FR")}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ textAlign: "center", padding: "10px 20px 30px", fontSize: 12, color: "#6E6350" }}>
        <p style={{ margin: 0 }}>{hospital?.name} — Système Hospitalier National, République du Mali</p>
      </div>
    </div>
  );
}