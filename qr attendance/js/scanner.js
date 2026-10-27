import { getFirestore, doc, getDoc, setDoc, collection, query, where, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import { app } from "./firebase-config.js";
import { initAuthGuard, getCurrentStaff, hidePageContent, showPageContent, signOutAndRedirect } from "./auth-guard.js";
import { initStaffNav } from "./nav.js";
import { requestEmail } from "./email.js";
import "./site-config.js";

const db = getFirestore(app);
const auth = getAuth(app);

// DOM elements
const staffNameEl = document.querySelector("#staff-name");
const mainContent = document.querySelector("#main-content");
const pageFooter = document.querySelector("#page-footer");
const scanMessage = document.querySelector("#scan-message");
const resultCard = document.querySelector("#result-card");
const resultChip = document.querySelector("#result-chip");
const resultText = document.querySelector("#result-text");
const resultTime = document.querySelector("#result-time");
const resultLabel = document.querySelector("#result-label");
const emailStatus = document.querySelector("#email-status");
const timeInButton = document.querySelector("#time-in-button");
const timeOutButton = document.querySelector("#time-out-button");
const cameraSwitchButton = document.querySelector("#camera-switch-button");
const logsBody = document.querySelector("#logs-body");
const logsEmptyState = document.querySelector("#logs-empty-state");
const logsTable = document.querySelector("#logs-table");
const logsMessage = document.querySelector("#logs-message");
const signoutButton = document.querySelector("#signout-button");

// State
let currentMode = "time_in";
let html5QrCode = null;
let currentCameraId = null;
let cameras = [];
let lastScannedCode = null;
let lastScanTime = 0;
let logsUnsubscribe = null;
let lastAttendanceId = null;
let emailStatusUnsubscribe = null;
let currentStaffUid = null;
let lastGuardianName = "";

// Hide page content until auth resolves
hidePageContent();

// Initialize auth guard
initAuthGuard().then((staff) => {
  if (!staff) {
    window.location.href = "login.html";
    return;
  }

  currentStaffUid = staff.uid;
  if (staffNameEl) {
    staffNameEl.textContent = staff.name || "Teacher";
  }

  showPageContent();
  mainContent.hidden = false;
  pageFooter.hidden = false;

  if (signoutButton) {
    signoutButton.addEventListener("click", () => {
      if (html5QrCode) {
        html5QrCode.stop().catch(() => {});
        html5QrCode = null;
      }
      if (logsUnsubscribe) {
        logsUnsubscribe();
        logsUnsubscribe = null;
      }
      if (emailStatusUnsubscribe) {
        emailStatusUnsubscribe();
        emailStatusUnsubscribe = null;
      }
      signOutAndRedirect();
    });
  }

  initializeScanner();
  startLogsListener();
});

// Mode toggle handlers
timeInButton.addEventListener("click", () => setMode("time_in"));
timeOutButton.addEventListener("click", () => setMode("time_out"));

function setMode(mode) {
  currentMode = mode;
  const isTimeIn = mode === "time_in";
  timeInButton.setAttribute("aria-pressed", String(isTimeIn));
  timeOutButton.setAttribute("aria-pressed", String(!isTimeIn));
  clearScanMessage();
  hideResultCard();
}

// Camera switch handler
cameraSwitchButton.addEventListener("click", async () => {
  if (cameras.length <= 1) return;
  const currentIndex = cameras.findIndex((c) => c.id === currentCameraId);
  const nextIndex = (currentIndex + 1) % cameras.length;
  await switchCamera(cameras[nextIndex].id);
});

async function initializeScanner() {
  try {
    html5QrCode = new Html5Qrcode("camera-view");
    cameras = await Html5Qrcode.getCameras();
  } catch (error) {
    console.error("Failed to get cameras:", error);
    showScanMessage("No camera found. Please connect a camera and reload.", true);
    cameraSwitchButton.hidden = true;
    return;
  }

  if (cameras.length === 0) {
    showScanMessage("No camera found. Please connect a camera and reload.", true);
    cameraSwitchButton.hidden = true;
    return;
  }

  // Prefer rear camera (environment) first
  const rearCamera = cameras.find((c) => (
    c.label.toLowerCase().includes("back") ||
    c.label.toLowerCase().includes("rear") ||
    c.label.toLowerCase().includes("environment")
  ));
  currentCameraId = rearCamera ? rearCamera.id : cameras[0].id;
  cameraSwitchButton.hidden = cameras.length <= 1;
  updateCameraSwitchButtonLabel();

  await startScanning(currentCameraId);
}

async function startScanning(cameraId) {
  if (!html5QrCode) return;

  try {
    await html5QrCode.start(
      cameraId,
      {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1.0,
        disableFlip: false
      },
      onScanSuccess,
      onScanFailure
    );
  } catch (error) {
    console.error("Failed to start scanner:", error);
    if (error.name === "NotAllowedError" || error.message.includes("permission")) {
      showScanMessage("Camera permission denied. Please allow camera access in your browser settings and reload.", true);
    } else if (error.name === "NotFoundError" || error.message.includes("not found")) {
      showScanMessage("No camera found. Please connect a camera and reload.", true);
    } else {
      showScanMessage("Unable to start camera. Please try again or reload the page.", true);
    }
  }
}

async function switchCamera(cameraId) {
  if (!html5QrCode) return;
  try {
    await html5QrCode.stop();
    currentCameraId = cameraId;
    updateCameraSwitchButtonLabel();
    await startScanning(cameraId);
  } catch (error) {
    console.error("Failed to switch camera:", error);
    showScanMessage("Failed to switch camera.", true);
  }
}

function updateCameraSwitchButtonLabel() {
  const camera = cameras.find((c) => c.id === currentCameraId);
  const isFront = camera && (camera.label.toLowerCase().includes("front") || camera.label.toLowerCase().includes("user"));
  cameraSwitchButton.textContent = isFront ? "Switch to rear camera" : "Switch to front camera";
}

function onScanSuccess(decodedText) {
  const now = Date.now();
  if (lastScannedCode === decodedText && now - lastScanTime < 3000) {
    return;
  }
  lastScannedCode = decodedText;
  lastScanTime = now;
  handleScanResult(decodedText);
}

function onScanFailure() {
  // Ignore scan failures (no QR code in frame)
}

function isValidUUID(text) {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(text);
}

async function handleScanResult(studentId) {
  clearScanMessage();
  hideResultCard();

  if (!isValidUUID(studentId)) {
    showRejectionCard("Not a valid student QR", "red");
    playFeedback("error");
    return;
  }

  const staff = getCurrentStaff();
  if (!staff) {
    showRejectionCard("Not authenticated. Please sign in again.", "red");
    playFeedback("error");
    return;
  }

  try {
    // Get student document
    const studentRef = doc(db, "students", studentId);
    const studentSnap = await getDoc(studentRef);

    if (!studentSnap.exists()) {
      showRejectionCard("Student not found", "red");
      playFeedback("error");
      return;
    }

    const studentData = studentSnap.data();
    if (studentData.approved !== true) {
      showRejectionCard("Student registration not approved", "red");
      playFeedback("error");
      return;
    }

    lastGuardianName = studentData.guardianName || "";

    // Compute logDay in browser (Asia/Manila)
    const logDay = Math.floor((Date.now() + 28800000) / 86400000);
    const type = currentMode;
    const attendanceId = `${studentId}_${type}_${logDay}`;

    // Check if attendance document already exists
    const attendanceRef = doc(db, "attendance", attendanceId);
    const attendanceSnap = await getDoc(attendanceRef);

    if (attendanceSnap.exists()) {
      const existingData = attendanceSnap.data();
      const timeStr = formatTimeFromTimestamp(existingData.createdAt);
      const label = type === "time_in" ? "timed in" : "timed out";
      showRejectionCard(`Already ${label} today at ${timeStr}`, "amber");
      playFeedback("warning");
      return;
    }

    // For time_out, check that time_in exists
    if (type === "time_out") {
      const timeInId = `${studentId}_time_in_${logDay}`;
      const timeInRef = doc(db, "attendance", timeInId);
      const timeInSnap = await getDoc(timeInRef);
      if (!timeInSnap.exists()) {
        showRejectionCard("No time in recorded today", "amber");
        playFeedback("warning");
        return;
      }
    }

    // Write attendance document
    await setDoc(attendanceRef, {
      studentId,
      type,
      logDay,
      studentName: studentData.studentName,
      guardianEmail: studentData.guardianEmail,
      scannedBy: staff.uid,
      createdAt: serverTimestamp()
    });

    // Read back to get server timestamp for display
    const newSnap = await getDoc(attendanceRef);
    if (!newSnap.exists()) {
      showScanMessage("Write succeeded but could not read back. Please check logs.", true);
      playFeedback("error");
      return;
    }

    const newData = newSnap.data();
    const timeStr = formatTimeFromTimestamp(newData.createdAt);
    const typeLabel = type === "time_in" ? "Time In" : "Time Out";
    showResultCard(studentData.studentName, typeLabel, timeStr, lastGuardianName);
    playFeedback("success");

    // Start email notification flow (non-blocking)
    lastAttendanceId = attendanceId;
    requestEmail(attendanceId);
    startEmailStatusListener(attendanceId, lastGuardianName);

  } catch (error) {
    console.error("Scan handling failed:", error);
    if (error.code === "permission-denied" || (error.message && error.message.includes("permission"))) {
      showRejectionCard("Permission denied. The security rules rejected this scan.", "red");
    } else {
      showRejectionCard("Scan failed. Please try again.", "red");
    }
    playFeedback("error");
  }
}

function formatTimeFromTimestamp(timestamp) {
  if (!timestamp) return "—";
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
}

function showScanMessage(message, isError) {
  scanMessage.textContent = message;
  scanMessage.style.color = isError ? "var(--ds-danger)" : "var(--ds-amber)";
}

function clearScanMessage() {
  scanMessage.textContent = "";
  scanMessage.style.color = "";
}

function showResultCard(studentName, typeLabel, timeStr, guardianName) {
  resultCard.className = "scanner-result-card";
  resultLabel.textContent = "LAST SCAN";
  resultChip.textContent = typeLabel.toUpperCase();
  resultChip.className = typeLabel === "Time In" ? "chip chip--present" : "chip chip--late";
  resultText.textContent = studentName;
  resultTime.textContent = timeStr;
  resultCard.hidden = false;
  emailStatus.hidden = false;
  emailStatus.textContent = "Sending email…";
  emailStatus.style.color = "var(--ds-text-soft)";
}

function showRejectionCard(message, variant) {
  resultCard.className = "scanner-result-card " + (variant === "amber" ? "result-card--rejection-amber" : "result-card--rejection-red");
  resultLabel.textContent = "SCAN REJECTED";
  resultChip.textContent = variant === "amber" ? "WARNING" : "ERROR";
  resultChip.className = variant === "amber" ? "chip chip--late" : "chip chip--absent";
  resultText.textContent = message;
  resultTime.textContent = "";
  resultCard.hidden = false;
  emailStatus.hidden = true;
  emailStatus.textContent = "";
}

function hideResultCard() {
  resultCard.hidden = true;
  emailStatus.hidden = true;
  emailStatus.textContent = "";
}

function playFeedback(type) {
  if ("vibrate" in navigator) {
    if (type === "success") {
      navigator.vibrate([100, 50, 100]);
    } else if (type === "warning") {
      navigator.vibrate([200, 100, 200]);
    } else {
      navigator.vibrate(300);
    }
  }

  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    if (type === "success") {
      oscillator.frequency.value = 800;
      oscillator.type = "sine";
      gainNode.gain.value = 0.1;
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.15);
      setTimeout(() => {
        const osc2 = audioCtx.createOscillator();
        const g2 = audioCtx.createGain();
        osc2.connect(g2);
        g2.connect(audioCtx.destination);
        osc2.frequency.value = 1000;
        g2.gain.value = 0.1;
        osc2.start();
        osc2.stop(audioCtx.currentTime + 0.15);
      }, 150);
    } else if (type === "warning") {
      oscillator.frequency.value = 400;
      oscillator.type = "triangle";
      gainNode.gain.value = 0.1;
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.3);
    } else {
      oscillator.frequency.value = 200;
      oscillator.type = "sawtooth";
      gainNode.gain.value = 0.1;
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.4);
    }
  } catch {
    // Audio unavailable or blocked
  }
}

