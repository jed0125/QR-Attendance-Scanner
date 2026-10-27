import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import { getFirestore, collection, query, where, getDocs, onSnapshot, orderBy } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";
import { app } from "./firebase-config.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";
import {
  DEFAULT_SETTINGS,
  todayLogDay,
  getDayStatus,
  summarize,
  getMonthLogDayRange,
  formatLogDay,
  formatManilaTime,
  getStatusDisplay
} from "./school-calendar.js";
import "./site-config.js";

const auth = getAuth(app);
const db = getFirestore(app);

const parentEmailEl = document.querySelector("#parent-email");
const signoutButton = document.querySelector("#signout-button");
const mainContent = document.querySelector("#main-content");
const pageFooter = document.querySelector("#page-footer");
const statusMessage = document.querySelector("#status-message");
const childSwitcher = document.querySelector("#child-switcher");
const childSelect = document.querySelector("#child-select");
const childPillNav = document.querySelector("#child-pill-nav");
const tabNav = document.querySelector("#tab-nav");
const tabButtons = document.querySelectorAll(".tab-button");
const tabPanels = {
  today: document.querySelector("#panel-today"),
  history: document.querySelector("#panel-history"),
  summary: document.querySelector("#panel-summary")
};
const todayContainer = document.querySelector("#today-container");
const todayEmpty = document.querySelector("#today-empty");
const historyBody = document.querySelector("#history-body");
const historyEmpty = document.querySelector("#history-empty");
const monthDisplay = document.querySelector("#month-display");
const prevMonthBtn = document.querySelector("#prev-month");
const nextMonthBtn = document.querySelector("#next-month");
const summaryGrid = document.querySelector("#summary-grid");
const lateDatesList = document.querySelector("#late-dates");
const absentDatesList = document.querySelector("#absent-dates");
const emptyState = document.querySelector("#empty-state");

let currentEmail = null;
let students = [];
let currentStudentIndex = 0;
let settings = { ...DEFAULT_SETTINGS };
let attendanceUnsubscribe = null;
let historyUnsubscribe = null;
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();

// Hide page content until auth resolves
document.body.style.visibility = "hidden";

// Guard: wait for auth state
onAuthStateChanged(auth, async (user) => {
  if (!user || !user.emailVerified || !user.email) {
    location.href = "parent-login.html";
    return;
  }

  currentEmail = user.email.toLowerCase();
  parentEmailEl.textContent = currentEmail;
  document.body.style.visibility = "";
  mainContent.hidden = false;
  pageFooter.hidden = false;

  await loadSettings();
  await loadStudents();
});

// Sign out handler
signoutButton.addEventListener("click", async () => {
  signoutButton.disabled = true;
  cleanupListeners();
  try {
    await signOut(auth);
    location.href = "parent-login.html";
  } catch (error) {
    console.error("Unable to sign out parent:", error);
    showStatus("Unable to sign out right now. Please try again.", true);
    signoutButton.disabled = false;
  }
});

function showStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.style.color = isError ? "var(--ds-danger)" : "var(--ds-primary)";
}

function clearStatus() {
  statusMessage.textContent = "";
}

function cleanupListeners() {
  if (attendanceUnsubscribe) {
    attendanceUnsubscribe();
    attendanceUnsubscribe = null;
  }
  if (historyUnsubscribe) {
    historyUnsubscribe();
    historyUnsubscribe = null;
  }
}

// Load school settings
async function loadSettings() {
  try {
    const settingsRef = doc(db, "settings", "school");
    const snap = await getDoc(settingsRef);
    if (snap.exists()) {
      settings = { ...DEFAULT_SETTINGS, ...snap.data() };
    }
  } catch (error) {
    console.error("Failed to load settings:", error);
    settings = { ...DEFAULT_SETTINGS };
  }
}

