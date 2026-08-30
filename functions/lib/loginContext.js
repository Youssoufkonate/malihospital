const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getCallerProfile } = require("./helpers");

/**
 * Records the IP address and approximate city/country for a session,
 * called once right after that session's document is first created
 * (see SessionGuard.jsx) — not on every heartbeat, since "where did this
 * device first connect from" is the meaningful moment to capture, not
 * something that needs re-checking every few minutes.
 *
 * Has to be a Cloud Function rather than a client-side write: a browser
 * has no API to see its own public IP address at all — only the server
 * receiving the request can see it, via request headers.
 *
 * Location is approximate (city/country from IP geolocation), NOT GPS —
 * deliberately so. GPS-precise location would require an explicit
 * browser permission prompt per device, and tracking exact staff
 * locations is a different, more invasive thing than "which city did
 * this login come from," which is what's actually useful here.
 *
 * Uses ipapi.co's free tier (1,000 lookups/day, HTTPS). If usage ever
 * exceeds that, this is the one place to swap in a different provider —
 * everything downstream just reads city/country/ipAddress off the
 * session document, agnostic to which service produced them.
 */
exports.recordLoginContext = onCall(async (request) => {
  await getCallerProfile(request); // just confirms the caller is a real, known user

  const { sessionId } = request.data || {};
  if (!sessionId) {
    throw new HttpsError("invalid-argument", "sessionId manquant.");
  }

  // x-forwarded-for is what Cloud Run populates with the real client IP
  // (can be a comma-separated chain if proxied further upstream — the
  // first entry is the original client, later ones are intermediate
  // proxies). Falls back to the raw connection IP if that header is
  // somehow absent.
  const rawReq = request.rawRequest;
  const forwardedFor = rawReq.headers["x-forwarded-for"];
  const ip = forwardedFor ? forwardedFor.split(",")[0].trim() : (rawReq.ip || null);

  let city = null;
  let country = null;
  if (ip) {
    try {
      const response = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`);
      const data = await response.json();
      if (!data.error) {
        city = data.city || null;
        country = data.country_name || null;
      } else {
        console.warn("ipapi.co returned an error for this IP:", data.reason || data.error);
      }
    } catch (e) {
      // Never let a geolocation lookup failure block the login flow —
      // the session already exists and works fine without this.
      console.warn("IP geolocation lookup failed (non-fatal):", e.message);
    }
  }

  await admin.firestore().collection("sessions").doc(sessionId).set(
    { ipAddress: ip, city, country },
    { merge: true }
  );

  return { ip, city, country };
});