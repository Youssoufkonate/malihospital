import { Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { auth, db } from "../firebase";
import { doc, getDoc } from "firebase/firestore";

export default function ProtectedRoute({ children, role }) {
  const [allowed, setAllowed] = useState(null);

  useEffect(() => {
    const check = async () => {
      const user = auth.currentUser;
      if (!user) return setAllowed(false);

      const snap = await getDoc(doc(db, "users", user.uid));
      if (!snap.exists()) return setAllowed(false);

      const userRole = snap.data().role;
      setAllowed(userRole === role);
    };
    check();
  }, [role]);

  if (allowed === null) return <p>Loading...</p>;
  return allowed ? children : <Navigate to="/" />;
}