// Load approved children for this guardian
async function loadStudents() {
  showStatus("Loading your children…");
  try {
    const studentsQuery = query(
      collection(db, "students"),
      where("guardianEmail", "==", currentEmail),
      where("approved", "==", true)
    );
    const studentsSnapshot = await getDocs(studentsQuery);
    students = studentsSnapshot.docs
      .map((studentDoc) => ({ id: studentDoc.id, ...studentDoc.data() }))
      .sort((a, b) => (a.studentName || "").localeCompare(b.studentName || ""));

    if (students.length === 0) {
      emptyState.hidden = false;
      childSwitcher.hidden = true;
      tabNav.hidden = true;
      Object.values(tabPanels).forEach(p => p.hidden = true);
      clearStatus();
      return;
    }

    emptyState.hidden = true;

    // Populate child switcher as pill buttons
    if (childPillNav) {
      childPillNav.replaceChildren();
      students.forEach((student, index) => {
        const pill = document.createElement("button");
        pill.type = "button";
        pill.className = "child-pill" + (index === 0 ? " active" : "");
        pill.textContent = student.studentName;
        pill.addEventListener("click", () => switchChild(index));
        childPillNav.appendChild(pill);
      });
    }

    childSwitcher.hidden = students.length <= 1;
    tabNav.hidden = false;

    // Load first child
    currentStudentIndex = 0;
    await switchChild(0);

    // Set up tab handlers
    tabButtons.forEach(btn => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });

    // Set up month navigation
    prevMonthBtn.addEventListener("click", () => navigateMonth(-1));
    nextMonthBtn.addEventListener("click", () => navigateMonth(1));

    clearStatus();
  } catch (error) {
    console.error("Unable to load parent students:", error);
    emptyState.hidden = true;
    showStatus("Your children could not be loaded. Please refresh the page.", true);
  }
}

async function switchChild(index) {
  if (index < 0 || index >= students.length) return;
  currentStudentIndex = index;

  if (childPillNav) {
    const pills = childPillNav.querySelectorAll(".child-pill");
    pills.forEach((p, i) => {
      p.classList.toggle("active", i === index);
    });
  }

  cleanupListeners();
  await loadTodayAttendance();
  await loadHistoryAttendance();
  await loadSummaryAttendance();
}

function switchTab(tabName) {
  tabButtons.forEach(btn => {
    const isActive = btn.dataset.tab === tabName;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", String(isActive));
  });

  Object.entries(tabPanels).forEach(([key, panel]) => {
    panel.hidden = key !== tabName;
  });
}

function navigateMonth(delta) {
  currentMonth += delta;
  if (currentMonth < 0) {
    currentMonth = 11;
    currentYear--;
  } else if (currentMonth > 11) {
    currentMonth = 0;
    currentYear++;
  }
  loadHistoryAttendance();
  loadSummaryAttendance();
}

function getCurrentStudent() {
  return students[currentStudentIndex];
}

function getApprovedLogDay(student) {
  if (student.approvedAt) {
    const millis = student.approvedAt.toMillis ? student.approvedAt.toMillis() : (student.approvedAt.seconds ? student.approvedAt.seconds * 1000 : 0);
    if (millis) return Math.floor((millis + 8 * 3600 * 1000) / (24 * 3600 * 1000));
  }
  if (student.createdAt) {
    const millis = student.createdAt.toMillis ? student.createdAt.toMillis() : (student.createdAt.seconds ? student.createdAt.seconds * 1000 : 0);
    if (millis) return Math.floor((millis + 8 * 3600 * 1000) / (24 * 3600 * 1000));
  }
  return 0;
}

