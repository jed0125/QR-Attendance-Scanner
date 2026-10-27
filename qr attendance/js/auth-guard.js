import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";
import { app } from "./firebase-config.js";

const auth = getAuth(app);
const db = getFirestore(app);

// Internal state
let currentStaff = null;
let authResolved = false;

// Wait for auth state and staff document check
export function initAuthGuard() {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        authResolved = true;
        currentStaff = null;
        unsubscribe();
        resolve(null);
        return;
      }

      // Check for staff document
      const staffRef = doc(db, "staff", user.uid);
      const staffSnap = await getDoc(staffRef);

      if (!staffSnap.exists()) {
        // Not a staff member — sign out and redirect
        await signOut(auth);
        authResolved = true;
        currentStaff = null;
        unsubscribe();
        resolve(null);
        return;
      }

      // Valid staff member
      const staffData = staffSnap.data();
      currentStaff = {
        uid: user.uid,
        name: staffData.name || "Staff",
        role: staffData.role || "teacher"
      };
      authResolved = true;
      unsubscribe();
      resolve(currentStaff);
    });
  });
}

// Get current staff info (call after initAuthGuard resolves)
export function getCurrentStaff() {
  return currentStaff;
}

// Check if auth guard has resolved
export function isAuthResolved() {
  return authResolved;
}

// Sign out and redirect to login
export async function signOutAndRedirect() {
  await signOut(auth);
  window.location.href = "login.html";
}

// Hide page content until auth resolves (call immediately in page script)
export function hidePageContent() {
  document.body.style.visibility = "hidden";
}

// Show page content after auth resolves
export function showPageContent() {
  document.body.style.visibility = "";
}