import { getFirestore, doc, getDoc, Timestamp, collection, query, where, onSnapshot, limit, getDocs, getCount } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";
import { app } from "./firebase-config.js";
import { initAuthGuard, getCurrentStaff, hidePageContent, showPageContent, signOutAndRedirect } from "./auth-guard.js";
import { initStaffNav } from "./nav.js";
import { DEFAULT_SETTINGS, todayLogDay, DAY_MS, getDayStatus, getStatusDisplay, formatManilaTime } from "./school-calendar.js";
import { requestEmail } from "./email.js";
import "./site-config.js";

const db = getFirestore(app);

// DOM elements
const statusMessage = document.querySelector("#status-message");
const mainContent = document.querySelector("#main-content");
const pageFooter = document.querySelector("#page-footer");
const emptyState = document.querySelector("#empty-state");
const dashboardBody = document.querySelector("#dashboard-body");
const dashboardTable = document.querySelector("#dashboard-table");
const nameSearch = document.querySelector("#name-search");
const gradeFilter = document.querySelector("#grade-filter");
const statusTabs = document.querySelector("#status-tabs");
const tabButtons = statusTabs.querySelectorAll(".tab-button");

// Summary cards
const valApproved = document.querySelector("#val-approved");
const valArrived = document.querySelector("#val-arrived");
const valLate = document.querySelector("#val-late");
const valLeft = document.querySelector("#val-left");
const valAbsent = document.querySelector("#val-absent");
const valFailedEmails = document.querySelector("#val-failed-emails");
const linkPending = document.querySelector("#link-pending");

// Email problems panel
const emailProblemsSection = document.querySelector("#email-problems-section");
const emailProblemsStatus = document.querySelector("#email-problems-status");
const emailProblemsWrapper = document.querySelector("#email-problems-wrapper");
const emailProblemsBody = document.querySelector("#email-problems-body");
const emailProblemsTable = document.querySelector("#email-problems-table");
const emailProblemsCount = document.querySelector("#email-problems-count");

// State
let settings = { ...DEFAULT_SETTINGS };
let students = [];
let studentMap = new Map();
let attendanceMap = new Map();
let notificationsMap = new Map();
let currentStatusFilter = "all";
let attendanceUnsubscribe = null;
let notificationsUnsubscribe = null;
let pendingApprovalsCount = 0;
let isLoading = true;

// Hide page content until auth resolves
hidePageContent();

// Initialize auth guard
initAuthGuard().then((staff) => {
  if (!staff) {
    window.location.href = "login.html";
    return;
  }

  initStaffNav("dashboard.html");
  showPageContent();
  mainContent.hidden = false;
  pageFooter.hidden = false;

  loadSettings();
});

// Load school settings
async function loadSettings() {
  try {
    const settingsRef = doc(db, "settings", "school");
    const snap = await getDoc(settingsRef);
    if (snap.exists()) {
      settings = { ...DEFAULT_SETTINGS, ...snap.data() };
    }
    await loadStudents();
  } catch (error) {
    console.error("Failed to load settings:", error);
    showStatus("Failed to load settings. Using defaults.", true);
    await loadStudents();
  }
}

// Load all approved students (limit 2000)
async function loadStudents() {
  showStatus("Loading students…");
  try {
    const studentsRef = collection(db, "students");
    const q = query(studentsRef, where("approved", "==", true), limit(2000));
    const snapshot = await getDocs(q);

    students = [];
    studentMap.clear();
    const gradeSections = new Set();

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const student = { id: docSnap.id, ...data };
      students.push(student);
      studentMap.set(docSnap.id, student);
      if (data.gradeSection) {
        gradeSections.add(data.gradeSection);
      }
    });

    students.sort((a, b) => (a.studentName || "").localeCompare(b.studentName || ""));

    // Populate grade/section filter
    gradeFilter.replaceChildren();
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "All grades/sections";
    gradeFilter.appendChild(defaultOption);
    [...gradeSections].sort().forEach((gs) => {
      const option = document.createElement("option");
      option.value = gs;
      option.textContent = gs;
      gradeFilter.appendChild(option);
    });

    if (students.length === 2000) {
      showStatus("Warning: Showing first 2000 approved students. List may be truncated.", true);
    } else {
      clearStatus();
    }

    await loadPendingApprovalsCount();
    startAttendanceListener();
    startNotificationsListener();
  } catch (error) {
    console.error("Failed to load students:", error);
    showStatus("Failed to load students.", true);
  }
}