// Load today's attendance for the current child
async function loadTodayAttendance() {
  const student = getCurrentStudent();
  if (!student) return;

  const logDay = todayLogDay();
  const approvedLogDay = getApprovedLogDay(student);
  const nowMillis = Date.now();

  const attendanceQuery = query(
    collection(db, "attendance"),
    where("guardianEmail", "==", currentEmail),
    where("studentId", "==", student.id),
    where("logDay", "==", logDay)
  );

  todayContainer.replaceChildren();
  todayEmpty.hidden = true;

  attendanceUnsubscribe = onSnapshot(attendanceQuery, (snapshot) => {
    const attendanceDocs = [];
    snapshot.forEach(docSnap => attendanceDocs.push({ id: docSnap.id, ...docSnap.data() }));

    const status = getDayStatus({
      logDay,
      settings,
      approvedLogDay,
      timeInMillis: attendanceDocs.find(d => d.type === "time_in")?.createdAt?.toMillis
        ? attendanceDocs.find(d => d.type === "time_in").createdAt.toMillis()
        : null,
      timeOutMillis: attendanceDocs.find(d => d.type === "time_out")?.createdAt?.toMillis
        ? attendanceDocs.find(d => d.type === "time_out").createdAt.toMillis()
        : null,
      nowMillis
    });

    renderTodayStatus(student, attendanceDocs, status);
  }, (error) => {
    console.error("Today attendance listener error:", error);
    todayEmpty.hidden = false;
    todayEmpty.textContent = "Unable to load today's attendance.";
  });
}

function renderTodayStatus(student, attendanceDocs, status) {
  todayContainer.replaceChildren();
  todayEmpty.hidden = true;

  const card = document.createElement("article");
  card.className = "card";
  card.style.padding = "24px";

  const headerRow = document.createElement("div");
  headerRow.style.display = "flex";
  headerRow.style.justifyContent = "space-between";
  headerRow.style.alignItems = "baseline";
  headerRow.style.flexWrap = "wrap";
  headerRow.style.gap = "8px";
  headerRow.style.marginBottom = "14px";

  const nameEl = document.createElement("h3");
  nameEl.style.fontSize = "1.25rem";
  nameEl.textContent = student.studentName;
  if (student.gradeSection) {
    const gradeEl = document.createElement("span");
    gradeEl.style.fontSize = "0.875rem";
    gradeEl.style.fontWeight = "400";
    gradeEl.style.color = "var(--ds-text-soft)";
    gradeEl.textContent = ` — ${student.gradeSection}`;
    nameEl.appendChild(gradeEl);
  }
  headerRow.appendChild(nameEl);

  const display = getStatusDisplay(status.status);
  const chip = document.createElement("span");
  chip.className = `chip ${display.className}`;
  chip.textContent = display.text;
  headerRow.appendChild(chip);

  card.appendChild(headerRow);

  // Time details
  if (attendanceDocs.length > 0) {
    const detailsEl = document.createElement("div");
    detailsEl.style.display = "grid";
    detailsEl.style.gap = "8px";
    detailsEl.style.paddingTop = "14px";
    detailsEl.style.borderTop = "1px solid var(--ds-border)";

    attendanceDocs.forEach(att => {
      const item = document.createElement("div");
      item.style.fontSize = "0.9375rem";
      item.style.fontWeight = "600";
      const typeLabel = att.type === "time_in" ? "Arrived" : "Left";
      const timeStr = formatManilaTime(att.createdAt?.toMillis ? att.createdAt.toMillis() : (att.createdAt?.seconds ? att.createdAt.seconds * 1000 : 0));
      item.textContent = `${typeLabel} at ${timeStr}`;
      item.style.color = att.type === "time_in" ? "var(--ds-primary)" : "#8A4A0B";
      detailsEl.appendChild(item);
    });

    if (status.missingTimeOut) {
      const note = document.createElement("div");
      note.style.fontSize = "0.875rem";
      note.style.color = "#8A4A0B";
      note.style.fontWeight = "600";
      note.textContent = "⚠️ No time-out recorded";
      detailsEl.appendChild(note);
    }

    card.appendChild(detailsEl);
  } else {
    const noScans = document.createElement("p");
    noScans.style.fontSize = "0.9375rem";
    noScans.style.color = "var(--ds-text-muted)";
    noScans.style.paddingTop = "10px";
    noScans.style.borderTop = "1px solid var(--ds-border)";
    noScans.textContent = "No check-in or check-out scans recorded for today yet.";
    card.appendChild(noScans);
  }

  todayContainer.appendChild(card);
}

