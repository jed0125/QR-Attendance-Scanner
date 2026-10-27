import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";
import { app } from "./firebase-config.js";
import { initAuthGuard, getCurrentStaff, hidePageContent, showPageContent, signOutAndRedirect } from "./auth-guard.js";
import { initStaffNav } from "./nav.js";
import { DEFAULT_SETTINGS } from "./school-calendar.js";

const db = getFirestore(app);

const mainContent = document.querySelector("#main-content");
const pageFooter = document.querySelector("#page-footer");
const statusMessage = document.querySelector("#status-message");
const settingsSection = document.querySelector(".settings-section");
const adminOnlyMessage = document.querySelector("#admin-only-message");
const form = document.querySelector("#settings-form");
const saveButton = document.querySelector("#save-button");
const formMessage = document.querySelector("#form-message");
const daysError = document.querySelector("#days-error");
const holidayError = document.querySelector("#holiday-error");
const holidayCount = document.querySelector("#holiday-count");
const holidayList = document.querySelector("#holiday-list");
const holidayInput = document.querySelector("#holiday-input");
const addHolidayButton = document.querySelector("#add-holiday-button");
const dayCheckboxes = document.querySelector("#day-checkboxes");

const DAYS_OF_WEEK = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 7, label: "Sunday" }
];

let holidays = [];
let isAdmin = false;

// Hide page content until auth resolves
hidePageContent();

// Initialize auth guard
initAuthGuard().then((staff) => {
  if (!staff) {
    window.location.href = "login.html";
    return;
  }

  initStaffNav("settings.html");
  isAdmin = staff.role === "admin";

  if (!isAdmin) {
    showPageContent();
    mainContent.hidden = false;
    pageFooter.hidden = false;
    adminOnlyMessage.hidden = false;
    settingsSection.hidden = true;
    return;
  }

  showPageContent();
  mainContent.hidden = false;
  pageFooter.hidden = false;
  adminOnlyMessage.hidden = true;
  settingsSection.hidden = false;

  renderDayCheckboxes();
  loadSettings();
});

// Sign out handler (button is rendered by the shared nav)
const signoutButton = document.querySelector("#signout-button");
if (signoutButton) {
  signoutButton.addEventListener("click", () => {
    signOutAndRedirect();
  });
}

// Render day checkboxes
function renderDayCheckboxes() {
  dayCheckboxes.replaceChildren();
  DAYS_OF_WEEK.forEach((day) => {
    const label = document.createElement("label");
    label.className = "day-checkbox-label";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = "schoolDays";
    checkbox.value = String(day.value);
    checkbox.id = `day-${day.value}`;
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(day.label));
    dayCheckboxes.appendChild(label);
  });
}

function showStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.style.color = isError ? "#b42318" : "#28745e";
}

function clearStatus() {
  statusMessage.textContent = "";
}

function setFieldError(fieldId, message) {
  const errorEl = document.querySelector(`#${fieldId}-error`);
  const inputEl = document.querySelector(`#${fieldId}`);
  if (errorEl) errorEl.textContent = message;
  if (inputEl) inputEl.setAttribute("aria-invalid", String(Boolean(message)));
}

function clearFieldErrors() {
  document.querySelectorAll(".field-error").forEach(el => el.textContent = "");
  document.querySelectorAll("input[aria-invalid]").forEach(el => el.setAttribute("aria-invalid", "false"));
}

async function loadSettings() {
  showStatus("Loading settings…");
  try {
    const settingsRef = doc(db, "settings", "school");
    const snap = await getDoc(settingsRef);

    let settings = { ...DEFAULT_SETTINGS };
    if (snap.exists()) {
      settings = { ...DEFAULT_SETTINGS, ...snap.data() };
    }

    // Fill form
    document.querySelector("#school-year-start").value = settings.schoolYearStart || "";
    document.querySelector("#school-year-end").value = settings.schoolYearEnd || "";
    document.querySelector("#late-after").value = settings.lateAfter || "08:00";
    document.querySelector("#absent-after").value = settings.absentAfter || "10:00";

    // Check day checkboxes
    (settings.schoolDays || DEFAULT_SETTINGS.schoolDays).forEach(d => {
      const cb = document.querySelector(`#day-${d}`);
      if (cb) cb.checked = true;
    });

    // Load holidays
    holidays = [...(settings.holidays || [])];
    renderHolidays();

    clearStatus();
  } catch (error) {
    console.error("Failed to load settings:", error);
    showStatus("Failed to load settings. Please refresh.", true);
  }
}

