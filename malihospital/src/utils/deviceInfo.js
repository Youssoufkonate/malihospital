// A readable "Windows — Chrome" / "Android" style label from the
// browser's own user agent string. This is intentionally simple — not a
// fingerprinting library, not meant to be a stable device identifier
// (see the device-registration trade-off discussed separately). It's
// just enough for a human looking at "Sessions actives" to recognize
// which entry is their phone vs their work computer.
export function getDeviceLabel() {
  const ua = navigator.userAgent || "";

  let os = "Appareil inconnu";
  if (/windows/i.test(ua)) os = "Windows";
  else if (/android/i.test(ua)) os = "Android";
  else if (/iphone|ipad|ipod/i.test(ua)) os = "iOS";
  else if (/mac os/i.test(ua)) os = "Mac";
  else if (/linux/i.test(ua)) os = "Linux";

  let browser = "";
  if (/edg\//i.test(ua)) browser = "Edge";
  else if (/chrome\//i.test(ua) && !/edg\//i.test(ua)) browser = "Chrome";
  else if (/firefox\//i.test(ua)) browser = "Firefox";
  else if (/safari\//i.test(ua) && !/chrome\//i.test(ua)) browser = "Safari";

  if (os === "Android" || os === "iOS") {
    // Mobile: the OS itself is usually the meaningful distinction, the
    // browser is often just whatever's default.
    return os;
  }
  return browser ? `${os} — ${browser}` : os;
}

// A random ID for THIS particular browser tab/window's login — not a
// persistent device identifier (see the trade-off note elsewhere: a
// stable, tamper-proof device ID isn't something a browser can really
// provide). Stored in sessionStorage deliberately, not localStorage: it
// should represent one continuous login, and should NOT survive the
// browser being fully closed and reopened as if it were still the same
// session — a fresh browser launch reasonably creates a fresh session
// entry.
const SESSION_ID_KEY = "sh_session_id";
export function getOrCreateSessionId() {
  try {
    let id = sessionStorage.getItem(SESSION_ID_KEY);
    if (!id) {
      id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem(SESSION_ID_KEY, id);
    }
    return id;
  } catch {
    // sessionStorage unavailable (rare) — fall back to a fresh ID every
    // time; session tracking degrades gracefully rather than breaking.
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
export function clearSessionId() {
  try { sessionStorage.removeItem(SESSION_ID_KEY); } catch {}
}

// A persistent ID for THIS browser install, backing device registration
// — deliberately in localStorage (unlike the session ID above), since it
// needs to survive closing and reopening the browser entirely; it's
// meant to represent "this physical computer/browser," not one login.
//
// Worth being honest about the real limitation here: this is NOT a
// tamper-proof hardware identifier — nothing in a browser can provide
// that. Clearing browser data, using a different browser on the same
// computer, or private/incognito mode will all look like "a new device"
// to this mechanism. It's a reasonable, standard-practice deterrent
// against casual account sharing or a lost/stolen laptop being used
// freely, not a defense against someone deliberately trying to evade it.
const DEVICE_ID_KEY = "sh_device_id";
export function getOrCreateDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = `dev-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return `dev-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  }
}