// Load history attendance for the current child and month
async function loadHistoryAttendance() {
  const student = getCurrentStudent();
  if (!student) return;

  const { firstLogDay, lastLogDay } = getMonthLogDayRange(currentYear, currentMonth);
  monthDisplay.textContent = new Date(currentYear, currentMonth, 1).toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "long"
  });

  historyBody.replaceChildren();
  historyEmpty.hidden = true;

  const attendanceQuery = query(
    collection(db, "attendance"),
    where("guardianEmail", "==", currentEmail),
    where("logDay", ">=", firstLogDay),
    where("logDay", "<=", lastLogDay),
    orderBy("logDay"),
    orderBy("createdAt")
  );

  const approvedLogDay = getApprovedLogDay(student);

  historyUnsubscribe = onSnapshot(attendanceQuery, (snapshot) => {
    const byDayAndStudent = new Map();
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      const key = `${data.logDay}-${data.studentId}`;
      if (!byDayAndStudent.has(key)) {
        byDayAndStudent.set(key, { timeIn: null, timeOut: null });
      }
      const entry = byDayAndStudent.get(key);
      if (data.type === "time_in") entry.timeIn = data;
      else entry.timeOut = data;
    });

    historyBody.replaceChildren();
    const rows = [];
    for (let logDay = firstLogDay; logDay <= lastLogDay; logDay++) {
      if (logDay > todayLogDay()) break;
      const entry = byDayAndStudent.get(`${logDay}-${student.id}`);
      const timeIn = entry?.timeIn || null;
      const timeOut = entry?.timeOut || null;

      const status = getDayStatus({
        logDay,
        settings,
        approvedLogDay,
        timeInMillis: timeIn?.createdAt?.toMillis ? timeIn.createdAt.toMillis() : (timeIn?.createdAt?.seconds ? timeIn.createdAt.seconds * 1000 : null),
        timeOutMillis: timeOut?.createdAt?.toMillis ? timeOut.createdAt.toMillis() : (timeOut?.createdAt?.seconds ? timeOut.createdAt.seconds * 1000 : null),
        nowMillis: Date.now()
      });

      const display = getStatusDisplay(status.status);

      const row = document.createElement("div");
      row.className = "history-day-row";

      // Left: Date & Weekday
      const left = document.createElement("div");
      left.className = "history-day-left";
      const dateSpan = document.createElement("span");
      dateSpan.className = "history-day-date";
      dateSpan.textContent = formatLogDay(logDay);
      const wdSpan = document.createElement("span");
      wdSpan.className = "history-day-weekday";
      const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const jsDate = new Date(logDay * 24 * 3600 * 1000);
      wdSpan.textContent = wd[jsDate.getUTCDay()];
      left.appendChild(dateSpan);
      left.appendChild(wdSpan);
      row.appendChild(left);

      // Center: In / Out Times
      const times = document.createElement("div");
      times.className = "history-day-times";
      const timeInStr = timeIn ? formatManilaTime(timeIn.createdAt.toMillis ? timeIn.createdAt.toMillis() : timeIn.createdAt.seconds * 1000) : "—";
      const timeOutStr = timeOut ? formatManilaTime(timeOut.createdAt.toMillis ? timeOut.createdAt.toMillis() : timeOut.createdAt.seconds * 1000) : "—";
      if (timeIn || timeOut) {
        times.textContent = `In: ${timeInStr} · Out: ${timeOutStr}`;
      } else {
        times.textContent = "—";
      }
      row.appendChild(times);

      // Right: Status Chip
      const right = document.createElement("div");
      right.className = "history-day-right";
      const chip = document.createElement("span");
      chip.className = `chip ${display.className}`;
      chip.textContent = display.text;
      right.appendChild(chip);

      if (status.missingTimeOut) {
        const warn = document.createElement("span");
        warn.className = "missing-timeout-note";
        warn.textContent = "⚠️ No out";
        right.appendChild(warn);
      }
      row.appendChild(right);

      rows.push(row);
    }

    if (rows.length === 0) {
      historyEmpty.hidden = false;
    } else {
      historyEmpty.hidden = true;
      historyBody.append(...rows);
    }
  }, (error) => {
    console.error("History attendance listener error:", error);
    historyEmpty.hidden = false;
    historyEmpty.textContent = "Unable to load attendance history.";
  });
}