function renderHolidays() {
  holidayList.replaceChildren();
  holidays.sort().forEach((dateStr) => {
    const item = document.createElement("div");
    item.className = "holiday-item";
    item.setAttribute("role", "listitem");

    const dateEl = document.createElement("span");
    dateEl.textContent = formatDateDisplay(dateStr);
    item.appendChild(dateEl);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "holiday-remove";
    removeBtn.textContent = "Remove";
    removeBtn.setAttribute("aria-label", `Remove holiday ${dateStr}`);
    removeBtn.addEventListener("click", () => removeHoliday(dateStr));
    item.appendChild(removeBtn);

    holidayList.appendChild(item);
  });
  updateHolidayCount();
}

function updateHolidayCount() {
  holidayCount.textContent = `${holidays.length} / 100 holidays`;
}

function formatDateDisplay(dateStr) {
  // dateStr is YYYY-MM-DD
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function addHoliday() {
  const dateStr = holidayInput.value;
  if (!dateStr) {
    holidayError.textContent = "Select a date.";
    return;
  }
  if (holidays.length >= 100) {
    holidayError.textContent = "Maximum 100 holidays reached.";
    return;
  }
  if (holidays.includes(dateStr)) {
    holidayError.textContent = "This date is already in the list.";
    return;
  }
  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    holidayError.textContent = "Invalid date format.";
    return;
  }
  holidays.push(dateStr);
  holidays.sort();
  renderHolidays();
  holidayInput.value = "";
  holidayError.textContent = "";
}

function removeHoliday(dateStr) {
  holidays = holidays.filter(d => d !== dateStr);
  renderHolidays();
}

addHolidayButton.addEventListener("click", addHoliday);

holidayInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addHoliday();
  }
});

function validateForm() {
  clearFieldErrors();
  daysError.textContent = "";
  holidayError.textContent = "";
  let valid = true;

  const start = document.querySelector("#school-year-start").value;
  const end = document.querySelector("#school-year-end").value;
  const lateAfter = document.querySelector("#late-after").value;
  const absentAfter = document.querySelector("#absent-after").value;

  // Check at least one day selected
  const selectedDays = Array.from(document.querySelectorAll('input[name="schoolDays"]:checked')).map(cb => Number(cb.value));
  if (selectedDays.length === 0) {
    daysError.textContent = "Select at least one school day.";
    valid = false;
  }

  // Validate dates if provided
  if (start && end) {
    if (start >= end) {
      setFieldError("school-year-end", "School year end must be after start.");
      valid = false;
    }
  }

  // Validate times
  if (lateAfter && absentAfter) {
    const lateMinutes = parseTimeToMinutes(lateAfter);
    const absentMinutes = parseTimeToMinutes(absentAfter);
    if (lateMinutes >= absentMinutes) {
      setFieldError("absent-after", "Absent after must be later than late after.");
      valid = false;
    }
  }

  // Validate holidays count
  if (holidays.length > 100) {
    holidayError.textContent = "Maximum 100 holidays allowed.";
    valid = false;
  }

  return { valid, selectedDays };
}

function parseTimeToMinutes(timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearStatus();
  formMessage.textContent = "";

  const { valid, selectedDays } = validateForm();
  if (!valid) {
    formMessage.textContent = "Please correct the highlighted fields.";
    formMessage.style.color = "#b42318";
    return;
  }

  saveButton.disabled = true;
  saveButton.textContent = "Saving…";

  try {
    const settingsRef = doc(db, "settings", "school");
    const staff = getCurrentStaff();
    await setDoc(settingsRef, {
      schoolYearStart: document.querySelector("#school-year-start").value || null,
      schoolYearEnd: document.querySelector("#school-year-end").value || null,
      schoolDays: selectedDays,
      lateAfter: document.querySelector("#late-after").value || "08:00",
      absentAfter: document.querySelector("#absent-after").value || "10:00",
      holidays,
      updatedAt: serverTimestamp(),
      updatedBy: staff.uid
    });

    showStatus("Settings saved successfully.", false);
    formMessage.textContent = "Settings saved.";
    formMessage.style.color = "#28745e";
  } catch (error) {
    console.error("Failed to save settings:", error);
    showStatus("Failed to save settings. Please try again.", true);
    formMessage.textContent = "Save failed. Check your connection and permissions.";
    formMessage.style.color = "#b42318";
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Save Settings";
  }
});