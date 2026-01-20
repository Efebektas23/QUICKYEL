import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";

// QuickYeliz Firebase Config (Isolated Environment)
const firebaseConfig = {
  apiKey: "AIzaSyCidEL1zxiLle4ii68-MVrOqzRSLWZnD9o",
  authDomain: "quickyeliz.firebaseapp.com",
  projectId: "quickyeliz",
  storageBucket: "quickyeliz.firebasestorage.app",
  messagingSenderId: "209242730202",
  appId: "1:209242730202:web:f202b0d6263537f22fffe3",
  measurementId: "G-G286WF9ZT1"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize services
export const db = getFirestore(app);
export const storage = getStorage(app);
export const auth = getAuth(app);

// Auto-login with dedicated user
let isAuthenticated = false;

export const ensureAuth = async (): Promise<void> => {
  if (isAuthenticated) return;
  
  try {
    await signInWithEmailAndPassword(
      auth,
      "yeliz.bektas@backtas.com",
      "OYep-22242301."
    );
    isAuthenticated = true;
    console.log("✅ Firebase authenticated with UID:", auth.currentUser?.uid);
  } catch (error: any) {
    console.error("❌ Firebase auth error:", error.message);
    throw error;
  }
};

export default app;
