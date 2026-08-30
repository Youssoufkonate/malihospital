import { useState, useEffect, useRef } from "react";
import {
  signInWithEmailAndPassword,
  setPersistence,
  browserLocalPersistence,
  getMultiFactorResolver,
  TotpMultiFactorGenerator,
} from "firebase/auth";
import { auth, db, functions } from "../firebase";
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { useNavigate } from "react-router-dom";

// reCAPTCHA v2 site key — a SEPARATE key from the v3 one in firebase.js
// (App Check), since v2 and v3 are different products with their own
// key pairs. This is the visible "I'm not a robot" checkbox specifically
// on this login page. The site key is safe to have in frontend code
// (only the SECRET key, used server-side in verifyRecaptcha, must never
// appear here) — but until you register a real v2 site and replace this
// placeholder, the checkbox simply won't render (caught gracefully, not
// a crash) and login proceeds without it.
const RECAPTCHA_V2_SITE_KEY = "6Lcx0IwtAAAAAAK3qHOguzp2Y8xlBnL2llsJk9mT";

// ─── Palette ──────────────────────────────────────────────────
const C = {
  night:        "#0F0D0A",
  nightMid:     "#1A1610",
  nightSoft:    "#252018",
  parchment:    "#F6EEDD",
  parchmentDeep:"#EDE1C7",
  ink:          "#211C16",
  inkSoft:      "#3B332A",
  clay:         "#B5502F",
  clayDeep:     "#8F3E23",
  clayGlow:     "rgba(181,80,47,0.18)",
  gold:         "#D9A441",
  goldSoft:     "#E9C77D",
  goldGhost:    "rgba(217,164,65,0.12)",
  green:        "#166A3F",
  greenSoft:    "#1F8A54",
  line:         "#D8C9A8",
  lineGhost:    "rgba(216,201,168,0.18)",
  danger:       "#9A2B1F",
  dangerBg:     "#F6E3DD",
  dangerBorder: "#E3B6AC",
  success:      "#1F5C3A",
  successBg:    "#E3EEE3",
  successBorder:"#B9D6BE",
  warn:         "#7A5A10",
  warnBg:       "#FDF3DC",
  warnBorder:   "#E9C77D",
};

// ─── Security constants ───────────────────────────────────────
const MAX_ATTEMPTS      = 2;      // lock after this many failures
// Lockout duration (2 hours) is now determined SERVER-SIDE, in
// functions/lib/loginSecurity.js's LOCKOUT_MS — the client just uses
// whatever lockedUntil timestamp the server returns, rather than
// computing its own duration. No local constant needed for it.
const THROTTLE_DELAY_MS = 800; // minimum ms between submits

// NOTE: Login.jsx used to run its own post-login session-expiry timer
// (SESSION_WARN_MS / SESSION_EXPIRE_MS) here. It has been REMOVED —
// it was buggy (SESSION_EXPIRE_MS was accidentally set to 2 SECONDS
// instead of 30 minutes, so every user got silently signed out ~2s
// after logging in) and it was redundant: <SessionGuard> in App.jsx
// already provides a single, correct, app-wide idle timer (2h warning,
// 30s to confirm) that covers every authenticated page, not just the
// moment right after login. Don't re-add a second timer here.

// ─── Role routing ─────────────────────────────────────────────
const ROLE_ROUTES = {
  superadmin:    "/superadmin",
  hospitaladmin: "/admin",
  doctor:        "/doctor",
  nurse:         "/nurse",
  accueil:       "/accueil",
  supervisor:    "/supervisor",
  pharmacy:      "/pharmacy",
  facilityadmin: "/facility-admin",
};

// ─── Bogolan SVG pattern ──────────────────────────────────────
function BogolanPattern({ id, colorA = C.gold, colorB = C.clay, opacity = 1 }) {
  return (
    <svg
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity }}
      preserveAspectRatio="none"
    >
      <defs>
        <pattern id={id} width="46" height="46" patternUnits="userSpaceOnUse">
          <rect width="46" height="46" fill="transparent" />
          <path d="M23 2 L44 23 L23 44 L2 23 Z" fill="none" stroke={colorA} strokeWidth="1.2" opacity="0.55" />
          <circle cx="23" cy="23" r="3" fill={colorB} opacity="0.5" />
          <path d="M0 23 H8 M38 23 H46" stroke={colorA} strokeWidth="1" opacity="0.4" />
          <circle cx="0"  cy="0"  r="1.5" fill={colorA} opacity="0.25" />
          <circle cx="46" cy="0"  r="1.5" fill={colorA} opacity="0.25" />
          <circle cx="0"  cy="46" r="1.5" fill={colorA} opacity="0.25" />
          <circle cx="46" cy="46" r="1.5" fill={colorA} opacity="0.25" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

