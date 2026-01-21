import { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, query, orderBy, limit, onSnapshot } from "firebase/firestore";

export default function Display() {
  const [ticket, setTicket] = useState("");

  useEffect(() => {
    const q = query(collection(db, "calls"), orderBy("time", "desc"), limit(1));

    const unsub = onSnapshot(q, snap => {
      if (!snap.empty) {
        setTicket(snap.docs[0].data().number);
        new Audio("/beep.mp3").play();
      }
    });

    return () => unsub();
  }, []);

  return (
    <div className="screen display">
      <h1>📺 Salle d’Attente – Hôpital du Mali</h1>
      <div className="big-ticket">{ticket}</div>
    </div>
  );
}