// Load summary attendance for the current child and month
async function loadSummaryAttendance() {
  const student = getCurrentStudent();
  if (!student) return;

  const { firstLogDay, lastLogDay } = getMonthLogDayRange(currentYear, currentMonth);
  const approvedLogDay = getApprovedLogDay(student);

  const attendanceQuery = query(
    collection(db, "attendance"),
    where("guardianEmail", "==", currentEmail),
    where("logDay", ">=", firstLogDay),
    where("logDay", "<=", lastLogDay),
    orderBy("logDay"),
    orderBy("createdAt")
  );

  try {
    const snapshot = await getDocs(attendanceQuery);
    const byDayAndStudent = new Map();
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      const key = `${data.logDay}-${data.studentId}`;
      if (!byDayAndStudent.has(key)) {
        byDayAndStudent.set(key, { timeIn: null, timeOut: null });
      }
      const entry = byDayAndStudent.get(key);
      if (data.type === "time_in") entry.timeIn = data;
      else entry.timeOut = data;
    });

    const days = [];
    for (let logDay = firstLogDay; logDay <= lastLogDay; logDay++) {
      if (logDay > todayLogDay()) break;
      const entry = byDayAndStudent.get(`${logDay}-${student.id}`);
      const timeIn = entry?.timeIn || null;
      const timeOut = entry?.timeOut || null;

      const status = getDayStatus({
        logDay,
        settings,
        approvedLogDay,
        timeInMillis: timeIn?.createdAt?.toMillis ? timeIn.createdAt.toMillis() : (timeIn?.createdAt?.seconds ? timeIn.createdAt.seconds * 1000 : null),
        timeOutMillis: timeOut?.createdAt?.toMillis ? timeOut.createdAt.toMillis() : (timeOut?.createdAt?.seconds ? timeOut.createdAt.seconds * 1000 : null),
        nowMillis: Date.now()
      });
      days.push({ logDay, ...status });
    }

    renderSummary(student, days);
  } catch (error) {
    console.error("Summary attendance error:", error);
    summaryGrid.replaceChildren();
    const p = document.createElement("p");
    p.textContent = "Unable to load summary.";
    summaryGrid.appendChild(p);
  }
}

function renderSummary(student, days) {
  const summary = summarize(days);

  summaryGrid.replaceChildren();
  const stats = [
    { label: "School days", value: summary.schoolDays },
    { label: "Present", value: summary.present },
    { label: "Late", value: summary.late },
    { label: "Absent", value: summary.absent },
    { label: "Attendance rate", value: `${summary.attendanceRate}%` }
  ];

  stats.forEach(s => {
    const card = document.createElement("div");
    card.className = "stat-card";
    const label = document.createElement("div");
    label.className = "stat-card__label";
    label.textContent = s.label;
    card.appendChild(label);
    const value = document.createElement("div");
    value.className = "stat-card__value";
    value.textContent = s.value;
    card.appendChild(value);
    summaryGrid.appendChild(card);
  });

  // Late dates
  lateDatesList.replaceChildren();
  const lateDays = days.filter(d => d.status === "late");
  if (lateDays.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No late days this month.";
    li.style.color = "var(--ds-text-muted)";
    lateDatesList.appendChild(li);
  } else {
    lateDays.forEach(d => {
      const li = document.createElement("li");
      li.textContent = formatLogDay(d.logDay);
      lateDatesList.appendChild(li);
    });
  }

  // Absent dates
  absentDatesList.replaceChildren();
  const absentDays = days.filter(d => d.status === "absent");
  if (absentDays.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No absent days this month.";
    li.style.color = "var(--ds-text-muted)";
    absentDatesList.appendChild(li);
  } else {
    absentDays.forEach(d => {
      const li = document.createElement("li");
      li.textContent = formatLogDay(d.logDay);
      absentDatesList.appendChild(li);
    });
  }
}
