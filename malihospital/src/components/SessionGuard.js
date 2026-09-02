import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { auth, db, functions } from "../firebase";
import { sendEmailVerification } from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { getDeviceLabel, getOrCreateSessionId, clearSessionId, getOrCreateDeviceId } from "../utils/deviceInfo";

// Device registration only applies to hospital-affiliated staff roles —
// not superadmin (who must never be locked out by this), and not
// facility roles (pharmacy/lab/facilityadmin), which aren't tied to a
// hospitalId the same way. Matches the actual ask: "useful for your
// hospital deployment."
const DEVICE_GATED_ROLES = ["doctor", "nurse", "accueil", "supervisor", "hospitaladmin"];
// pharmacy/lab are gated too, but ONLY when tied to a hospital (created via
// the Hospital Admin panel's staff form). Standalone pharmacy/lab facility
// accounts share these same role values but belong to a facilityId instead
// — there's no device-approval screen anywhere for that separate system,
// so gating them the same way would lock those accounts out permanently
// with no admin able to approve their way back in.
const HOSPITAL_SCOPED_DEVICE_GATED_ROLES = ["pharmacy", "lab"];

const HEARTBEAT_MS = 3 * 60 * 1000; // update lastActivityAt every 3 minutes while the app is open

const C = {
  night:     "#0F0D0A",
  nightSoft: "#252018",
  parchment: "#F6EEDD",
  clay:      "#B5502F",
  danger:    "#9A2B1F",
  line:      "rgba(216,201,168,0.14)",
};

const IDLE_WARN_MS   = 2 * 60 * 60 * 1000; // warn after 2 hours
const RESPONSE_SEC   = 30;                  // seconds to respond before auto logout
const RESPONSE_MS    = RESPONSE_SEC * 1000;
const CHECK_MS       = 1000; // how often to re-check real elapsed time — cheap, keeps the visible countdown smooth
const ARMED_AT_KEY   = "sh_session_armed_at"; // persisted so a tab reload/discard during sleep doesn't quietly reset the clock

function GlobalStyle() {
  return (
    <style>{`
      @keyframes sg-fadein {
        from { opacity: 0; transform: translateY(10px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      @keyframes sg-pop {
        0%   { transform: scale(0.85); opacity: 0; }
        60%  { transform: scale(1.03); }
        100% { transform: scale(1); opacity: 1; }
      }
      @keyframes sg-blink { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }

      .sg-backdrop {
        position: fixed; inset: 0; z-index: 9999;
        background: rgba(15,13,10,0.82);
        display: flex; align-items: center; justify-content: center;
        animation: sg-fadein 0.25s ease;
        backdrop-filter: blur(4px);
        font-family: 'Work Sans', sans-serif;
        padding: 20px;
      }
      .sg-modal {
        width: 100%; max-width: 400px;
        background: ${C.nightSoft};
        border: 1px solid rgba(181,80,47,0.35);
        border-radius: 16px;
        padding: 36px 32px 28px;
        box-shadow: 0 0 0 1px rgba(255,255,255,0.03) inset, 0 32px 64px rgba(0,0,0,0.7);
        animation: sg-pop 0.3s ease;
        text-align: center;
      }
      .sg-ring-wrap {
        width: 72px; height: 72px;
        display: flex; align-items: center; justify-content: center;
        margin: 0 auto 20px;
        position: relative;
      }
      .sg-ring-wrap svg:last-child { position: absolute; color: rgba(246,238,221,0.55); }
      .sg-title {
        font-family: 'Fraunces', serif; font-weight: 600; font-size: 21px;
        color: ${C.parchment}; margin: 0;
      }
      .sg-body {
        font-size: 13.5px; color: rgba(246,238,221,0.45); margin: 8px 0 0; line-height: 1.65;
      }
      .sg-count {
        font-family: 'Fraunces', serif; font-size: 15px; font-weight: 600;
        color: ${C.clay}; letter-spacing: 0.02em; margin-top: 16px;
      }
      .sg-count.urgent { color: #F4A89A; animation: sg-blink 0.6s ease-in-out infinite; }
      .sg-btn-confirm {
        width: 100%; padding: 14px; margin-top: 20px;
        background: ${C.clay}; color: #FFFDF8;
        border: none; border-radius: 10px;
        font-size: 14.5px; font-weight: 700; font-family: 'Work Sans', sans-serif;
        cursor: pointer; letter-spacing: 0.01em;
        box-shadow: 0 4px 20px rgba(181,80,47,0.25);
        transition: background 0.15s, transform 0.12s;
      }
      .sg-btn-confirm:hover { background: #C0592E; transform: translateY(-1px); }
      .sg-btn-logout {
        width: 100%; padding: 11px; margin-top: 8px;
        background: transparent; color: rgba(246,238,221,0.45);
        border: 1px solid ${C.line}; border-radius: 10px;
        font-size: 13.5px; font-family: 'Work Sans', sans-serif;
        cursor: pointer; transition: color 0.15s, border-color 0.15s, background 0.15s;
      }
      .sg-btn-logout:hover { color: rgba(246,238,221,0.75); border-color: rgba(216,201,168,0.28); background: rgba(216,201,168,0.06); }
    `}</style>
  );
}

function ShieldIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function VerifyEmailModal({ email, onResend, onRefresh, onLogout, resending, checking, resendMsg }) {
  return (
    <div className="sg-backdrop">
      <GlobalStyle />
      <div className="sg-modal">
        <div className="sg-ring-wrap">
          <svg width="72" height="72" viewBox="0 0 72 72">
            <circle cx="36" cy="36" r="30" fill="none" stroke={C.clay} strokeWidth="2" />
          </svg>
          <ShieldIcon />
        </div>
        <h2 className="sg-title">Vérifiez votre email</h2>
        <p className="sg-body">
          Un email de vérification a été envoyé à <strong>{email}</strong>. Cliquez sur le lien qu'il contient,
          puis revenez ici et cliquez sur « J'ai vérifié ».
        </p>
        {resendMsg && <p style={{ fontSize: 13, color: C.parchment, marginTop: -8, marginBottom: 16 }}>{resendMsg}</p>}
        <button className="sg-btn-confirm" onClick={onRefresh} disabled={checking} style={{ opacity: checking ? 0.7 : 1 }}>
          {checking ? "Vérification…" : "J'ai vérifié"}
        </button>
        <button className="sg-btn-logout" onClick={onResend} disabled={resending} style={{ opacity: resending ? 0.7 : 1 }}>
          {resending ? "Envoi…" : "Renvoyer l'email"}
        </button>
        <button className="sg-btn-logout" onClick={onLogout}>Déconnexion</button>
      </div>
    </div>
  );
}

function TerminatedModal({ reason, onDismiss }) {
  const messages = {
    disabled: {
      title: "Compte désactivé",
      body: "Votre compte a été désactivé par un administrateur. Contactez votre établissement pour plus d'informations.",
    },
    revoked: {
      title: "Session terminée",
      body: "Cette session a été déconnectée à distance, depuis un autre appareil ou par un administrateur.",
    },
    device_revoked: {
      title: "Appareil révoqué",
      body: "L'accès de cet appareil a été révoqué par un administrateur. Contactez votre administrateur si vous pensez qu'il s'agit d'une erreur.",
    },
    device_pending: {
      title: "Appareil en attente d'approbation",
      body: "Votre demande d'accès depuis cet appareil a été envoyée. Contactez votre administrateur pour l'approuver — vous pourrez vous connecter une fois l'appareil autorisé.",
    },
  };
  const { title, body } = messages[reason] || messages.revoked;

  return (
    <div className="sg-backdrop">
      <GlobalStyle />
      <div className="sg-modal">
        <div className="sg-ring-wrap">
          <svg width="72" height="72" viewBox="0 0 72 72">
            <circle cx="36" cy="36" r="30" fill="none" stroke={C.danger} strokeWidth="2" />
          </svg>
          <ShieldIcon />
        </div>
        <h2 className="sg-title">{title}</h2>
        <p className="sg-body">{body}</p>
        <button className="sg-btn-confirm" onClick={onDismiss}>Retour à la connexion</button>
      </div>
    </div>
  );
}