// ─── Global styles ────────────────────────────────────────────
function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,ital,wght@9..144,0,400;9..144,0,500;9..144,0,600;9..144,0,700;9..144,1,400&family=Work+Sans:wght@400;500;600;700&display=swap');

      *, *::before, *::after { box-sizing: border-box; }

      .sh-root {
        min-height: 100vh;
        background: ${C.night};
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 32px 20px;
        font-family: 'Work Sans', sans-serif;
        position: relative;
        overflow: hidden;
      }

      .sh-ambient {
        position: absolute;
        pointer-events: none;
        border-radius: 50%;
        filter: blur(80px);
      }
      .sh-ambient-a {
        width: 500px; height: 500px;
        top: -180px; left: -120px;
        background: radial-gradient(circle, rgba(181,80,47,0.12) 0%, transparent 70%);
      }
      .sh-ambient-b {
        width: 400px; height: 400px;
        bottom: -100px; right: -100px;
        background: radial-gradient(circle, rgba(217,164,65,0.08) 0%, transparent 70%);
      }

      .sh-card {
        position: relative;
        width: 100%;
        max-width: 960px;
        border-radius: 20px;
        overflow: hidden;
        border: 1px solid rgba(216,201,168,0.14);
        box-shadow:
          0 0 0 1px rgba(255,255,255,0.03) inset,
          0 40px 80px rgba(0,0,0,0.7),
          0 0 60px rgba(181,80,47,0.06);
        display: grid;
        grid-template-columns: 1fr;
      }
      @media (min-width: 860px) {
        .sh-card { grid-template-columns: 300px 1fr; }
      }

      .sh-brand {
        position: relative;
        background: ${C.nightMid};
        padding: 44px 32px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        overflow: hidden;
      }
      @media (max-width: 859px) {
        .sh-brand { padding: 32px 28px 36px; }
      }

      .sh-flag-stripe {
        position: absolute;
        top: 0; left: 0; bottom: 0;
        width: 5px;
        background: linear-gradient(
          to bottom,
          ${C.green}  0%,   ${C.green}  33.3%,
          ${C.gold}  33.3%, ${C.gold}  66.6%,
          ${C.clay}  66.6%, ${C.clay}  100%
        );
      }

      .sh-brand-top-line {
        position: absolute;
        top: 0; left: 0; right: 0;
        height: 3px;
        background: linear-gradient(90deg, ${C.gold}, transparent 80%);
        opacity: 0.5;
      }

      .sh-brand-emblem {
        width: 80px; height: 80px;
        border-radius: 50%;
        border: 2px solid rgba(217,164,65,0.5);
        background: rgba(217,164,65,0.07);
        display: flex; align-items: center; justify-content: center;
        overflow: hidden;
        margin-bottom: 24px;
        box-shadow: 0 0 0 6px rgba(217,164,65,0.06);
      }
      .sh-brand-emblem img {
        width: 70%; height: 70%;
        object-fit: contain;
        filter: brightness(1.05);
      }

      .sh-brand h1 {
        margin: 0;
        font-family: 'Fraunces', serif;
        font-weight: 600;
        font-size: 26px;
        line-height: 1.2;
        color: ${C.parchment};
        letter-spacing: -0.01em;
      }

      .sh-brand-rule {
        width: 40px; height: 2px;
        background: ${C.clay};
        border-radius: 2px;
        margin: 18px 0;
      }

      .sh-brand p {
        margin: 0;
        font-size: 13.5px;
        line-height: 1.75;
        color: rgba(246,238,221,0.45);
        max-width: 240px;
      }

      .sh-brand-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-top: 24px;
        padding: 6px 10px;
        background: rgba(22,106,63,0.15);
        border: 1px solid rgba(22,106,63,0.3);
        border-radius: 6px;
        font-size: 11px;
        letter-spacing: 0.06em;
        color: #6FC99A;
        font-weight: 600;
        text-transform: uppercase;
      }

      .sh-form-panel {
        background: ${C.nightSoft};
        padding: 52px 44px;
        position: relative;
        display: flex;
        flex-direction: column;
        justify-content: center;
      }
      @media (max-width: 600px) {
        .sh-form-panel { padding: 36px 24px; }
      }

      .sh-form-panel::before {
        content: '';
        position: absolute;
        top: 0; left: 0; right: 0;
        height: 1px;
        background: linear-gradient(90deg, transparent, rgba(216,201,168,0.12), transparent);
      }

      .sh-form-title {
        margin: 0 0 4px;
        font-family: 'Fraunces', serif;
        font-weight: 600;
        font-size: 28px;
        color: ${C.parchment};
        letter-spacing: -0.02em;
      }
      .sh-form-sub {
        margin: 0 0 32px;
        font-size: 13px;
        color: rgba(246,238,221,0.35);
        line-height: 1.6;
      }

      .sh-label {
        display: block;
        font-size: 11.5px;
        font-weight: 600;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: rgba(246,238,221,0.38);
        margin-bottom: 7px;
      }

      .sh-input-wrap {
        position: relative;
        margin-bottom: 18px;
      }
      .sh-input-icon {
        position: absolute;
        top: 50%; left: 14px;
        transform: translateY(-50%);
        color: rgba(216,201,168,0.3);
        pointer-events: none;
        display: flex; align-items: center;
      }
      .sh-input {
        width: 100%;
        padding: 13px 14px 13px 40px;
        background: rgba(255,253,248,0.05);
        border: 1px solid rgba(216,201,168,0.15);
        border-radius: 10px;
        font-size: 15px;
        color: ${C.parchment};
        font-family: 'Work Sans', sans-serif;
        transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
        outline: none;
      }
      .sh-input::placeholder { color: rgba(216,201,168,0.22); }
      .sh-input:focus {
        border-color: rgba(181,80,47,0.6);
        background: rgba(255,253,248,0.07);
        box-shadow: 0 0 0 3px rgba(181,80,47,0.1);
      }
      .sh-input:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
      .sh-input-error { border-color: rgba(154,43,31,0.7) !important; }

      .sh-pw-toggle {
        position: absolute;
        top: 50%; right: 12px;
        transform: translateY(-50%);
        background: none; border: none;
        cursor: pointer;
        color: rgba(216,201,168,0.3);
        padding: 4px;
        display: flex; align-items: center;
        transition: color 0.15s;
        border-radius: 4px;
      }
      .sh-pw-toggle:hover { color: rgba(216,201,168,0.65); }
      .sh-pw-toggle:focus-visible { outline: 2px solid ${C.clay}; }

      .sh-input-has-toggle { padding-right: 44px !important; }

      .sh-strength-bar {
        display: flex;
        gap: 4px;
        margin-top: 6px;
        margin-bottom: 4px;
      }
      .sh-strength-seg {
        flex: 1; height: 3px; border-radius: 2px;
        background: rgba(216,201,168,0.1);
        transition: background 0.3s;
      }

      .sh-btn-primary {
        width: 100%;
        padding: 15px;
        background: ${C.clay};
        color: #FFFDF8;
        border: none;
        border-radius: 10px;
        cursor: pointer;
        font-size: 15px;
        font-weight: 700;
        font-family: 'Work Sans', sans-serif;
        margin-top: 6px;
        margin-bottom: 12px;
        box-shadow: 0 4px 20px rgba(181,80,47,0.25), 0 1px 0 rgba(255,255,255,0.08) inset;
        transition: transform 0.12s, box-shadow 0.12s, background 0.15s, opacity 0.15s;
        position: relative;
        overflow: hidden;
        letter-spacing: 0.01em;
      }
      .sh-btn-primary::after {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(135deg, rgba(255,255,255,0.06) 0%, transparent 60%);
        pointer-events: none;
      }
      .sh-btn-primary:not(:disabled):hover {
        transform: translateY(-1px);
        box-shadow: 0 8px 28px rgba(181,80,47,0.38), 0 1px 0 rgba(255,255,255,0.08) inset;
        background: #C0592E;
      }
      .sh-btn-primary:not(:disabled):active {
        transform: translateY(0);
        box-shadow: 0 2px 8px rgba(181,80,47,0.2);
      }
      .sh-btn-primary:disabled { opacity: 0.55; cursor: not-allowed; transform: none !important; }

      .sh-btn-secondary {
        width: 100%;
        padding: 13px;
        background: transparent;
        color: rgba(246,238,221,0.55);
        border: 1px solid rgba(216,201,168,0.14);
        border-radius: 10px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        font-family: 'Work Sans', sans-serif;
        transition: background 0.15s, border-color 0.15s, color 0.15s, transform 0.12s;
        letter-spacing: 0.01em;
      }
      .sh-btn-secondary:not(:disabled):hover {
        background: rgba(216,201,168,0.06);
        border-color: rgba(216,201,168,0.25);
        color: rgba(246,238,221,0.8);
        transform: translateY(-1px);
      }
      .sh-btn-secondary:disabled { opacity: 0.4; cursor: not-allowed; }

      .sh-alert {
        padding: 13px 16px;
        border-radius: 10px;
        margin-top: 14px;
        font-size: 13.5px;
        font-weight: 500;
        line-height: 1.55;
        display: flex;
        align-items: flex-start;
        gap: 10px;
        border: 1px solid;
      }
      .sh-alert-danger  { background: rgba(154,43,31,0.12);  color: #F4A89A; border-color: rgba(154,43,31,0.3);  }
      .sh-alert-warn    { background: rgba(122,90,16,0.14);  color: #E9C77D; border-color: rgba(122,90,16,0.3);  }
      .sh-alert-success { background: rgba(31,92,58,0.14);   color: #6FC99A; border-color: rgba(31,92,58,0.3);   }
      .sh-alert-icon { margin-top: 1px; flex-shrink: 0; }

      .sh-lockout {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        padding: 16px 20px;
        background: rgba(154,43,31,0.1);
        border: 1px solid rgba(154,43,31,0.25);
        border-radius: 10px;
        margin-top: 14px;
      }
      .sh-lockout-clock {
        font-family: 'Fraunces', serif;
        font-size: 22px;
        font-weight: 600;
        color: #F4A89A;
        min-width: 52px;
        text-align: center;
        letter-spacing: -0.02em;
      }
      .sh-lockout-text { font-size: 12.5px; color: rgba(244,168,154,0.7); line-height: 1.5; }

      .sh-dots {
        display: flex;
        gap: 6px;
        margin-bottom: 20px;
        align-items: center;
      }
      .sh-dot {
        width: 7px; height: 7px; border-radius: 50%;
        background: rgba(216,201,168,0.12);
        border: 1px solid rgba(216,201,168,0.2);
        transition: background 0.25s, border-color 0.25s;
      }
      .sh-dot-used { background: ${C.clay}; border-color: ${C.clay}; }
      .sh-dot-last { background: ${C.danger}; border-color: ${C.danger}; }
      .sh-dots-label { font-size: 11px; color: rgba(216,201,168,0.28); margin-left: 4px; letter-spacing: 0.06em; }

      @keyframes sh-spin { to { transform: rotate(360deg); } }
      .sh-spinner {
        width: 18px; height: 18px;
        border: 2px solid rgba(255,255,255,0.25);
        border-top-color: #fff;
        border-radius: 50%;
        animation: sh-spin 0.7s linear infinite;
        display: inline-block;
        vertical-align: middle;
        margin-right: 8px;
      }

      .sh-fullscreen {
        min-height: 100vh;
        background: ${C.night};
        display: flex; align-items: center; justify-content: center;
        flex-direction: column; gap: 20px;
        font-family: 'Work Sans', sans-serif;
        position: relative; overflow: hidden;
      }
      .sh-fullscreen-spinner {
        width: 48px; height: 48px;
        border: 3px solid rgba(216,201,168,0.1);
        border-top-color: ${C.clay};
        border-radius: 50%;
        animation: sh-spin 0.9s linear infinite;
      }
      .sh-fullscreen p {
        font-family: 'Fraunces', serif;
        font-size: 16px;
        color: rgba(246,238,221,0.35);
        margin: 0;
        letter-spacing: 0.02em;
      }

      .sh-divider {
        display: flex; align-items: center; gap: 12px;
        margin: 18px 0;
      }
      .sh-divider-line { flex: 1; height: 1px; background: rgba(216,201,168,0.08); }
      .sh-divider-dot { width: 4px; height: 4px; border-radius: 50%; background: rgba(216,201,168,0.15); flex-shrink: 0; }

      .sh-version {
        margin-top: 24px;
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 10.5px;
        color: rgba(216,201,168,0.2);
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }
      .sh-version-dot { width: 3px; height: 3px; border-radius: 50%; background: rgba(216,201,168,0.2); }

      .sh-input:-webkit-autofill,
      .sh-input:-webkit-autofill:hover,
      .sh-input:-webkit-autofill:focus {
        -webkit-box-shadow: 0 0 0 1000px #252018 inset !important;
        -webkit-text-fill-color: ${C.parchment} !important;
        border-color: rgba(216,201,168,0.15) !important;
        caret-color: ${C.parchment};
      }
    `}</style>
  );
}

// ─── Icons ──────────────────────────────────────────────────
const EyeIcon = ({ open }) => open ? (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
  </svg>
) : (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
);

const LockIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  </svg>
);

const MailIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
    <polyline points="22,6 12,13 2,6"/>
  </svg>
);

const ShieldIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </svg>
);

const AlertIcon = ({ type }) => {
  if (type === "warn") return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="sh-alert-icon">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  );
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="sh-alert-icon">
      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
  );
};

// ─── Password strength helper ─────────────────────────────────
function calcStrength(pw) {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8)  score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score, 4);
}

const STRENGTH_COLORS = ["", "#9A2B1F", "#B5502F", "#D9A441", "#1F8A54"];
const STRENGTH_LABELS = ["", "Faible", "Passable", "Bon", "Solide"];

// ─── Attempt dots ─────────────────────────────────────────────
function AttemptDots({ used, max }) {
  if (used === 0) return null;
  return (
    <div className="sh-dots">
      {Array.from({ length: max }).map((_, i) => {
        const filled = i < used;
        const isLast = i === used - 1 && used === max;
        return (
          <div
            key={i}
            className={`sh-dot ${filled ? (isLast ? "sh-dot-last" : "sh-dot-used") : ""}`}
          />
        );
      })}
      <span className="sh-dots-label">
        {max - used > 0 ? `${max - used} essai${max - used > 1 ? "s" : ""} restant${max - used > 1 ? "s" : ""}` : "Compte verrouillé"}
      </span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────
export default function Login() {
  const [email,      setEmail]      = useState("");
  const [pass,       setPass]       = useState("");
  const [showPass,   setShowPass]   = useState(false);
  const [msg,        setMsg]        = useState(null);   // { text, type }
  const [loading,    setLoading]    = useState(false);
  const [checking,   setChecking]   = useState(true);
  const [attempts,   setAttempts]   = useState(0);
  const [lockUntil,  setLockUntil]  = useState(0);     // epoch ms
  const [countdown,  setCountdown]  = useState(0);
  const [strength,   setStrength]   = useState(0);
  const [lockedEmail, setLockedEmail] = useState(""); // which account the current lock applies to
  const [mfaResolver, setMfaResolver] = useState(null);
  const [forgotPasswordMode, setForgotPasswordMode] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSubmitting, setForgotSubmitting] = useState(false);
  const [forgotMsg, setForgotMsg] = useState("");
  const [forgotRecaptchaToken, setForgotRecaptchaToken] = useState(null);
  const [forgotRecaptchaReady, setForgotRecaptchaReady] = useState(false);
  const forgotRecaptchaWidgetId = useRef(null);
  const forgotRecaptchaContainerRef = useRef(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaError, setMfaError] = useState("");
  const [submittingMfa, setSubmittingMfa] = useState(false);
  const [recaptchaToken, setRecaptchaToken] = useState(null);
  const [recaptchaReady, setRecaptchaReady] = useState(false);
  const recaptchaWidgetId = useRef(null);
  const recaptchaContainerRef = useRef(null);
  const lastSubmit   = useRef(0);
  const nav = useNavigate();

  // No mount-time hydration anymore — the lock is per-ACCOUNT (server-
  // side, by email), not per-browser, so there's nothing to check until
  // the user actually types an email and submits. See login() below.

  // ── Lockout countdown ticker ───────────────────────────────
  useEffect(() => {
    if (!lockUntil) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((lockUntil - Date.now()) / 1000));
      setCountdown(remaining);
      if (remaining <= 0) {
        setLockUntil(0);
        setAttempts(0);
        setLockedEmail("");
      }
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [lockUntil]);

  // ── Auth state observer ────────────────────────────────────
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (user) => {
      if (user) {
        try {
          const snap = await getDoc(doc(db, "users", user.uid));
          if (snap.exists()) {
            const data = snap.data();
            if (data.disabled) {
              setMsg({ text: "Votre compte a été désactivé. Contactez l'administrateur.", type: "danger" });
              await auth.signOut();
              setChecking(false);
              return;
            }
            if (!data.approved) {
              setMsg({ text: "Votre compte est en attente d'approbation.", type: "warn" });
              setChecking(false);
              return;
            }
            const route = ROLE_ROUTES[data.role];
            if (route) { nav(route); return; }
          }
        } catch (err) {
          console.error("Auth check error:", err);
        }
      }
      setChecking(false);
    });
    return () => unsub();
  }, [nav]);

  // ── Password strength ──────────────────────────────────────
  useEffect(() => { setStrength(calcStrength(pass)); }, [pass]);

  // ── reCAPTCHA v2 checkbox — loaded once, gracefully skipped if the
  // site key hasn't been configured yet ───────────────────────
  useEffect(() => {
    if (!RECAPTCHA_V2_SITE_KEY || RECAPTCHA_V2_SITE_KEY === "REPLACE_WITH_YOUR_RECAPTCHA_V2_SITE_KEY") {
      console.warn("reCAPTCHA v2 is not configured — RECAPTCHA_V2_SITE_KEY in Login.jsx is still a placeholder.");
      return;
    }

    const renderWidget = () => {
      if (!window.grecaptcha || !recaptchaContainerRef.current || recaptchaWidgetId.current !== null) return;
      try {
        recaptchaWidgetId.current = window.grecaptcha.render(recaptchaContainerRef.current, {
          sitekey: RECAPTCHA_V2_SITE_KEY,
          callback: (token) => setRecaptchaToken(token),
          "expired-callback": () => setRecaptchaToken(null),
          "error-callback": () => setRecaptchaToken(null),
        });
        setRecaptchaReady(true);
      } catch (e) {
        console.warn("Could not render reCAPTCHA widget (non-fatal):", e.message);
      }
    };

    if (window.grecaptcha && window.grecaptcha.render) {
      renderWidget();
      return;
    }

    // Script not loaded yet — inject it once, and let its global
    // onRecaptchaLoad callback (registered via the `onload` query param)
    // trigger rendering when ready.
    if (!document.getElementById("recaptcha-v2-script")) {
      window.onRecaptchaLoad = renderWidget;
      const script = document.createElement("script");
      script.id = "recaptcha-v2-script";
      script.src = "https://www.google.com/recaptcha/api.js?onload=onRecaptchaLoad&render=explicit";
      script.async = true;
      script.defer = true;
      script.onerror = () => {
        console.error(
          "reCAPTCHA script failed to load — check network connectivity, an ad-blocker/privacy " +
          "extension blocking google.com/recaptcha, or a Content-Security-Policy blocking the request."
        );
      };
      document.body.appendChild(script);
    }
  }, []);

  // ── Second, independent reCAPTCHA widget for the forgot-password
  // form. Deliberately separate from the login one above — that form's
  // container unmounts whenever forgotPasswordMode is false, so trying
  // to reuse the same widget instance across both would orphan it the
  // first time someone switches between the two forms. reCAPTCHA v2
  // supports multiple independent widget instances on one page just
  // fine, so this renders its own into its own container the first
  // time this mode is actually opened, rather than on initial mount
  // (its container doesn't exist until then).
  useEffect(() => {
    if (!forgotPasswordMode) return;
    if (!RECAPTCHA_V2_SITE_KEY || RECAPTCHA_V2_SITE_KEY === "REPLACE_WITH_YOUR_RECAPTCHA_V2_SITE_KEY") return;
    if (forgotRecaptchaWidgetId.current !== null) return; // already rendered once

    const renderForgotWidget = () => {
      if (!window.grecaptcha || !window.grecaptcha.render || !forgotRecaptchaContainerRef.current) return;
      try {
        forgotRecaptchaWidgetId.current = window.grecaptcha.render(forgotRecaptchaContainerRef.current, {
          sitekey: RECAPTCHA_V2_SITE_KEY,
          callback: (token) => setForgotRecaptchaToken(token),
          "expired-callback": () => setForgotRecaptchaToken(null),
          "error-callback": () => setForgotRecaptchaToken(null),
        });
        setForgotRecaptchaReady(true);
      } catch (e) {
        console.warn("Could not render forgot-password reCAPTCHA widget (non-fatal):", e.message);
      }
    };

    if (window.grecaptcha && window.grecaptcha.render) {
      renderForgotWidget();
    } else {
      // The main script load (triggered by the login form's own effect)
      // may still be in flight — poll briefly rather than duplicating
      // the whole script-injection logic here.
      const interval = setInterval(() => {
        if (window.grecaptcha && window.grecaptcha.render) {
          clearInterval(interval);
          renderForgotWidget();
        }
      }, 300);
      return () => clearInterval(interval);
    }
  }, [forgotPasswordMode]);

  // ── Login handler ──────────────────────────────────────────
  const login = async () => {
    // Throttle: don't allow submits faster than THROTTLE_DELAY_MS
    const now = Date.now();
    if (now - lastSubmit.current < THROTTLE_DELAY_MS) return;
    lastSubmit.current = now;

    // Lockout check — only blocks if the lock we're currently showing
    // actually belongs to the email in the field right now. If they've
    // typed a different email since the lock was set, that's a different
    // account and shouldn't be blocked by someone else's lockout.
    if (lockUntil && lockUntil > Date.now() && lockedEmail === email.trim().toLowerCase()) return;

    if (!email.trim() || !pass) {
      setMsg({ text: "Veuillez remplir tous les champs.", type: "danger" });
      return;
    }
    // Basic email format check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setMsg({ text: "Format d'email invalide.", type: "danger" });
      return;
    }

    // reCAPTCHA — only enforced if the widget actually rendered (i.e.
    // it's genuinely configured). Verified server-side, not just
    // "a token exists" — a token by itself proves nothing without
    // Google confirming it's real.
    if (recaptchaReady) {
      if (!recaptchaToken) {
        setMsg({ text: "Veuillez confirmer que vous n'êtes pas un robot.", type: "danger" });
        return;
      }
      setLoading(true);
      try {
        const verifyCall = httpsCallable(functions, "verifyRecaptcha");
        await verifyCall({ token: recaptchaToken });
      } catch (e) {
        setMsg({ text: "Vérification anti-robot échouée. Veuillez réessayer.", type: "danger" });
        if (window.grecaptcha && recaptchaWidgetId.current !== null) {
          window.grecaptcha.reset(recaptchaWidgetId.current);
        }
        setRecaptchaToken(null);
        setLoading(false);
        return;
      }
    }

    setLoading(true);
    setMsg(null);

    // Server-side account lock check — this is what makes the lockout
    // follow the ACCOUNT rather than the browser: it's keyed by email in
    // Firestore, checked fresh on every submit, regardless of which
    // device or browser is asking.
    try {
      const checkCall = httpsCallable(functions, "checkLoginLock");
      const checkResult = await checkCall({ email: email.trim() });
      if (checkResult.data.locked) {
        const until = new Date(checkResult.data.lockedUntil).getTime();
        setLockUntil(until);
        setLockedEmail(email.trim().toLowerCase());
        setAttempts(MAX_ATTEMPTS);
        setMsg({ text: "Trop de tentatives échouées. Compte temporairement bloqué.", type: "danger" });
        setLoading(false);
        return;
      }
    } catch (e) {
      // If the lock-check itself fails (e.g. network hiccup), don't block
      // login entirely over it — just proceed and let Firebase Auth's own
      // response drive what happens next.
      console.warn("Could not check account lock status (non-fatal):", e.message);
    }

    try {
      await setPersistence(auth, browserLocalPersistence);
      const result = await signInWithEmailAndPassword(auth, email.trim(), pass);
      await completeLogin(result.user);
    } catch (e) {
      console.error("Login error:", e);

      // MFA challenge is not a failed login — the password was correct,
      // there's just one more step. Don't record it as a failed attempt
      // or show a "wrong password" message.
      if (e.code === "auth/multi-factor-auth-required") {
        setMfaResolver(getMultiFactorResolver(auth, e));
        setLoading(false);
        return;
      }

      // Record the failure server-side — this is the account-level
      // counter, not a client-side guess, so it's authoritative even if
      // this exact browser has never seen this account before.
      try {
        const recordCall = httpsCallable(functions, "recordFailedLogin");
        const recordResult = await recordCall({ email: email.trim() });
        const newAttempts = recordResult.data.attempts;
        setAttempts(newAttempts);

        if (recordResult.data.locked) {
          const until = new Date(recordResult.data.lockedUntil).getTime();
          setLockUntil(until);
          setLockedEmail(email.trim().toLowerCase());
          setMsg({ text: "Trop de tentatives échouées. Compte temporairement bloqué.", type: "danger" });
        } else {
          const remaining = MAX_ATTEMPTS - newAttempts;
          if (e.code === "auth/user-not-found" || e.code === "auth/wrong-password" || e.code === "auth/invalid-credential") {
            setMsg({ text: `Email ou mot de passe incorrect. ${remaining} tentative${remaining > 1 ? "s" : ""} restante${remaining > 1 ? "s" : ""}.`, type: "danger" });
          } else if (e.code === "auth/too-many-requests") {
            setMsg({ text: "Trop de tentatives. Réessayez dans quelques minutes.", type: "danger" });
          } else if (e.code === "auth/network-request-failed") {
            setMsg({ text: "Erreur réseau. Vérifiez votre connexion internet.", type: "danger" });
          } else {
            setMsg({ text: "Erreur d'authentification. Réessayez.", type: "danger" });
          }
        }
      } catch (recordErr) {
        // Even if recording the failure server-side fails, still show
        // the user SOME error rather than silently doing nothing.
        console.error("Could not record failed login:", recordErr.message);
        if (e.code === "auth/user-not-found" || e.code === "auth/wrong-password" || e.code === "auth/invalid-credential") {
          setMsg({ text: "Email ou mot de passe incorrect.", type: "danger" });
        } else {
          setMsg({ text: "Erreur d'authentification. Réessayez.", type: "danger" });
        }
      }
      // reCAPTCHA v2 tokens are single-use — reset the checkbox so the
      // next attempt requires checking it again.
      if (window.grecaptcha && recaptchaWidgetId.current !== null) {
        window.grecaptcha.reset(recaptchaWidgetId.current);
      }
      setRecaptchaToken(null);
      setLoading(false);
    }
  };

  // Shared by both the normal sign-in path and the MFA-resolved path
  // below — everything that happens once Firebase Auth itself is
  // satisfied, regardless of whether a second factor was involved.
  const completeLogin = async (firebaseUser) => {
    const snap = await getDoc(doc(db, "users", firebaseUser.uid));

    if (!snap.exists()) {
      setMsg({ text: "Données utilisateur introuvables.", type: "danger" });
      await auth.signOut();
      setLoading(false);
      return;
    }

    const data = snap.data();

    if (data.disabled) {
      setMsg({ text: "Votre compte a été désactivé. Contactez l'administrateur.", type: "danger" });
      await auth.signOut();
      setLoading(false);
      return;
    }
    if (!data.approved) {
      setMsg({ text: "Votre compte est en attente d'approbation.", type: "warn" });
      await auth.signOut();
      setLoading(false);
      return;
    }

    const route = ROLE_ROUTES[data.role];
    if (route) {
      // Success — clear the server-side lock record for this account
      // and navigate. Session-idle handling from here on is entirely
      // owned by <SessionGuard>.
      try {
        const clearCall = httpsCallable(functions, "clearLoginAttempts");
        await clearCall({ email: email.trim() });
      } catch (e) {
        console.warn("Could not clear login attempts (non-fatal):", e.message);
      }
      setAttempts(0);
      setMfaResolver(null);
      nav(route);
    } else {
      setMsg({ text: "Rôle utilisateur invalide. Contactez l'administrateur.", type: "danger" });
      await auth.signOut();
      setLoading(false);
    }
  };

  // ── MFA challenge handler ──────────────────────────────────
  const submitMfaCode = async () => {
    if (!mfaResolver || mfaCode.length !== 6) return;
    setSubmittingMfa(true);
    setMfaError("");
    try {
      const hint = mfaResolver.hints[0];
      const assertion = TotpMultiFactorGenerator.assertionForSignIn(hint.uid, mfaCode.trim());
      const userCredential = await mfaResolver.resolveSignIn(assertion);
      await completeLogin(userCredential.user);
    } catch (e) {
      setMfaError(e.code === "auth/invalid-verification-code" ? "Code invalide, réessayez." : e.message);
    }
    setSubmittingMfa(false);
  };

  // ── Forgot password ─────────────────────────────────────────
  const submitForgotPassword = async () => {
    if (!forgotEmail.trim()) {
      setForgotMsg("Veuillez entrer votre adresse email.");
      return;
    }
    if (forgotRecaptchaReady && !forgotRecaptchaToken) {
      setForgotMsg("Veuillez confirmer que vous n'êtes pas un robot.");
      return;
    }
    setForgotSubmitting(true);
    setForgotMsg("");
    try {
      const call = httpsCallable(functions, "requestPasswordReset");
      const result = await call({ email: forgotEmail.trim(), recaptchaToken: forgotRecaptchaToken });
      setForgotMsg(result.data.message);
    } catch (e) {
      // Rate-limit and validation errors are safe to show directly —
      // they don't leak whether an account exists, unlike the main
      // response (which is deliberately generic regardless of outcome).
      setForgotMsg(e.message || "Une erreur est survenue. Réessayez.");
    }
    if (window.grecaptcha && forgotRecaptchaWidgetId.current !== null) {
      window.grecaptcha.reset(forgotRecaptchaWidgetId.current);
    }
    setForgotRecaptchaToken(null);
    setForgotSubmitting(false);
  };

  const isLocked  = lockUntil > Date.now() && countdown > 0 && lockedEmail === email.trim().toLowerCase();
  const canSubmit = !loading && !isLocked && email && pass && (!recaptchaReady || !!recaptchaToken);

  // ── Lockout countdown display ─────────────────────────────
  const mins = String(Math.floor(countdown / 60)).padStart(2, "0");
  const secs = String(countdown % 60).padStart(2, "0");

  // ── Full-screen loading ───────────────────────────────────
  if (checking) {
    return (
      <div className="sh-fullscreen">
        <GlobalStyle />
        <div className="sh-fullscreen-spinner" />
        <p>Vérification de la session…</p>
      </div>
    );
  }

  return (
    <>
      <GlobalStyle />

      <div className="sh-root">
        <div className="sh-ambient sh-ambient-a" />
        <div className="sh-ambient sh-ambient-b" />

        <BogolanPattern id="pat-bg" colorA={C.gold} colorB={C.clay} opacity={0.025} />

        <div className="sh-card">

          {/* ── Brand panel ─────────────────────────────────── */}
          <div className="sh-brand">
            <div className="sh-flag-stripe" />
            <div className="sh-brand-top-line" />
            <BogolanPattern id="pat-brand" colorA={C.goldSoft} colorB={C.clay} opacity={0.09} />

            <div style={{ position: "relative" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 28 }}>
                <svg width="28" height="19" viewBox="0 0 30 20" style={{ borderRadius: 2, boxShadow: "0 2px 8px rgba(0,0,0,0.5)", flexShrink: 0 }}>
                  <rect x="0"  y="0" width="10" height="20" fill={C.green} />
                  <rect x="10" y="0" width="10" height="20" fill={C.gold}  />
                  <rect x="20" y="0" width="10" height="20" fill={C.clay}  />
                </svg>
                <div>
                  <p style={{ margin: 0, fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase", color: C.goldSoft, fontWeight: 700, lineHeight: 1.4 }}>République du Mali</p>
                  <p style={{ margin: 0, fontSize: 9.5, letterSpacing: "0.08em", color: "rgba(233,199,125,0.4)", fontStyle: "italic", lineHeight: 1.6 }}>Un Peuple – Un But – Une Foi</p>
                </div>
              </div>

              <div className="sh-brand-emblem">
                <img src="/Mali.jpg" alt="Emblème du Mali" />
              </div>

              <h1>Système Hospitalier</h1>
              <div className="sh-brand-rule" />
              <p>Connectez-vous pour accéder au dossier patient et aux outils de service.</p>

              <div className="sh-brand-badge">
                <ShieldIcon />
                Accès sécurisé
              </div>
            </div>

            <div style={{ position: "relative", fontSize: 12, color: "rgba(167,156,136,0.5)", lineHeight: 1.7 }}>
              <p style={{ margin: 0 }}>© 2026 – Système Hospitalier du Mali</p>
            </div>
          </div>

          {/* ── Form panel ──────────────────────────────────── */}
          <div className="sh-form-panel">

            {mfaResolver ? (
              <>
                <h2 className="sh-form-title">Double authentification</h2>
                <p className="sh-form-sub">Entrez le code à 6 chiffres généré par votre application d'authentification.</p>

                {mfaError && (
                  <div style={{ padding: "10px 14px", marginBottom: 14, borderRadius: 6, backgroundColor: "rgba(206,17,38,0.12)", color: "#f4a89a", fontSize: 13 }}>
                    {mfaError}
                  </div>
                )}

                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="123456"
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  onKeyDown={(e) => e.key === "Enter" && submitMfaCode()}
                  autoFocus
                  style={{
                    width: "100%", padding: "12px 14px", borderRadius: 8, fontSize: 22, letterSpacing: "6px",
                    textAlign: "center", boxSizing: "border-box", marginBottom: 16, fontFamily: "monospace",
                    border: "1.5px solid rgba(216,201,168,0.28)", backgroundColor: "rgba(255,255,255,0.06)", color: "#F6EEDD",
                  }}
                />

                <button
                  onClick={submitMfaCode}
                  disabled={submittingMfa || mfaCode.length !== 6}
                  className="sh-btn-primary"
                  style={{ opacity: (submittingMfa || mfaCode.length !== 6) ? 0.6 : 1 }}
                >
                  {submittingMfa ? "Vérification…" : "Vérifier"}
                </button>
                <button
                  onClick={() => { setMfaResolver(null); setMfaCode(""); setMfaError(""); }}
                  style={{ marginTop: 12, background: "none", border: "none", color: "rgba(246,238,221,0.6)", fontSize: 13, cursor: "pointer", textDecoration: "underline" }}
                >
                  Retour à la connexion
                </button>
              </>
            ) : forgotPasswordMode ? (
              <>
                <h2 className="sh-form-title">Mot de passe oublié</h2>
                <p className="sh-form-sub">Entrez votre adresse email — si un compte existe et que l'email est vérifié, vous recevrez un lien de réinitialisation.</p>

                {forgotMsg && (
                  <div style={{ padding: "10px 14px", marginBottom: 14, borderRadius: 6, backgroundColor: "rgba(216,201,168,0.1)", color: "#F6EEDD", fontSize: 13, lineHeight: 1.5 }}>
                    {forgotMsg}
                  </div>
                )}

                <input
                  type="email"
                  placeholder="Adresse email"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submitForgotPassword()}
                  autoFocus
                  style={{
                    width: "100%", padding: "12px 14px", borderRadius: 8, fontSize: 15,
                    boxSizing: "border-box", marginBottom: 16,
                    border: "1.5px solid rgba(216,201,168,0.28)", backgroundColor: "rgba(255,255,255,0.06)", color: "#F6EEDD",
                  }}
                />

                <div style={{ display: "flex", justifyContent: "center", marginBottom: forgotRecaptchaReady ? 18 : 0 }}>
                  <div ref={forgotRecaptchaContainerRef} />
                </div>

                <button
                  onClick={submitForgotPassword}
                  disabled={forgotSubmitting}
                  className="sh-btn-primary"
                  style={{ opacity: forgotSubmitting ? 0.6 : 1 }}
                >
                  {forgotSubmitting ? "Envoi…" : "Envoyer le lien"}
                </button>
                <button
                  onClick={() => { setForgotPasswordMode(false); setForgotEmail(""); setForgotMsg(""); }}
                  style={{ marginTop: 12, background: "none", border: "none", color: "rgba(246,238,221,0.6)", fontSize: 13, cursor: "pointer", textDecoration: "underline" }}
                >
                  Retour à la connexion
                </button>
              </>
            ) : (
            <>
            <h2 className="sh-form-title">Connexion</h2>
            <p className="sh-form-sub">Entrez vos identifiants pour accéder à votre espace.</p>

            <AttemptDots used={attempts} max={MAX_ATTEMPTS} />

            {/* Honeypot (hidden from real users, catches bots) */}
            <input
              type="text"
              name="username"
              autoComplete="off"
              tabIndex={-1}
              aria-hidden="true"
              style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
            />

            <div>
              <label className="sh-label" htmlFor="sh-email">Adresse email</label>
              <div className="sh-input-wrap">
                <span className="sh-input-icon"><MailIcon /></span>
                <input
                  id="sh-email"
                  className={`sh-input${msg?.type === "danger" && !pass ? " sh-input-error" : ""}`}
                  type="email"
                  placeholder="prenom.nom@hopital.ml"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setMsg(null); }}
                  onKeyDown={e => e.key === "Enter" && login()}
                  disabled={loading || isLocked}
                  autoComplete="email"
                  spellCheck={false}
                />
              </div>
            </div>

            <div>
              <label className="sh-label" htmlFor="sh-pass">Mot de passe</label>
              <div className="sh-input-wrap">
                <span className="sh-input-icon"><LockIcon /></span>
                <input
                  id="sh-pass"
                  className="sh-input sh-input-has-toggle"
                  type={showPass ? "text" : "password"}
                  placeholder="••••••••••"
                  value={pass}
                  onChange={e => { setPass(e.target.value); setMsg(null); }}
                  onKeyDown={e => e.key === "Enter" && login()}
                  disabled={loading || isLocked}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="sh-pw-toggle"
                  onClick={() => setShowPass(v => !v)}
                  aria-label={showPass ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                  tabIndex={0}
                >
                  <EyeIcon open={showPass} />
                </button>
              </div>

              {pass.length > 0 && (
                <>
                  <div className="sh-strength-bar">
                    {[1,2,3,4].map(i => (
                      <div
                        key={i}
                        className="sh-strength-seg"
                        style={{ background: i <= strength ? STRENGTH_COLORS[strength] : undefined }}
                      />
                    ))}
                  </div>
                  <p style={{ margin: "0 0 10px", fontSize: 11, color: STRENGTH_COLORS[strength] || "rgba(216,201,168,0.3)", fontWeight: 600, letterSpacing: "0.06em" }}>
                    {STRENGTH_LABELS[strength]}
                  </p>
                </>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "center", marginBottom: recaptchaReady ? 18 : 0 }}>
              <div ref={recaptchaContainerRef} />
            </div>

            <button
              className="sh-btn-primary"
              onClick={login}
              disabled={!canSubmit}
            >
              {loading ? (
                <><span className="sh-spinner" />Connexion…</>
              ) : (
                "Se connecter"
              )}
            </button>

            <button
              onClick={() => { setForgotPasswordMode(true); setForgotEmail(email); setForgotMsg(""); }}
              style={{ marginTop: 14, background: "none", border: "none", color: "rgba(246,238,221,0.6)", fontSize: 13, cursor: "pointer", textDecoration: "underline", display: "block", textAlign: "center", width: "100%" }}
            >
              Mot de passe oublié ?
            </button>

            {isLocked && (
              <div className="sh-lockout">
                <div className="sh-lockout-clock">{mins}:{secs}</div>
                <div className="sh-lockout-text">
                  Compte temporairement bloqué<br />
                  après {MAX_ATTEMPTS} tentatives échouées.
                </div>
              </div>
            )}

            {msg && !isLocked && (
              <div className={`sh-alert sh-alert-${msg.type}`}>
                <AlertIcon type={msg.type} />
                <span>{msg.text}</span>
              </div>
            )}

            <div className="sh-divider">
              <div className="sh-divider-line" />
              <div className="sh-divider-dot" />
              <div className="sh-divider-line" />
            </div>

            <button
              className="sh-btn-secondary"
              onClick={() => nav("/signup")}
              disabled={loading}
            >
              Configuration initiale du système
            </button>

            <div className="sh-version">
              <span>v2.0</span>
              <div className="sh-version-dot" />
              <span>Mali</span>
              <div className="sh-version-dot" />
              <span>Connexion chiffrée TLS</span>
            </div>
            </>
            )}
          </div>

        </div>
      </div>
    </>
  );
}