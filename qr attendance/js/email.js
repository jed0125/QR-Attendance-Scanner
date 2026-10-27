import { getAuth } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import { app } from "./firebase-config.js";
import { APPS_SCRIPT_URL } from "./firebase-config.js";

const auth = getAuth(app);

/**
 * Request email notification via Apps Script web app.
 * Does not block the caller — runs in background.
 * @param {string} attendanceId
 */
export async function requestEmail(attendanceId) {
  try {
    const user = auth.currentUser;
    if (!user) return;

    const idToken = await user.getIdToken();
    const response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify({ idToken, attendanceId })
    });

    // We don't await the result here — the onSnapshot listener will update the UI
    // But we can log for debugging
    if (!response.ok) {
      console.warn("Email request returned non-OK:", response.status);
    }
  } catch (error) {
    console.warn("Email request failed:", error);
  }
}