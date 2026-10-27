import { getFirestore, collection, query, where, getDocs, updateDoc, deleteDoc, doc, serverTimestamp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";
import { app } from "./firebase-config.js";
import { initAuthGuard, getCurrentStaff, hidePageContent, showPageContent, signOutAndRedirect } from "./auth-guard.js";
import { initStaffNav } from "./nav.js";
import "./site-config.js";

const db = getFirestore(app);

// DOM elements
const statusMessage = document.querySelector("#status-message");
const refreshButton = document.querySelector("#refresh-button");
const approvalsBody = document.querySelector("#approvals-body");
const emptyState = document.querySelector("#empty-state");
const approvalsTable = document.querySelector("#approvals-table");
const mainContent = document.querySelector("#main-content");
const pageFooter = document.querySelector("#page-footer");

// State
let isLoading = false;

// Hide page content until auth resolves
hidePageContent();

// Initialize auth guard
initAuthGuard().then((staff) => {
  if (!staff) {
    window.location.href = "login.html";
    return;
  }

  initStaffNav("approvals.html");
  showPageContent();
  mainContent.hidden = false;
  pageFooter.hidden = false;
  loadPendingRegistrations();
});

// Refresh button handler
refreshButton.addEventListener("click", () => {
  loadPendingRegistrations();
});

// Format date in Asia/Manila timezone (12-hour format)
function formatRegistrationDate(timestamp) {
  if (!timestamp) return "—";
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
}

// Create a card for a pending student
function createStudentCard(student) {
  const card = document.createElement("article");
  card.className = "pending-card";
  card.dataset.studentId = student.id;
  card.dataset.studentName = student.studentName || "Student";

  // Card Header: Student Name + Grade/Section
  const header = document.createElement("div");
  header.className = "pending-card__header";

  const nameEl = document.createElement("h3");
  nameEl.className = "pending-card__name";
  nameEl.textContent = student.studentName || "—";
  header.appendChild(nameEl);

  const gradeEl = document.createElement("p");
  gradeEl.className = "pending-card__grade";
  gradeEl.textContent = student.gradeSection ? `Grade / Section: ${student.gradeSection}` : "Grade / Section: Not specified";
  header.appendChild(gradeEl);

  card.appendChild(header);

  // Card Body: Details (Guardian, Email, Phone, Registered time)
  const details = document.createElement("div");
  details.className = "pending-card__details";

  const rows = [
    { label: "Guardian", value: student.guardianName || "—" },
    { label: "Email", value: student.guardianEmail || "—" },
    { label: "Phone", value: student.guardianPhone || "—" },
    { label: "Registered", value: formatRegistrationDate(student.createdAt) }
  ];

  rows.forEach(({ label, value }) => {
    const rowEl = document.createElement("div");
    rowEl.className = "pending-card__detail-row";

    const labelSpan = document.createElement("span");
    labelSpan.className = "pending-card__label";
    labelSpan.textContent = label;
    rowEl.appendChild(labelSpan);

    const valSpan = document.createElement("span");
    valSpan.className = "pending-card__value";
    valSpan.textContent = value;
    rowEl.appendChild(valSpan);

    details.appendChild(rowEl);
  });

  card.appendChild(details);

  // Actions: Approve (green) & Reject (red outline)
  const actions = document.createElement("div");
  actions.className = "pending-card__actions";

  // Reminder text
  const reminder = document.createElement("p");
  reminder.className = "approval-reminder";
  reminder.textContent = "Confirm the guardian email with the family before approving.";
  actions.appendChild(reminder);

  const approveButton = document.createElement("button");
  approveButton.type = "button";
  approveButton.className = "btn btn-primary approve-button";
  approveButton.textContent = "Approve";
  approveButton.addEventListener("click", () => handleApprove(student.id, card));

  const rejectButton = document.createElement("button");
  rejectButton.type = "button";
  rejectButton.className = "btn btn-danger-outline reject-button";
  rejectButton.textContent = "Reject";
  rejectButton.addEventListener("click", () => handleReject(student.id, card));

  actions.appendChild(approveButton);
  actions.appendChild(rejectButton);
  card.appendChild(actions);

  return card;
}

// Show status message
function showStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.style.color = isError ? "var(--ds-danger)" : "var(--ds-primary)";
}

function clearStatus() {
  statusMessage.textContent = "";
}

// Set loading state
function setLoading(loading) {
  isLoading = loading;
  refreshButton.disabled = loading;
  refreshButton.textContent = loading ? "Loading…" : "Refresh";

  const actionButtons = approvalsBody.querySelectorAll(".approve-button, .reject-button");
  actionButtons.forEach((btn) => {
    btn.disabled = loading;
  });
}

