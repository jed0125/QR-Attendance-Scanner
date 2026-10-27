import { getFirestore, doc, getDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";

function formatApprovalDate(timestamp) {
  if (!timestamp) return "\u2014";
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

function renderStudents() {
  const searchTerm = nameSearch.value.toLowerCase().trim();
  const gradeValue = gradeFilter.value;

  const visible = students.filter((s) => {
    if (searchTerm && !(s.studentName || "").toLowerCase().includes(searchTerm)) return false;
    if (gradeValue && s.gradeSection !== gradeValue) return false;
    return true;
  });

  const allVisibleSelected =
    visible.length > 0 && visible.every((s) => selectedIds.has(s.id));
  const someVisibleSelected = visible.some((s) => selectedIds.has(s.id));
  selectAllHeader.checked = allVisibleSelected;
  selectAllHeader.indeterminate = !allVisibleSelected && someVisibleSelected;

  studentsBody.replaceChildren();
  if (visible.length === 0) {
    studentsEmpty.hidden = false;
    studentsTable.hidden = true;
    bulkActions.hidden = true;
    return;
  }

  studentsEmpty.hidden = true;
  studentsTable.hidden = false;
  bulkActions.hidden = false;

  for (const student of visible) {
    const tr = document.createElement("tr");
    tr.dataset.studentId = student.id;

    const cbCell = document.createElement("td");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = student.id;
    cb.checked = selectedIds.has(student.id);
    cb.setAttribute("aria-label", `Select ${student.studentName || "student"} for bulk actions`);
    cb.addEventListener("change", () => {
      if (cb.checked) selectedIds.add(student.id);
      else selectedIds.delete(student.id);
      updateBulkState();
      updateSelectAllHeader(visible);
    });
    cbCell.appendChild(cb);
    tr.appendChild(cbCell);

    const nameCell = document.createElement("td");
    nameCell.textContent = student.studentName || "\u2014";
    tr.appendChild(nameCell);

    const gradeCell = document.createElement("td");
    gradeCell.textContent = student.gradeSection || "\u2014";
    tr.appendChild(gradeCell);

    const guardianNameCell = document.createElement("td");
    guardianNameCell.textContent = student.guardianName || "\u2014";
    tr.appendChild(guardianNameCell);

    const guardianEmailCell = document.createElement("td");
    guardianEmailCell.textContent = student.guardianEmail || "\u2014";
    tr.appendChild(guardianEmailCell);

    const approvedCell = document.createElement("td");
    approvedCell.textContent = formatApprovalDate(student.approvedAt);
    tr.appendChild(approvedCell);

    const actionsCell = document.createElement("td");
    const showQrButton = document.createElement("button");
    showQrButton.type = "button";
    showQrButton.className = "action-button";
    showQrButton.textContent = "Show QR";
    showQrButton.addEventListener("click", () => showStudentQr(student));
    actionsCell.appendChild(showQrButton);
    tr.appendChild(actionsCell);

    studentsBody.appendChild(tr);
  }

  updateBulkState();
}

function updateSelectAllHeader(visible) {
  const allVisibleSelected =
    visible.length > 0 && visible.every((s) => selectedIds.has(s.id));
  const someVisibleSelected = visible.some((s) => selectedIds.has(s.id));
  selectAllHeader.checked = allVisibleSelected;
  selectAllHeader.indeterminate = !allVisibleSelected && someVisibleSelected;
}

function updateBulkState() {
  selectedCountEl.textContent = String(selectedIds.size);
  printQrCardsButton.disabled = selectedIds.size === 0;
}

import { app } from "./firebase-config.js";
import { initAuthGuard, getCurrentStaff, hidePageContent, showPageContent, signOutAndRedirect } from "./auth-guard.js";
import { initStaffNav } from "./nav.js";
import { DEFAULT_SETTINGS } from "./school-calendar.js";

const db = getFirestore(app);

// DOM elements
const statusMessage = document.querySelector("#status-message");
const mainContent = document.querySelector("#main-content");
const pageFooter = document.querySelector("#page-footer");

const nameSearch = document.querySelector("#student-name-search");
const gradeFilter = document.querySelector("#student-grade-filter");


// Filter handlers
nameSearch.addEventListener("input", () => renderStudents());
gradeFilter.addEventListener("change", () => renderStudents());

function currentVisible() {
  const searchTerm = nameSearch.value.toLowerCase().trim();
  const gradeValue = gradeFilter.value;
  return students.filter((s) => {
    if (searchTerm && !(s.studentName || "").toLowerCase().includes(searchTerm)) return false;
    if (gradeValue && s.gradeSection !== gradeValue) return false;
    return true;
  });
}

// Select all / clear selection (current filtered view)
selectAllHeader.addEventListener("change", () => {
  const visible = currentVisible();
  if (selectAllHeader.checked) {
    visible.forEach((s) => selectedIds.add(s.id));
  } else {
    visible.forEach((s) => selectedIds.delete(s.id));
  }
  renderStudents();
});

selectAllButton.addEventListener("click", () => {
  currentVisible().forEach((s) => selectedIds.add(s.id));
  renderStudents();
});

clearSelectionButton.addEventListener("click", () => {
  selectedIds.clear();
  renderStudents();
});

// --- QR code (single student) ---

function renderQr(container, text) {
  container.replaceChildren();
  if (typeof window.QRCode !== "function") {
    throw new Error("The QR code library did not load.");
  }
  new window.QRCode(container, {
    text,
    width: 256,
    height: 256,
    colorDark: "#10231d",
    colorLight: "#ffffff",
    correctLevel: window.QRCode.CorrectLevel.M
  });
}

function downloadQrPng(container, filename) {
  const canvas = container.querySelector("canvas");
  const image = container.querySelector("img");
  const imageUrl = canvas ? canvas.toDataURL("image/png") : image ? image.src : null;
  if (!imageUrl) {
    showStatus("The QR image is not ready to download.", true);
    return;
  }
  const link = document.createElement("a");
  link.href = imageUrl;
  link.download = filename;
  link.click();
}

function showStudentQr(student) {
  renderQr(qrCodeContainer, student.id);
  qrStudentName.textContent = student.studentName || "\u2014";
  qrGradeSection.textContent = student.gradeSection || "\u2014";
  qrDialog.showModal();

  const currentId = student.id;
  const currentFilename = `student-attendance-qr-${currentId}.png`;

  qrDownloadPng.onclick = () => downloadQrPng(qrCodeContainer, currentFilename);
  qrPrint.onclick = () => {
    qrDialog.close();
    printQrCards([currentId]);
  };
}

qrDialogClose.addEventListener("click", () => qrDialog.close());
qrDialog.addEventListener("click", (e) => {
  if (e.target === qrDialog) qrDialog.close();
});

// --- Print QR cards (selected students) ---

printQrCardsButton.addEventListener("click", () => {
  printQrCards([...selectedIds]);
});

function printQrCards(ids) {
  const schoolName = settings.schoolName || settings.name || "School";
  printSchoolName.textContent = schoolName;
  qrCardsGrid.replaceChildren();

  const validIds = ids.filter((id) => studentMap.has(id));
  if (validIds.length === 0) {
    showStatus("No valid students to print.", true);
    return;
  }

  document.body.classList.add("printing-qr-cards");

  for (const id of validIds) {
    const student = studentMap.get(id);

    const card = document.createElement("div");
    card.className = "qr-card";

    const qrDiv = document.createElement("div");
    qrDiv.className = "qr-card__qr";
    const qrInner = document.createElement("div");
    qrInner.id = `qr-print-${id}`;
    qrDiv.appendChild(qrInner);
    card.appendChild(qrDiv);

    const nameDiv = document.createElement("div");
    nameDiv.className = "qr-card__name";
    nameDiv.textContent = student.studentName || "\u2014";
    card.appendChild(nameDiv);

    const gradeDiv = document.createElement("div");
    gradeDiv.className = "qr-card__grade";
    gradeDiv.textContent = student.gradeSection || "\u2014";
    card.appendChild(gradeDiv);

    qrCardsGrid.appendChild(card);

    try {
      renderQr(qrInner, id);
    } catch (error) {
      console.error("QR render failed:", error);
    }
  }

  window.print();

  document.body.classList.remove("printing-qr-cards");
  qrCardsGrid.replaceChildren();
}

function showStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.style.color = isError ? "#b42318" : "#28745e";
}

