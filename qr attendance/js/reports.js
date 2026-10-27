import { getFirestore, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";
import { app } from "./firebase-config.js";
import { initAuthGuard, getCurrentStaff, hidePageContent, showPageContent, signOutAndRedirect } from "./auth-guard.js";
import { initStaffNav } from "./nav.js";
import { DEFAULT_SETTINGS, todayLogDay, DAY_MS, getDayStatus, summarize, getStatusDisplay, formatLogDay, dayToDateString, weekdayMon1 } from "./school-calendar.js";
import { downloadCsv } from "./csv.js";

const db = getFirestore(app);

// DOM elements
const statusMessage = document.querySelector("#status-message");
const mainContent = document.querySelector("#main-content");
const pageFooter = document.querySelector("#page-footer");
const readCountMessage = document.querySelector("#read-count-message");

const fromDate = document.querySelector("#from-date");
const toDate = document.querySelector("#to-date");
const fromDateError = document.querySelector("#from-date-error");
const toDateError = document.querySelector("#to-date-error");
const gradeFilter = document.querySelector("#report-grade-filter");
const nameSearch = document.querySelector("#report-name-search");
const generateButton = document.querySelector("#generate-button");
const exportCsvButton = document.querySelector("#export-csv-button");
const printButton = document.querySelector("#print-button");

const summaryTable = document.querySelector("#summary-table");
const summaryBody = document.querySelector("#summary-body");
const summaryEmpty = document.querySelector("#summary-empty");

const detailSection = document.querySelector("#detail-section");
const detailStudentName = document.querySelector("#detail-student-name");
const detailGradeSection = document.querySelector("#detail-grade-section");
const backButton = document.querySelector("#back-button");
const detailExportCsv = document.querySelector("#detail-export-csv");
const detailTable = document.querySelector("#detail-table");
const detailBody = document.querySelector("#detail-body");
const detailEmpty = document.querySelector("#detail-empty");

// State
let settings = { ...DEFAULT_SETTINGS };
let students = [];
let studentMap = new Map();
let allReportData = []; // Full report data for export
let currentDetailStudent = null;
let sortColumn = "rate";
let sortDirection = "desc";

// Hide page content until auth resolves
hidePageContent();

// Initialize auth guard
initAuthGuard().then((staff) => {
  if (!staff) {
    window.location.href = "login.html";
    return;
  }

  initStaffNav("reports.html");
  showPageContent();
  mainContent.hidden = false;
  pageFooter.hidden = false;

  loadSettings();
  setupEventListeners();
});

// Load school settings
async function loadSettings() {
  try {
    const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js");
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

// Load all approved students
async function loadStudents() {
  try {
    const studentsRef = collection(db, "students");
    const q = query(studentsRef, where("approved", "==", true));
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

    // Populate grade filter
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

    // Set default date range: last 30 days (Manila calendar dates)
    const todayLogDayValue = todayLogDay();
    toDate.value = dayToDateString(todayLogDayValue);
    fromDate.value = dayToDateString(todayLogDayValue - 30);
  } catch (error) {
    console.error("Failed to load students:", error);
    showStatus("Failed to load students.", true);
  }
}

function formatDateForInput(date) {
  return date.toISOString().slice(0, 10);
}

function setupEventListeners() {
  generateButton.addEventListener("click", generateReport);
  exportCsvButton.addEventListener("click", exportSummaryCsv);
  printButton.addEventListener("click", () => window.print());
  backButton.addEventListener("click", () => showSummaryView());
  detailExportCsv.addEventListener("click", exportDetailCsv);

  // Sortable headers
  summaryTable.querySelectorAll("th[data-sort]").forEach((th) => {
    th.style.cursor = "pointer";
    th.addEventListener("click", () => {
      const column = th.dataset.sort;
      if (sortColumn === column) {
        sortDirection = sortDirection === "asc" ? "desc" : "asc";
      } else {
        sortColumn = column;
        sortDirection = "desc";
      }
      updateSortIndicators();
      renderSummaryTable();
    });
  });

  // Enter key in date inputs triggers generate
  fromDate.addEventListener("keydown", (e) => { if (e.key === "Enter") generateReport(); });
  toDate.addEventListener("keydown", (e) => { if (e.key === "Enter") generateReport(); });
}

function validateDates() {
  fromDateError.textContent = "";
  toDateError.textContent = "";
  let valid = true;

  const from = fromDate.value;
  const to = toDate.value;

  if (!from) {
    fromDateError.textContent = "From date is required.";
    valid = false;
  }
  if (!to) {
    toDateError.textContent = "To date is required.";
    valid = false;
  }
  if (from && to && from > to) {
    toDateError.textContent = "To date must be on or after from date.";
    valid = false;
  }
  if (from && to) {
    const fromTime = new Date(from).getTime();
    const toTime = new Date(to).getTime();
    const diffDays = Math.floor((toTime - fromTime) / (24 * 3600 * 1000)) + 1;
    if (diffDays > 93) {
      toDateError.textContent = "Maximum range is 93 days.";
      valid = false;
    }
  }

  return valid;
}

async function generateReport() {
  if (!validateDates()) return;

  showStatus("Generating report…");
  generateButton.disabled = true;
  exportCsvButton.disabled = true;
  printButton.disabled = true;
  summaryBody.replaceChildren();
  summaryEmpty.hidden = true;
  readCountMessage.textContent = "";

  try {
    const fromLogDay = dateToLogDay(fromDate.value);
    const toLogDay = dateToLogDay(toDate.value);
    const gradeValue = gradeFilter.value;
    const searchTerm = nameSearch.value.toLowerCase().trim();

    // Query attendance in range
    const attendanceRef = collection(db, "attendance");
    // Range filter on a single field (logDay) — no composite index required.
    const q = query(
      attendanceRef,
      where("logDay", ">=", fromLogDay),
      where("logDay", "<=", toLogDay)
    );

    const snapshot = await getDocs(q);
    readCountMessage.textContent = `Documents read: ${snapshot.size}`;

    // Group by studentId
    const byStudent = new Map();
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const studentId = data.studentId;
      if (!byStudent.has(studentId)) {
        byStudent.set(studentId, []);
      }
      byStudent.get(studentId).push(data);
    });

    // Build report for each student
    const reportRows = [];
    for (const student of students) {
      if (gradeValue && student.gradeSection !== gradeValue) continue;
      if (searchTerm && !(student.studentName || "").toLowerCase().includes(searchTerm)) continue;

      const attendanceRecords = byStudent.get(student.id) || [];

      // Get approvedLogDay
      let approvedLogDay = 0;
      if (student.approvedAt) {
        const millis = student.approvedAt.toMillis ? student.approvedAt.toMillis() : (student.approvedAt.seconds ? student.approvedAt.seconds * 1000 : 0);
        if (millis) approvedLogDay = Math.floor((millis + 8 * 3600 * 1000) / (24 * 3600 * 1000));
      } else if (student.createdAt) {
        const millis = student.createdAt.toMillis ? student.createdAt.toMillis() : (student.createdAt.seconds ? student.createdAt.seconds * 1000 : 0);
        if (millis) approvedLogDay = Math.floor((millis + 8 * 3600 * 1000) / (24 * 3600 * 1000));
      }

      // Build day-by-day status
      const days = [];
      for (let logDay = fromLogDay; logDay <= toLogDay; logDay++) {
        if (logDay > todayLogDay()) break; // Don't include future days

        const dayRecords = attendanceRecords.filter((r) => r.logDay === logDay);
        const timeIn = dayRecords.find((r) => r.type === "time_in");
        const timeOut = dayRecords.find((r) => r.type === "time_out");
        const timeInMillis = timeIn?.createdAt?.toMillis ? timeIn.createdAt.toMillis() : (timeIn?.createdAt?.seconds ? timeIn.createdAt.seconds * 1000 : null);
        const timeOutMillis = timeOut?.createdAt?.toMillis ? timeOut.createdAt.toMillis() : (timeOut?.createdAt?.seconds ? timeOut.createdAt.seconds * 1000 : null);

        const status = getDayStatus({
          logDay,
          settings,
          approvedLogDay,
          timeInMillis,
          timeOutMillis,
          nowMillis: Date.now()
        });
        days.push({ logDay, ...status, timeInMillis, timeOutMillis });
      }

      const summary = summarize(days);
      reportRows.push({
        student,
        days,
        summary
      });
    }

    allReportData = reportRows;
    sortColumn = "rate";
    sortDirection = "desc";
    renderSummaryTable();

    exportCsvButton.disabled = reportRows.length === 0;
    printButton.disabled = reportRows.length === 0;
    showStatus(reportRows.length === 0 ? "No data for the selected range and filters." : `Report generated: ${reportRows.length} students.`, false);
  } catch (error) {
    console.error("Failed to generate report:", error);
    showStatus("Failed to generate report. Please try again.", true);
  } finally {
    generateButton.disabled = false;
  }
}

function dateToLogDay(dateStr) {
  const date = new Date(dateStr + "T00:00:00+08:00");
  return Math.floor((date.getTime() + 8 * 3600 * 1000) / (24 * 3600 * 1000));
}

function updateSortIndicators() {
  summaryTable.querySelectorAll("th[data-sort]").forEach((th) => {
    const indicator = th.querySelector(".sort-indicator");
    if (th.dataset.sort === sortColumn) {
      indicator.textContent = sortDirection === "asc" ? " ▲" : " ▼";
    } else {
      indicator.textContent = "";
    }
  });
}

function renderSummaryTable() {
  if (allReportData.length === 0) {
    summaryEmpty.hidden = false;
    summaryTable.hidden = true;
    return;
  }

  summaryEmpty.hidden = true;
  summaryTable.hidden = false;

  // Sort data
  const sorted = [...allReportData].sort((a, b) => {
    let valA, valB;
    switch (sortColumn) {
      case "student": valA = a.student.studentName || ""; valB = b.student.studentName || ""; break;
      case "grade": valA = a.student.gradeSection || ""; valB = b.student.gradeSection || ""; break;
      case "schoolDays": valA = a.summary.schoolDays; valB = b.summary.schoolDays; break;
      case "present": valA = a.summary.present; valB = b.summary.present; break;
      case "late": valA = a.summary.late; valB = b.summary.late; break;
      case "absent": valA = a.summary.absent; valB = b.summary.absent; break;
      case "missingTimeOut": valA = a.summary.missingTimeOut; valB = b.summary.missingTimeOut; break;
      case "rate": valA = a.summary.attendanceRate; valB = b.summary.attendanceRate; break;
      default: return 0;
    }
    if (typeof valA === "string") {
      return sortDirection === "asc" ? valA.localeCompare(valB) : valB.localeCompare(valA);
    }
    return sortDirection === "asc" ? valA - valB : valB - valA;
  });

  summaryBody.replaceChildren();

  for (const row of sorted) {
    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";
    tr.addEventListener("click", () => showDetailView(row));

    // Student name
    const nameCell = document.createElement("td");
    nameCell.textContent = row.student.studentName || "—";
    tr.appendChild(nameCell);

    // Grade/Section
    const gradeCell = document.createElement("td");
    gradeCell.textContent = row.student.gradeSection || "—";
    tr.appendChild(gradeCell);

    // School days
    const schoolDaysCell = document.createElement("td");
    schoolDaysCell.textContent = String(row.summary.schoolDays);
    tr.appendChild(schoolDaysCell);

    // Present
    const presentCell = document.createElement("td");
    presentCell.textContent = String(row.summary.present);
    tr.appendChild(presentCell);

    // Late
    const lateCell = document.createElement("td");
    lateCell.textContent = String(row.summary.late);
    tr.appendChild(lateCell);

    // Absent
    const absentCell = document.createElement("td");
    absentCell.textContent = String(row.summary.absent);
    tr.appendChild(absentCell);

    // Missing time-out
    const missingCell = document.createElement("td");
    missingCell.textContent = String(row.summary.missingTimeOut);
    tr.appendChild(missingCell);

    // Attendance rate
    const rateCell = document.createElement("td");
    const rate = row.summary.attendanceRate;
    rateCell.textContent = `${rate}%`;
    if (row.summary.schoolDays > 0 && rate < 90) {
      const lowChip = document.createElement("span");
      lowChip.className = "chip chip--absent";
      lowChip.textContent = "Low";
      lowChip.style.marginLeft = "8px";
      rateCell.appendChild(lowChip);
    }
    tr.appendChild(rateCell);

    summaryBody.appendChild(tr);
  }

  updateSortIndicators();
}

function showDetailView(rowData) {
  currentDetailStudent = rowData;
  detailStudentName.textContent = rowData.student.studentName || "—";
  detailGradeSection.textContent = rowData.student.gradeSection ? `Grade/Section: ${rowData.student.gradeSection}` : "";
  detailSection.hidden = false;
  detailBody.replaceChildren();
  detailEmpty.hidden = true;

  if (rowData.days.length === 0) {
    detailEmpty.hidden = false;
    detailTable.hidden = true;
    return;
  }

  detailTable.hidden = false;
  for (const day of rowData.days) {
    const tr = document.createElement("tr");
    const display = getStatusDisplay(day.status);

    // Date
    const dateCell = document.createElement("td");
    dateCell.textContent = formatLogDay(day.logDay);
    tr.appendChild(dateCell);

    // Weekday
    const weekdayCell = document.createElement("td");
    const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    weekdayCell.textContent = dayNames[weekdayMon1(day.logDay) - 1];
    tr.appendChild(weekdayCell);

    // Time in
    const timeInCell = document.createElement("td");
    timeInCell.textContent = day.timeInMillis ? formatManilaTime(day.timeInMillis) : "—";
    tr.appendChild(timeInCell);

    // Time out
    const timeOutCell = document.createElement("td");
    timeOutCell.textContent = day.timeOutMillis ? formatManilaTime(day.timeOutMillis) : "—";
    tr.appendChild(timeOutCell);

    // Status
    const statusCell = document.createElement("td");
    const chip = document.createElement("span");
    chip.className = `chip ${display.className}`;
    chip.textContent = display.text;
    if (day.missingTimeOut) {
      const note = document.createElement("span");
      note.className = "missing-timeout-note";
      note.textContent = " (No time-out)";
      chip.appendChild(note);
    }
    statusCell.appendChild(chip);
    tr.appendChild(statusCell);

    detailBody.appendChild(tr);
  }
}

function showSummaryView() {
  detailSection.hidden = true;
  currentDetailStudent = null;
}

function exportSummaryCsv() {
  if (allReportData.length === 0) return;

  const rows = [
    ["Student name", "Grade/Section", "School days", "Present", "Late", "Absent", "Missing time-out", "Attendance rate"]
  ];

  for (const row of allReportData) {
    rows.push([
      row.student.studentName || "",
      row.student.gradeSection || "",
      String(row.summary.schoolDays),
      String(row.summary.present),
      String(row.summary.late),
      String(row.summary.absent),
      String(row.summary.missingTimeOut),
      `${row.summary.attendanceRate}%`
    ]);
  }

  const fromStr = fromDate.value.replace(/-/g, "");
  const toStr = toDate.value.replace(/-/g, "");
  downloadCsv(`attendance-report-${fromStr}-to-${toStr}`, rows);
}

function exportDetailCsv() {
  if (!currentDetailStudent) return;

  const rows = [
    ["Date", "Weekday", "Time in", "Time out", "Status"]
  ];

  for (const day of currentDetailStudent.days) {
    const wdNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const weekday = wdNames[weekdayMon1(day.logDay) - 1];
    const display = getStatusDisplay(day.status);
    let statusText = display.text;
    if (day.missingTimeOut) statusText += " (No time-out)";

    rows.push([
      formatLogDay(day.logDay),
      weekday,
      day.timeInMillis ? formatManilaTime(day.timeInMillis) : "",
      day.timeOutMillis ? formatManilaTime(day.timeOutMillis) : "",
      statusText
    ]);
  }

  const studentName = currentDetailStudent.student.studentName.replace(/\s+/g, "-");
  downloadCsv(`attendance-detail-${studentName}-${fromDate.value}-to-${toDate.value}`, rows);
}

function showStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.style.color = isError ? "#b42318" : "#28745e";
}