// Load pending registrations (approved == false)
async function loadPendingRegistrations() {
  if (isLoading) return;

  setLoading(true);
  clearStatus();
  emptyState.hidden = true;
  approvalsBody.replaceChildren();

  try {
    const studentsRef = collection(db, "students");
    const q = query(studentsRef, where("approved", "==", false));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      emptyState.hidden = false;
      approvalsTable.hidden = true;
      return;
    }

    const students = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      students.push({
        id: docSnap.id,
        ...data
      });
    });

    // Sort by createdAt descending (newest first)
    students.sort((a, b) => {
      const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0);
      const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0);
      return timeB - timeA;
    });

    const limitedStudents = students.slice(0, 200);

    approvalsTable.hidden = false;
    limitedStudents.forEach((student) => {
      const card = createStudentCard(student);
      approvalsBody.appendChild(card);
    });

    if (students.length > 200) {
      showStatus(`Showing 200 of ${students.length} pending registrations.`);
    }
  } catch (error) {
    console.error("Failed to load pending registrations:", error);
    showStatus("Failed to load pending registrations. Please try again.", true);
    emptyState.hidden = true;
    approvalsTable.hidden = true;
  } finally {
    setLoading(false);
  }
}

// Handle approve action
async function handleApprove(studentId, card) {
  const approveButton = card.querySelector(".approve-button");
  const rejectButton = card.querySelector(".reject-button");

  approveButton.disabled = true;
  rejectButton.disabled = true;
  approveButton.textContent = "Approving…";

  try {
    const staff = getCurrentStaff();
    if (!staff) {
      throw new Error("Not authenticated");
    }

    const studentRef = doc(db, "students", studentId);
    await updateDoc(studentRef, {
      approved: true,
      approvedAt: serverTimestamp(),
      approvedBy: staff.uid
    });

    const { getDoc } = await import("https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js");
    const updatedSnap = await getDoc(studentRef);
    if (!updatedSnap.exists() || updatedSnap.data().approved !== true) {
      throw new Error("Approval was not saved. Please try again.");
    }

    card.style.opacity = "0";
    card.style.transform = "scale(0.96)";
    card.style.transition = "opacity 200ms ease, transform 200ms ease";
    setTimeout(() => {
      card.remove();
      checkEmptyState();
    }, 200);

    showStatus(`Approved: ${card.dataset.studentName}`);
  } catch (error) {
    console.error("Approve failed:", error);
    let message = "Approval failed. Please try again.";
    if (error.message && (error.message.includes("permission") || error.message.includes("denied"))) {
      message = "You don't have permission to approve this registration.";
    } else if (error.message && error.message.includes("not saved")) {
      message = error.message;
    }
    showStatus(message, true);
    approveButton.disabled = false;
    rejectButton.disabled = false;
    approveButton.textContent = "Approve";
  }
}

// Handle reject action
async function handleReject(studentId, card) {
  const studentName = card.dataset.studentName || "Student";

  if (!confirm(`Reject registration for "${studentName}"? This will permanently delete the record.`)) {
    return;
  }

  const approveButton = card.querySelector(".approve-button");
  const rejectButton = card.querySelector(".reject-button");

  approveButton.disabled = true;
  rejectButton.disabled = true;
  rejectButton.textContent = "Rejecting…";

  try {
    const studentRef = doc(db, "students", studentId);
    await deleteDoc(studentRef);

    const { getDoc } = await import("https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js");
    const deletedSnap = await getDoc(studentRef);
    if (deletedSnap.exists()) {
      throw new Error("Rejection was not saved. Please try again.");
    }

    card.style.opacity = "0";
    card.style.transform = "scale(0.96)";
    card.style.transition = "opacity 200ms ease, transform 200ms ease";
    setTimeout(() => {
      card.remove();
      checkEmptyState();
    }, 200);

    showStatus(`Rejected: ${studentName}`);
  } catch (error) {
    console.error("Reject failed:", error);
    let message = "Rejection failed. Please try again.";
    if (error.message && (error.message.includes("permission") || error.message.includes("denied"))) {
      message = "You don't have permission to reject this registration.";
    } else if (error.message && error.message.includes("not saved")) {
      message = error.message;
    }
    showStatus(message, true);
    approveButton.disabled = false;
    rejectButton.disabled = false;
    rejectButton.textContent = "Reject";
  }
}

function checkEmptyState() {
  const cards = approvalsBody.querySelectorAll(".pending-card");
  if (cards.length === 0) {
    emptyState.hidden = false;
    approvalsTable.hidden = true;
  }
}