/**
 * Listen to notifications/{attendanceId} for email status updates.
 */
function startEmailStatusListener(attendanceId, guardianName) {
  if (emailStatusUnsubscribe) {
    emailStatusUnsubscribe();
    emailStatusUnsubscribe = null;
  }

  const notificationRef = doc(db, "notifications", attendanceId);
  let settled = false;
  const timeoutMs = 30000;
  const startTime = Date.now();

  const cleanup = () => {
    if (emailStatusUnsubscribe) {
      emailStatusUnsubscribe();
      emailStatusUnsubscribe = null;
    }
  };

  emailStatusUnsubscribe = onSnapshot(notificationRef, (snap) => {
    if (settled) return;

    if (!snap.exists()) {
      if (Date.now() - startTime > timeoutMs) {
        showEmailStatus("Email status unknown", "amber");
        settled = true;
        cleanup();
      }
      return;
    }

    const data = snap.data();
    const status = data.status;

    if (status === "sending") {
      showEmailStatus("Sending email…", "soft");
    } else if (status === "sent") {
      const gText = guardianName ? `Email sent to ${guardianName}` : "Email sent";
      showEmailStatus(`✓ ${gText}`, "green");
      settled = true;
      cleanup();
    } else if (status === "skipped") {
      showEmailStatus("Email skipped (test mode)", "green");
      settled = true;
      cleanup();
    } else if (status === "failed") {
      showEmailStatus("Email failed", "amber");
      settled = true;
      cleanup();
    }
  }, (error) => {
    console.error("Email status listener error:", error);
    if (!settled) {
      showEmailStatus("Email status unavailable", "amber");
      settled = true;
      cleanup();
    }
  });

  setTimeout(() => {
    if (!settled) {
      showEmailStatus("Email status timeout", "amber");
      settled = true;
      cleanup();
    }
  }, timeoutMs);
}