// Count pending approvals
async function loadPendingApprovalsCount() {
  try {
    const studentsRef = collection(db, "students");
    const q = query(studentsRef, where("approved", "==", false));
    const snap = await getCount(q);
    pendingApprovalsCount = snap.data().count;
    linkPending.textContent = `${pendingApprovalsCount} pending`;
    updateSummaryCards();
  } catch (error) {
    console.error("Failed to count pending approvals:", error);
    linkPending.textContent = "—";
  }
}

// Start real-time listener for today's attendance
function startAttendanceListener() {
  const logDay = todayLogDay();
  const attendanceRef = collection(db, "attendance");
  const q = query(attendanceRef, where("logDay", "==", logDay));

  attendanceUnsubscribe = onSnapshot(q, (snapshot) => {
    attendanceMap.clear();
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const studentId = data.studentId;
      if (!attendanceMap.has(studentId)) {
        attendanceMap.set(studentId, { timeIn: null, timeOut: null });
      }
      const entry = attendanceMap.get(studentId);
      if (data.type === "time_in") {
        entry.timeIn = data;
      } else {
        entry.timeOut = data;
      }
    });
    renderDashboard();
    renderEmailProblems();
  }, (error) => {
    console.error("Attendance listener error:", error);
    showStatus("Failed to load today's attendance.", true);
  });
}

// Start real-time listener for today's notifications
function startNotificationsListener() {
  const startOfTodayManila = todayLogDay() * DAY_MS;
  const notificationsRef = collection(db, "notifications");
  const q = query(notificationsRef, where("createdAt", ">=", Timestamp.fromMillis(startOfTodayManila)));

  notificationsUnsubscribe = onSnapshot(q, (snapshot) => {
    notificationsMap.clear();
    snapshot.forEach((docSnap) => {
      notificationsMap.set(docSnap.id, docSnap.data());
    });
    renderDashboard();
    renderEmailProblems();
  }, (error) => {
    console.error("Notifications listener error:", error);
  });
}

// Compute status for each student and update summary cards
function computeStudentStatuses() {
  const logDay = todayLogDay();
  const nowMillis = Date.now();
  const results = [];

  for (const student of students) {
    const attendance = attendanceMap.get(student.id) || { timeIn: null, timeOut: null };
    const timeInMillis = attendance.timeIn?.createdAt?.toMillis ? attendance.timeIn.createdAt.toMillis() : (attendance.timeIn?.createdAt?.seconds ? attendance.timeIn.createdAt.seconds * 1000 : null);
    const timeOutMillis = attendance.timeOut?.createdAt?.toMillis ? attendance.timeOut.createdAt.toMillis() : (attendance.timeOut?.createdAt?.seconds ? attendance.timeOut.createdAt.seconds * 1000 : null);

    let approvedLogDay = 0;
    if (student.approvedAt) {
      const millis = student.approvedAt.toMillis ? student.approvedAt.toMillis() : (student.approvedAt.seconds ? student.approvedAt.seconds * 1000 : 0);
      if (millis) approvedLogDay = Math.floor((millis + 8 * 3600 * 1000) / (24 * 3600 * 1000));
    } else if (student.createdAt) {
      const millis = student.createdAt.toMillis ? student.createdAt.toMillis() : (student.createdAt.seconds ? student.createdAt.seconds * 1000 : 0);
      if (millis) approvedLogDay = Math.floor((millis + 8 * 3600 * 1000) / (24 * 3600 * 1000));
    }

    const status = getDayStatus({
      logDay,
      settings,
      approvedLogDay,
      timeInMillis,
      timeOutMillis,
      nowMillis
    });

    results.push({
      student,
      attendance,
      status,
      timeInMillis,
      timeOutMillis
    });
  }

  return results;
}

