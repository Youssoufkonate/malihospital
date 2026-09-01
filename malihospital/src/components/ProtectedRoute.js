import { Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { auth, db } from "../firebase";
import { doc, getDoc } from "firebase/firestore";

/**
 * Usage: <ProtectedRoute roles={["hospitaladmin"]}><AdminPanel /></ProtectedRoute>
 * `roles` can be a single string or an array of allowed roles.
 */
export default function ProtectedRoute({ children, roles }) {
  const [status, setStatus] = useState("checking"); // checking | allowed | denied

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (!user) {
        setStatus("denied");
        return;
      }
      try {
	await user.getIdToken(true);
        const snap = await getDoc(doc(db, "users", user.uid));
        if (!snap.exists()) return setStatus("denied");

        const data = snap.data();
        if (data.disabled) return setStatus("denied");
        if (!data.approved) return setStatus("denied");

        const allowedRoles = Array.isArray(roles) ? roles : [roles];
        setStatus(allowedRoles.includes(data.role) ? "allowed" : "denied");
      } catch (e) {
        console.error("ProtectedRoute check failed:", e);
        setStatus("denied");
      }
    });
    return () => unsubscribe();
  }, [roles]);

  if (status === "checking") {
    return <p style={{ padding: 30, fontFamily: "sans-serif" }}>Chargement...</p>;
  }
  return status === "allowed" ? children : <Navigate to="/" replace />;
}