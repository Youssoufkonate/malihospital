import { initializeApp } from "firebase/app";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

const firebaseConfig = {
  apiKey: "AIzaSyCcpJuBrF8PMOnqSAe4r-ENfjseA10LRok",
  authDomain: "hospital-mali.firebaseapp.com",
  projectId: "hospital-mali",
  storageBucket: "hospital-mali.appspot.com",
  messagingSenderId: "195459769660",
  appId: "1:195459769660:web:c04660b7eaaf2ed29d2a39",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app);

const RECAPTCHA_SITE_KEY = "6LcgCYwtAAAAAK2wgW3OI9IOSSprTjSgL0FAjQnB";

if (RECAPTCHA_SITE_KEY && RECAPTCHA_SITE_KEY !== "REPLACE_WITH_YOUR_RECAPTCHA_V3_SITE_KEY") {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (error) {
    console.warn("App Check could not initialize (non-fatal):", error);
  }
} else {
  console.warn(
    "App Check is not configured -- RECAPTCHA_SITE_KEY in firebase.js is still a placeholder."
  );
}

setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.error("Error setting persistence:", error);
});