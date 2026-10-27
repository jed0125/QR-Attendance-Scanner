import { initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyBdK6n6yynZ_d1hx_O8mE1TYYNAHs4u8Ao",
  authDomain: "school-attendance-a487d.firebaseapp.com",
  projectId: "school-attendance-a487d",
  storageBucket: "school-attendance-a487d.firebasestorage.app",
  messagingSenderId: "229377030076",
  appId: "1:229377030076:web:8e9c11f111b914acd75db9"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// Phase 4: Apps Script web app URL (set after deploying the Apps Script project)
// Replace with your deployed Web App URL from script.google.com
export const APPS_SCRIPT_URL = "YOUR_APPS_SCRIPT_WEB_APP_URL";