function IdleModal({ countdown, onConfirm, onLogout }) {
  const urgent = countdown <= 10;
  const r = 30, cx = 36, cy = 36, circ = 2 * Math.PI * r;
  const progress = countdown / RESPONSE_SEC;

  return (
    <div className="sg-backdrop">
      <GlobalStyle />
      <div className="sg-modal">
        <div className="sg-ring-wrap">
          <svg width="72" height="72" viewBox="0 0 72 72">
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(246,238,221,0.1)" strokeWidth="2" />
            <circle
              cx={cx} cy={cy} r={r} fill="none"
              stroke={urgent ? "#F4A89A" : C.clay}
              strokeWidth="2" strokeLinecap="round"
              strokeDasharray={`${circ * progress} ${circ}`}
              transform={`rotate(-90 ${cx} ${cy})`}
              style={{ transition: "stroke-dasharray 1s linear, stroke 0.3s" }}
            />
          </svg>
          <ShieldIcon />
        </div>
        <h2 className="sg-title">Êtes-vous toujours là ?</h2>
        <p className="sg-body">
           Veuillez confirmer votre présence pour rester connecté.
        </p>
        <div className={`sg-count${urgent ? " urgent" : ""}`}>
          Déconnexion automatique dans {countdown}s
        </div>
        <button className="sg-btn-confirm" onClick={onConfirm}>Je suis toujours là</button>
        <button className="sg-btn-logout" onClick={onLogout}>Se déconnecter</button>
      </div>
    </div>
  );
}