function showEmailStatus(message, variant) {
  emailStatus.textContent = message;
  emailStatus.hidden = false;
  if (variant === "green") {
    emailStatus.style.color = "var(--ds-primary)";
  } else if (variant === "amber") {
    emailStatus.style.color = "#8A4A0B";
  } else {
    emailStatus.style.color = "var(--ds-text-soft)";
  }
}

function startLogsListener() {
  const logDay = Math.floor((Date.now() + 28800000) / 86400000);
  const attendanceRef = collection(db, "attendance");
  const q = query(attendanceRef, where("logDay", "==", logDay));

  logsUnsubscribe = onSnapshot(q, async (snapshot) => {
    logsBody.replaceChildren();
    const logs = [];

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      logs.push({
        id: docSnap.id,
        ...data
      });
    });

    // Sort by createdAt descending (newest first)
    logs.sort((a, b) => {
      const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0);
      const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0);
      return timeB - timeA;
    });

    if (logs.length === 0) {
      logsEmptyState.hidden = false;
      logsTable.hidden = true;
      return;
    }

    logsEmptyState.hidden = true;
    logsTable.hidden = false;

    for (const log of logs) {
      const row = await createLogRowWithEmailStatus(log);
      logsBody.appendChild(row);
    }
  }, (error) => {
    console.error("Logs listener error:", error);
    logsMessage.textContent = "Failed to load today's logs.";
    logsMessage.style.color = "var(--ds-danger)";
    logsEmptyState.hidden = false;
    logsTable.hidden = true;
  });
}

