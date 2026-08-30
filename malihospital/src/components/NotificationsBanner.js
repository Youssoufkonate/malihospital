import { useState, useEffect } from "react";
import { db, auth } from "../firebase";
import { collection, query, where, orderBy, limit, onSnapshot } from "firebase/firestore";

const SEVERITY_STYLE = {
  info:    { bg: "#E8F0FB", text: "#2E5C8C", border: "#2E5C8C", icon: "ℹ️" },
  warning: { bg: "#FDF3E3", text: "#8A5A00", border: "#8A5A00", icon: "⚠️" },
  urgent:  { bg: "#FBEAEC", text: "#A31221", border: "#A31221", icon: "🚨" },
};

// Shows recent in-app broadcasts (from the broadcastNotification Cloud
// Function) at the top of a dashboard. hospitalId scopes which broadcasts
// are visible — pass the current user's own hospitalId; broadcasts with a
// null hospitalId (super-admin, hospital-wide) show to everyone regardless.
// department further narrows "mine": if a notification has a department
// set (a supervisor's department-only announcement), only staff in that
// same department see it — pass the current user's own department, or
// leave it undefined for roles that don't have one (accueil, pharmacy,
// lab, hospitaladmin), which just means they only ever see hospital-wide
// (department == null) notifications, never a department-scoped one.
// targetUserId further narrows to ONE specific person (e.g. a supervisor's
// personal "your schedule changed" notice) — if a notification has that
// field set, it's checked against the CURRENT signed-in user, not just
// hospital/department membership, so it never leaks to anyone else.
// Dismissal is per-session only (component state) — there's no per-user
// read-tracking, matching the "no extra cost/setup" in-app-only scope.
export default function NotificationsBanner({ hospitalId, department }) {
  const [notifications, setNotifications] = useState([]);
  const [dismissed, setDismissed] = useState([]);

  useEffect(() => {
    if (!auth.currentUser) return;
    // Firestore can't do "hospitalId == X OR hospitalId == null" (or the
    // department OR) in one query, so run both and merge/filter client-
    // side — cheap since each is capped at 5.
    const qMine = hospitalId
      ? query(collection(db, "notifications"), where("hospitalId", "==", hospitalId), orderBy("createdAt", "desc"), limit(10))
      : null;
    const qGlobal = query(collection(db, "notifications"), where("hospitalId", "==", null), orderBy("createdAt", "desc"), limit(5));

    let mine = [];
    let global = [];
    // A personal (targetUserId-scoped) notification must be filtered
    // wherever it might appear — and for facility staff (no hospitalId at
    // all), it lands in the GLOBAL query results, not "mine", since it was
    // written with hospitalId: null. Applying this filter to only one of
    // the two arrays is exactly what let a personal notice reach everyone.
    const filterMine = (list) => list.filter((n) => {
      if (n.targetUserId) return n.targetUserId === auth.currentUser.uid;
      return !n.department || n.department === department;
    });
    const filterGlobal = (list) => list.filter((n) => {
      if (n.targetUserId) return n.targetUserId === auth.currentUser.uid;
      return true;
    });
    const merge = () => {
      const all = [...filterMine(mine), ...filterGlobal(global)]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 5);
      setNotifications(all);
    };

    const unsubs = [];
    if (qMine) {
      unsubs.push(onSnapshot(qMine, (snap) => {
        mine = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        merge();
      }, (e) => console.error("Error loading notifications:", e)));
    }
    unsubs.push(onSnapshot(qGlobal, (snap) => {
      global = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      merge();
    }, (e) => console.error("Error loading global notifications:", e)));

    return () => unsubs.forEach((u) => u());
  }, [hospitalId, department]);

  const visible = notifications.filter((n) => !dismissed.includes(n.id));
  if (visible.length === 0) return null;

  return (
    <div style={{ display: "grid", gap: 8, marginBottom: 20 }}>
      {visible.map((n) => {
        const s = SEVERITY_STYLE[n.severity] || SEVERITY_STYLE.info;
        return (
          <div key={n.id} style={{
            display: "flex", alignItems: "flex-start", gap: 12,
            padding: "12px 16px", borderRadius: 8,
            backgroundColor: s.bg, border: `1px solid ${s.border}`,
          }}>
            <span style={{ fontSize: 16 }}>{s.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: s.text }}>{n.title}</div>
              <div style={{ fontSize: 13.5, color: s.text, marginTop: 2, lineHeight: 1.5 }}>{n.message}</div>
              <div style={{ fontSize: 11.5, color: s.text, opacity: 0.7, marginTop: 4 }}>
                {n.createdByName} · {n.createdAt ? new Date(n.createdAt).toLocaleString("fr-FR") : ""}
              </div>
            </div>
            <button
              onClick={() => setDismissed((d) => [...d, n.id])}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: s.text, opacity: 0.6, lineHeight: 1 }}
              aria-label="Fermer"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}