// Update summary cards
function updateSummaryCards() {
  const logDay = todayLogDay();
  const nowMillis = Date.now();

  let approvedCount = 0;
  let arrivedCount = 0;
  let lateCount = 0;
  let leftCount = 0;
  let absentCount = 0;

  for (const student of students) {
    const attendance = attendanceMap.get(student.id) || { timeIn: null, timeOut: null };
    const timeInMillis = attendance.timeIn?.createdAt?.toMillis ? attendance.timeIn.createdAt.toMillis() : (attendance.timeIn?.createdAt?.seconds ? attendance.timeIn.createdAt.seconds * 1000 : null);
    const timeOutMillis = attendance.timeOut?.createdAt?.toMillis ? attendance.timeOut.createdAt.toMillis() : (attendance.timeOut?.createdAt?.seconds ? attendance.timeOut.createdAt.seconds * 1000 : null);

    let approvedLogDay = 0;
    if (student.approvedAt) {
      const millis = student.approvedAt.toMillis ? student.approvedAt.toMillis() : (student.approvedAt.seconds ? student.approvedAt.seconds * 1000 : 0);
      if (millis) approvedLogDay = Math.floor((millis + 8 * 3600 * 1000) / (24 * 3600 * 1000));
    } else if (student.createdAt) {
      const millis = student.createdAt.toMillis ? student.createdAt.toMillis() : (student.createdAt.seconds ? student.createdAt.seconds * 1000 : 0);
      if (millis) approvedLogDay = Math.floor((millis + 8 * 3600 * 1000) / (24 * 3600 * 1000));
    }

    const status = getDayStatus({
      logDay,
      settings,
      approvedLogDay,
      timeInMillis,
      timeOutMillis,
      nowMillis
    });

    approvedCount++;
    if (status.status === "present" || status.status === "late") arrivedCount++;
    if (status.status === "late") lateCount++;
    if (timeOutMillis !== null) leftCount++;
    if (status.status === "absent" || status.status === "not_yet_in") absentCount++;
  }

  valApproved.textContent = String(approvedCount);
  valArrived.textContent = String(arrivedCount);
  valLate.textContent = String(lateCount);
  valLeft.textContent = String(leftCount);
  valAbsent.textContent = String(absentCount);

  // Count failed emails
  let failedCount = 0;
  for (const notification of notificationsMap.values()) {
    if (notification.status === "failed") {
      failedCount++;
    }
  }
  if (valFailedEmails) {
    valFailedEmails.textContent = String(failedCount);
  }
}