async function createLogRowWithEmailStatus(log) {
  const row = document.createElement("tr");

  // Student Name on left
  const nameCell = document.createElement("td");
  nameCell.className = "earlier-name";
  nameCell.textContent = log.studentName || "—";
  row.appendChild(nameCell);

  // Time & Type on right: "7:41 AM - In"
  const timeCell = document.createElement("td");
  timeCell.className = "earlier-time";
  const typeShort = log.type === "time_in" ? "In" : "Out";
  timeCell.textContent = `${formatTimeFromTimestamp(log.createdAt)} - ${typeShort}`;
  row.appendChild(timeCell);

  // Email action / status
  const actionCell = document.createElement("td");
  actionCell.className = "earlier-action";

  const retryButton = document.createElement("button");
  retryButton.type = "button";
  retryButton.className = "btn btn-outline btn-sm";
  retryButton.textContent = "Retry";
  retryButton.style.color = "var(--ds-amber)";
  retryButton.style.borderColor = "var(--ds-amber)";
  retryButton.hidden = true;
  retryButton.addEventListener("click", () => {
    retryButton.disabled = true;
    retryButton.textContent = "Retrying…";
    requestEmail(log.id).finally(() => {
      retryButton.disabled = false;
      retryButton.textContent = "Retry";
    });
  });
  actionCell.appendChild(retryButton);
  row.appendChild(actionCell);

  // Listener for notification document
  const notificationRef = doc(db, "notifications", log.id);
  onSnapshot(notificationRef, (snap) => {
    if (!snap.exists()) {
      retryButton.hidden = false;
      return;
    }

    const data = snap.data();
    const status = data.status;
    const attempts = data.attempts || 1;
    const updatedAt = data.updatedAt?.toDate ? data.updatedAt.toDate() : null;

    if (status === "failed") {
      const isStaleSending = status === "sending" && updatedAt && (Date.now() - updatedAt.getTime()) >= 120000;
      if (attempts < 3 || isStaleSending) {
        retryButton.hidden = false;
      } else {
        retryButton.hidden = true;
      }
    } else {
      retryButton.hidden = true;
    }
  });

  return row;
}