// This is the ONLY session-idle mechanism in the app. Login.jsx does
// NOT run its own competing timer (that was the bug).
//
// This does NOT track mouse/keyboard activity — by design, it's a fixed
// "confirm you're still here every 2 hours since login/last confirm"
// check-in, not true idle detection. What it DOES need to be correct
// about is real wall-clock time: a laptop closed for 10 hours must not
// come back thinking only a few seconds have passed. setTimeout/interval
// durations alone can't guarantee that — browsers throttle or fully
// discard backgrounded tabs during long sleeps, which would silently
// reset any in-memory timer back to zero. So instead: armedAt is a real
// timestamp, persisted to localStorage (survives a tab reload/discard),
// and re-checked against Date.now() on a short poll AND immediately
// whenever the tab regains visibility (the exact moment a laptop wakes).
export default function SessionGuard({ children }) {
  const [sessionWarn, setSessionWarn]     = useState(false);
  const [idleCountdown, setIdleCountdown] = useState(RESPONSE_SEC);
  const armedAt = useRef(null); // ms epoch, or null when no session is active
  const verificationEmailSent = useRef(false);
  const checkInterval = useRef(null);
  const heartbeatInterval = useRef(null);
  const accountUnsub = useRef(null);
  const sessionUnsub = useRef(null);
  const [terminatedReason, setTerminatedReason] = useState(null); // "disabled" | "revoked" | null
  const [needsEmailVerification, setNeedsEmailVerification] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState("");
  const [resendingVerification, setResendingVerification] = useState(false);
  const [checkingVerification, setCheckingVerification] = useState(false);
  const [resendMsg, setResendMsg] = useState("");
  const nav = useNavigate();

  const logSecurityEvent = useCallback(async (type, uid, extra = {}) => {
    try {
      await setDoc(doc(db, "securityEvents", `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`), {
        type, actorId: uid, timestamp: new Date().toISOString(), ...extra,
      });
    } catch (e) {
      // Never let event-logging itself break the actual security action.
      console.warn("Could not log security event (non-fatal):", e.message);
    }
  }, []);

  const stopSessionTracking = useCallback(() => {
    clearInterval(heartbeatInterval.current);
    if (sessionUnsub.current) { sessionUnsub.current(); sessionUnsub.current = null; }
  }, []);

  const forceLogout = useCallback(async () => {
    clearInterval(checkInterval.current);
    stopSessionTracking();
    if (accountUnsub.current) { accountUnsub.current(); accountUnsub.current = null; }
    armedAt.current = null;
    try { localStorage.removeItem(ARMED_AT_KEY); } catch {}
    setSessionWarn(false);
    try { await auth.signOut(); } catch {}
    clearSessionId();
    nav("/login", { state: { sessionExpired: true } });
  }, [nav, stopSessionTracking]);

  // Distinct from forceLogout (the idle-timeout path): this is triggered
  // by an external event — an admin disabling the account, or this exact
  // session being revoked from elsewhere — so it shows an explanation
  // instead of "you were idle," and doesn't offer a 30-second grace
  // period, since there's nothing to confirm your way out of.
  const terminateSession = useCallback(async (reason) => {
    clearInterval(checkInterval.current);
    stopSessionTracking();
    if (accountUnsub.current) { accountUnsub.current(); accountUnsub.current = null; }
    armedAt.current = null;
    try { localStorage.removeItem(ARMED_AT_KEY); } catch {}
    setSessionWarn(false);
    setTerminatedReason(reason);
    try { await auth.signOut(); } catch {}
    clearSessionId();
  }, [stopSessionTracking]);

  const dismissTerminated = useCallback(() => {
    setTerminatedReason(null);
    nav("/login", { state: { sessionExpired: true } });
  }, [nav]);

  const armSession = useCallback(() => {
    const now = Date.now();
    armedAt.current = now;
    try { localStorage.setItem(ARMED_AT_KEY, String(now)); } catch {}
    setSessionWarn(false);
  }, []);

  // The actual correctness lives here: compare NOW against the real
  // armedAt timestamp, not against "how long has this setTimeout been
  // running." Called on every poll tick AND immediately on wake.
  const checkElapsed = useCallback(() => {
    if (armedAt.current == null) return;
    const elapsed = Date.now() - armedAt.current;

    if (elapsed >= IDLE_WARN_MS + RESPONSE_MS) {
      // Already past both the warning threshold AND the response window
      // — e.g. a laptop closed for 10 hours. Skip straight to logout
      // rather than showing a countdown that's already long expired.
      forceLogout();
      return;
    }
    if (elapsed >= IDLE_WARN_MS) {
      const remainingMs = IDLE_WARN_MS + RESPONSE_MS - elapsed;
      setSessionWarn(true);
      setIdleCountdown(Math.max(0, Math.ceil(remainingMs / 1000)));
    } else {
      setSessionWarn(false);
    }
  }, [forceLogout]);

  const confirmPresence = useCallback(() => {
    armSession();
  }, [armSession]);

  // Creates this browser's session record on first login, or just
  // touches lastActivityAt if this exact browser session already has one
  // (e.g. a page refresh) — sessionId itself is the document ID, so this
  // is a natural upsert. Then starts a heartbeat and, critically, a live
  // listener on that same document: if ITS "revoked" flag flips to true
  // from ANYWHERE (this device's own "Sessions actives" page, another
  // device, or a hospital admin), this browser finds out immediately and
  // ends the session — regardless of which browser initiated the revoke.
  const startSessionTracking = useCallback(async (user, userData) => {
    const sessionId = getOrCreateSessionId();
    const sessionRef = doc(db, "sessions", sessionId);

    try {
      const existingSnap = await getDoc(sessionRef);

      if (!existingSnap.exists()) {
        await setDoc(sessionRef, {
          uid: user.uid,
          email: user.email,
          displayName: `${userData.firstName || ""} ${userData.lastName || ""}`.trim() || user.email,
          hospitalId: userData.hospitalId || null,
          deviceLabel: getDeviceLabel(),
          revoked: false,
          loginAt: new Date().toISOString(),
          lastActivityAt: new Date().toISOString(),
        });
        logSecurityEvent("new_session", user.uid, { deviceLabel: getDeviceLabel(), email: user.email });
        // Fire-and-forget: records IP + approximate city/country onto
        // this same session doc once it exists. Never blocks or delays
        // login — a failed lookup just leaves those fields empty,
        // handled gracefully wherever they're displayed.
        httpsCallable(functions, "recordLoginContext")({ sessionId })
          .catch((e) => console.warn("Could not record login IP/location (non-fatal):", e.message));
      } else {
        await setDoc(sessionRef, { lastActivityAt: new Date().toISOString() }, { merge: true });
      }
    } catch (e) {
      console.warn("Could not create/update session record (non-fatal):", e.message);
    }

    clearInterval(heartbeatInterval.current);
    heartbeatInterval.current = setInterval(() => {
      setDoc(sessionRef, { lastActivityAt: new Date().toISOString() }, { merge: true }).catch(() => {});
    }, HEARTBEAT_MS);

    if (sessionUnsub.current) sessionUnsub.current();
    sessionUnsub.current = onSnapshot(sessionRef, (snap) => {
      if (snap.exists() && snap.data().revoked) {
        terminateSession("revoked");
      }
    }, (e) => console.warn("Session listener error (non-fatal):", e.message));
  }, [logSecurityEvent, terminateSession]);

  // #1 — Device registration, scoped to hospital-affiliated staff only
  // (see DEVICE_GATED_ROLES). One active device per account: the first
  // device ever seen for a given account auto-registers as theirs; a
  // login attempt from a second, different device while an active one
  // already exists is blocked here, before session tracking even starts
  // — until a hospital admin revokes the old device, which clears the
  // way for the next one to register.
  //
  // Returns true if the login may proceed, false if it was blocked
  // (blocking already handles its own sign-out/messaging internally).
  const checkDeviceAuthorization = useCallback(async (user, userData) => {
    const isGated = DEVICE_GATED_ROLES.includes(userData.role)
      || (HOSPITAL_SCOPED_DEVICE_GATED_ROLES.includes(userData.role) && !!userData.hospitalId);
    if (!isGated) return true; // not gated for this role
    const deviceId = getOrCreateDeviceId();

    let ownDeviceSnap;
    try {
      ownDeviceSnap = await getDoc(doc(db, "devices", deviceId));
    } catch (e) {
      // Fail OPEN, not closed — a transient read error shouldn't lock
      // legitimate staff out of the app. Device registration is a
      // deterrent, not a hard security boundary (see the honesty note in
      // deviceInfo.js), so erring toward availability here is the right
      // trade-off.
      console.warn("Could not check device registration (non-fatal, allowing login):", e.message);
      return true;
    }

    if (ownDeviceSnap.exists()) {
      const status = ownDeviceSnap.data().status;
      if (status === "active") {
        updateDoc(doc(db, "devices", deviceId), { lastSeen: new Date().toISOString() }).catch(() => {});
        return true;
      }
      if (status === "revoked") {
        await terminateSession("device_revoked");
        return false;
      }
      // status === "pending" — already filed, don't create a duplicate.
      await terminateSession("device_pending");
      return false;
    }

    // First time this exact device has ever been seen for this account —
    // file a pending request. Never self-activates; an admin (super
    // admin for a hospitaladmin account, hospital admin for everyone
    // else) has to explicitly approve it before this device can be used.
    try {
      await setDoc(doc(db, "devices", deviceId), {
        userId: user.uid,
        userName: `${userData.firstName || ""} ${userData.lastName || ""}`.trim() || user.email,
        userEmail: user.email,
        hospitalId: userData.hospitalId || null,
        role: userData.role,
        deviceLabel: getDeviceLabel(),
        registeredAt: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        status: "pending",
      });
    } catch (e) {
      console.warn("Could not file device registration request (non-fatal, allowing login):", e.message);
      return true;
    }
    await terminateSession("device_pending");
    return false;
  }, [terminateSession]);

  // #11 — real-time enforcement that account status changes apply
  // immediately, not just at next login. A doctor already logged in when
  // an admin disables them should be signed out within moments, not stay
  // logged in until they happen to refresh.
  const startAccountWatch = useCallback((uid) => {
    if (accountUnsub.current) accountUnsub.current();
    accountUnsub.current = onSnapshot(doc(db, "users", uid), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      if (data.disabled === true) {
        terminateSession("disabled");
      }
    }, (e) => console.warn("Account watch error (non-fatal):", e.message));
  }, [terminateSession]);

  // Orchestrates the checks above in the right order: device
  // authorization first (a blocked device shouldn't get a session record
  // created at all), then email verification, then session tracking +
  // account watching only if everything passed. Fetches the user's
  // profile once and shares it, rather than each concern re-fetching it
  // independently.
  const initializeSession = useCallback(async (user) => {
    let userData = {};
    try {
      const userSnap = await getDoc(doc(db, "users", user.uid));
      userData = userSnap.exists() ? userSnap.data() : {};
    } catch (e) {
      console.warn("Could not load user profile for session init (non-fatal):", e.message);
    }

    const authorized = await checkDeviceAuthorization(user, userData);
    if (!authorized) return;

    if (!user.emailVerified) {
      setVerificationEmail(user.email);
      setNeedsEmailVerification(true);
      if (!verificationEmailSent.current) {
        verificationEmailSent.current = true;
        sendEmailVerification(user).catch((e) => console.warn("Could not send verification email (non-fatal):", e.message));
      }
      return;
    }
    setNeedsEmailVerification(false);

    startSessionTracking(user, userData);
    startAccountWatch(user.uid);
  }, [checkDeviceAuthorization, startSessionTracking, startAccountWatch]);

  const resendVerification = useCallback(async () => {
    if (!auth.currentUser) return;
    setResendingVerification(true);
    setResendMsg("");
    try {
      await sendEmailVerification(auth.currentUser);
      setResendMsg("✅ Email envoyé.");
    } catch (e) {
      setResendMsg("❌ " + (e.code === "auth/too-many-requests" ? "Trop de tentatives, réessayez dans quelques minutes." : e.message));
    }
    setResendingVerification(false);
  }, []);

  const refreshVerificationStatus = useCallback(async () => {
    if (!auth.currentUser) return;
    setCheckingVerification(true);
    setResendMsg("");
    try {
      await auth.currentUser.reload();
      if (auth.currentUser.emailVerified) {
        setNeedsEmailVerification(false);
        initializeSession(auth.currentUser);
      } else {
        setResendMsg("Pas encore vérifié — cliquez sur le lien reçu par email, puis réessayez.");
      }
    } catch (e) {
      setResendMsg("❌ " + e.message);
    }
    setCheckingVerification(false);
  }, [initializeSession]);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(user => {
      clearInterval(checkInterval.current);
      if (user) {
        // Resume from a persisted armedAt if one exists (e.g. this tab
        // was reloaded/discarded during sleep) rather than always
        // treating auth-state-restored as "just logged in" — otherwise
        // exactly the bug being fixed here would reappear one layer up.
        let resumeFrom = null;
        try {
          const stored = localStorage.getItem(ARMED_AT_KEY);
          if (stored) resumeFrom = Number(stored);
        } catch {}
        armedAt.current = (resumeFrom && !Number.isNaN(resumeFrom)) ? resumeFrom : Date.now();
        if (!resumeFrom) {
          try { localStorage.setItem(ARMED_AT_KEY, String(armedAt.current)); } catch {}
        }
        checkElapsed();
        checkInterval.current = setInterval(checkElapsed, CHECK_MS);

        initializeSession(user);
      } else {
        armedAt.current = null;
        try { localStorage.removeItem(ARMED_AT_KEY); } catch {}
        setSessionWarn(false);
        stopSessionTracking();
        if (accountUnsub.current) { accountUnsub.current(); accountUnsub.current = null; }
        // Critical: this fires on EVERY sign-out, not just the ones
        // SessionGuard itself triggers (idle timeout, disable, revoke).
        // A normal "Déconnexion" click calls Firebase's signOut directly
        // from each dashboard, bypassing forceLogout/terminateSession
        // entirely — without clearing it here too, the sessionStorage ID
        // would survive a manual logout, and the NEXT login in that same
        // tab (even a completely different account) would silently reuse
        // the previous person's session document instead of creating
        // its own.
        clearSessionId();
        verificationEmailSent.current = false;
        setNeedsEmailVerification(false);
        setResendMsg("");
      }
    });
    return () => {
      unsub();
      clearInterval(checkInterval.current);
      stopSessionTracking();
      if (accountUnsub.current) accountUnsub.current();
    };
  }, [checkElapsed, initializeSession, stopSessionTracking]);

  // The moment a laptop wakes / a backgrounded tab regains focus is
  // exactly when a stale timer would otherwise misbehave — check
  // immediately here instead of waiting up to CHECK_MS for the next poll.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") checkElapsed();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [checkElapsed]);

  return (
    <>
      {terminatedReason && (
        <TerminatedModal reason={terminatedReason} onDismiss={dismissTerminated} />
      )}
      {!terminatedReason && needsEmailVerification && (
        <VerifyEmailModal
          email={verificationEmail}
          onResend={resendVerification}
          onRefresh={refreshVerificationStatus}
          onLogout={forceLogout}
          resending={resendingVerification}
          checking={checkingVerification}
          resendMsg={resendMsg}
        />
      )}
      {!terminatedReason && !needsEmailVerification && sessionWarn && (
        <IdleModal
          countdown={idleCountdown}
          onConfirm={confirmPresence}
          onLogout={forceLogout}
        />
      )}
      {children}
    </>
  );
}