// Render the main dashboard table
function renderDashboard() {
  const results = computeStudentStatuses();
  updateSummaryCards();

  // Filter by status tab
  let filtered = results;
  if (currentStatusFilter !== "all") {
    filtered = results.filter((r) => {
      switch (currentStatusFilter) {
        case "arrived": return (r.status.status === "present" || r.status.status === "late") && r.attendance.timeOut === null;
        case "late": return r.status.status === "late";
        case "not_yet_in": return r.status.status === "not_yet_in";
        case "absent": return r.status.status === "absent";
        case "left": return r.attendance.timeOut !== null;
        default: return true;
      }
    });
  }

  // Filter by name search
  const searchTerm = nameSearch.value.toLowerCase().trim();
  if (searchTerm) {
    filtered = filtered.filter((r) => (r.student.studentName || "").toLowerCase().includes(searchTerm));
  }

  // Filter by grade/section
  const gradeValue = gradeFilter.value;
  if (gradeValue) {
    filtered = filtered.filter((r) => r.student.gradeSection === gradeValue);
  }

  // Render rows
  dashboardBody.replaceChildren();
  if (filtered.length === 0) {
    emptyState.hidden = false;
    dashboardTable.hidden = true;
    return;
  }

  emptyState.hidden = true;
  dashboardTable.hidden = false;

  const logDay = todayLogDay();

  for (const { student, attendance, status, timeInMillis, timeOutMillis } of filtered) {
    const row = document.createElement("tr");

    // Student
    const nameCell = document.createElement("td");
    nameCell.textContent = student.studentName || "—";
    nameCell.style.fontWeight = "600";
    row.appendChild(nameCell);

    // Grade/Section
    const gradeCell = document.createElement("td");
    gradeCell.textContent = student.gradeSection || "—";
    row.appendChild(gradeCell);

    // Time in
    const timeInCell = document.createElement("td");
    timeInCell.textContent = timeInMillis ? formatManilaTime(timeInMillis) : "—";
    row.appendChild(timeInCell);

    // Time out
    const timeOutCell = document.createElement("td");
    timeOutCell.textContent = timeOutMillis ? formatManilaTime(timeOutMillis) : "—";
    row.appendChild(timeOutCell);

    // Status chip
    const statusCell = document.createElement("td");
    const chip = document.createElement("span");
    const display = getStatusDisplay(status.status);
    chip.className = `chip ${display.className}`;
    chip.textContent = display.text;
    if (status.missingTimeOut) {
      const note = document.createElement("span");
      note.className = "missing-timeout-note";
      note.textContent = " (No time-out)";
      chip.appendChild(note);
    }
    statusCell.appendChild(chip);
    row.appendChild(statusCell);

    // Email chip (Sent/Failed + Retry button)
    const emailCell = document.createElement("td");
    const timeOutId = `${student.id}_time_out_${logDay}`;
    const timeInId = `${student.id}_time_in_${logDay}`;
    const notif = notificationsMap.get(timeOutId) || notificationsMap.get(timeInId);
    const relevantAttendanceId = attendance.timeOut ? timeOutId : (attendance.timeIn ? timeInId : null);

    if (relevantAttendanceId) {
      const emailWrap = document.createElement("div");
      emailWrap.style.display = "inline-flex";
      emailWrap.style.alignItems = "center";
      emailWrap.style.gap = "8px";

      if (notif) {
        if (notif.status === "sent") {
          const sentChip = document.createElement("span");
          sentChip.className = "chip chip--sent";
          sentChip.textContent = "Sent";
          emailWrap.appendChild(sentChip);
        } else if (notif.status === "failed") {
          const failChip = document.createElement("span");
          failChip.className = "chip chip--failed";
          failChip.textContent = "Failed";
          emailWrap.appendChild(failChip);

          const retryBtn = document.createElement("button");
          retryBtn.type = "button";
          retryBtn.className = "btn btn-outline btn-sm";
          retryBtn.textContent = "Retry";
          retryBtn.addEventListener("click", async () => {
            retryBtn.disabled = true;
            retryBtn.textContent = "Retrying…";
            await requestEmail(relevantAttendanceId);
            retryBtn.disabled = false;
            retryBtn.textContent = "Retry";
          });
          emailWrap.appendChild(retryBtn);
        } else if (notif.status === "sending") {
          const sendingChip = document.createElement("span");
          sendingChip.className = "chip chip--sending";
          sendingChip.textContent = "Sending";
          emailWrap.appendChild(sendingChip);
        } else if (notif.status === "skipped") {
          const skipChip = document.createElement("span");
          skipChip.className = "chip chip--skipped";
          skipChip.textContent = "Skipped";
          emailWrap.appendChild(skipChip);
        }
      } else {
        const retryBtn = document.createElement("button");
        retryBtn.type = "button";
        retryBtn.className = "btn btn-outline btn-sm";
        retryBtn.textContent = "Retry";
        retryBtn.addEventListener("click", async () => {
          retryBtn.disabled = true;
          retryBtn.textContent = "Retrying…";
          await requestEmail(relevantAttendanceId);
          retryBtn.disabled = false;
          retryBtn.textContent = "Retry";
        });
        emailWrap.appendChild(retryBtn);
      }
      emailCell.appendChild(emailWrap);
    } else {
      emailCell.textContent = "—";
      emailCell.style.color = "var(--ds-text-muted)";
    }
    row.appendChild(emailCell);

    dashboardBody.appendChild(row);
  }
}

