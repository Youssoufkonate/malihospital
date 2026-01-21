import { initializeApp } from "firebase/app";
import { getAuth, setPersistence, browserLocalPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCcpJuBrF8PMOnqSAe4r-ENfjseA10LRok",
  authDomain: "hospital-mali.firebaseapp.com",
  projectId: "hospital-mali",
  storageBucket: "hospital-mali.appspot.com",
  messagingSenderId: "195459769660",
  appId: "1:195459769660:web:c04660b7eaaf2ed29d2a39"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Set persistence to LOCAL so user stays logged in after refresh
setPersistence(auth, browserLocalPersistence)
  .then(() => {
    console.log("✅ Auth persistence set to LOCAL");
  })
  .catch((error) => {
    console.error("❌ Error setting persistence:", error);
  });