// Render email problems panel (above table, ONLY when problems exist)
function renderEmailProblems() {
  const logDay = todayLogDay();
  const attendanceIds = [];

  for (const [studentId, attendance] of attendanceMap.entries()) {
    if (attendance.timeIn) {
      attendanceIds.push(`${studentId}_time_in_${logDay}`);
    }
    if (attendance.timeOut) {
      attendanceIds.push(`${studentId}_time_out_${logDay}`);
    }
  }

  const problems = [];

  for (const attendanceId of attendanceIds) {
    const notification = notificationsMap.get(attendanceId);
    const studentId = attendanceId.split("_")[0];
    const student = studentMap.get(studentId);

    if (!notification) {
      problems.push({ attendanceId, student, type: "missing", notification: null });
    } else if (notification.status === "failed") {
      problems.push({ attendanceId, student, type: "failed", notification });
    } else if (notification.status === "sending") {
      const updatedAt = notification.updatedAt?.toMillis ? notification.updatedAt.toMillis() : (notification.updatedAt?.seconds ? notification.updatedAt.seconds * 1000 : 0);
      if (updatedAt && Date.now() - updatedAt > 120000) {
        problems.push({ attendanceId, student, type: "stale", notification });
      }
    }
  }

  if (problems.length === 0) {
    if (emailProblemsSection) emailProblemsSection.hidden = true;
    return;
  }

  if (emailProblemsSection) emailProblemsSection.hidden = false;
  if (emailProblemsCount) emailProblemsCount.textContent = `${problems.length} issue${problems.length === 1 ? "" : "s"}`;
  emailProblemsBody.replaceChildren();

  for (const problem of problems) {
    const row = document.createElement("tr");

    const nameCell = document.createElement("td");
    nameCell.textContent = problem.student?.studentName || "—";
    row.appendChild(nameCell);

    const typeCell = document.createElement("td");
    const isTimeIn = problem.attendanceId.includes("_time_in_");
    typeCell.textContent = isTimeIn ? "Time In" : "Time Out";
    row.appendChild(typeCell);

    const timeCell = document.createElement("td");
    const attendance = attendanceMap.get(problem.student?.id) || { timeIn: null, timeOut: null };
    const timeData = isTimeIn ? attendance.timeIn : attendance.timeOut;
    timeCell.textContent = timeData?.createdAt ? formatManilaTime(timeData.createdAt.toMillis ? timeData.createdAt.toMillis() : timeData.createdAt.seconds * 1000) : "—";
    row.appendChild(timeCell);

    const emailCell = document.createElement("td");
    emailCell.textContent = problem.student?.guardianEmail || "—";
    row.appendChild(emailCell);

    const notifStatusCell = document.createElement("td");
    const statusSpan = document.createElement("span");
    statusSpan.className = "chip";
    if (problem.type === "missing") {
      statusSpan.textContent = "Missing";
      statusSpan.classList.add("chip--no-class");
    } else if (problem.type === "failed") {
      statusSpan.textContent = `Failed (${problem.notification.attempts || 1}/3)`;
      statusSpan.classList.add("chip--failed");
    } else if (problem.type === "stale") {
      statusSpan.textContent = "Stuck sending";
      statusSpan.classList.add("chip--sending");
    }
    notifStatusCell.appendChild(statusSpan);
    row.appendChild(notifStatusCell);

    const actionCell = document.createElement("td");
    const retryButton = document.createElement("button");
    retryButton.type = "button";
    retryButton.className = "btn btn-outline btn-sm";
    retryButton.textContent = "Retry";
    retryButton.addEventListener("click", async () => {
      retryButton.disabled = true;
      retryButton.textContent = "Retrying…";
      await requestEmail(problem.attendanceId);
      retryButton.disabled = false;
      retryButton.textContent = "Retry";
    });
    actionCell.appendChild(retryButton);
    row.appendChild(actionCell);

    emailProblemsBody.appendChild(row);
  }
}

// Status tab handlers
statusTabs.addEventListener("click", (e) => {
  const button = e.target.closest(".tab-button");
  if (!button) return;

  currentStatusFilter = button.dataset.status;

  tabButtons.forEach((btn) => {
    const isActive = btn.dataset.status === currentStatusFilter;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", String(isActive));
  });

  renderDashboard();
});

nameSearch.addEventListener("input", () => renderDashboard());
gradeFilter.addEventListener("change", () => renderDashboard());

function showStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.style.color = isError ? "var(--ds-danger)" : "var(--ds-primary)";
}

function clearStatus() {
  statusMessage.textContent = "";
}
