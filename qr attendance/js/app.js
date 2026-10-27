import { doc, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";
import { db } from "./firebase-config.js";
import "./site-config.js";

const form = document.querySelector("#registration-form");
const submitButton = document.querySelector("#submit-button");
const formMessage = document.querySelector("#form-message");
const resultSection = document.querySelector("#registration-result");
const resultMessage = document.querySelector("#result-message");
const qrContainer = document.querySelector("#qr-code");
const studentNameOutput = document.querySelector("#registered-student-name");
const guardianNameOutput = document.querySelector("#registered-guardian-name");
const downloadButton = document.querySelector("#download-button");
const printButton = document.querySelector("#print-button");

const fields = {
  studentName: {
    input: document.querySelector("#student-name"),
    error: document.querySelector("#student-name-error")
  },
  guardianName: {
    input: document.querySelector("#guardian-name"),
    error: document.querySelector("#guardian-name-error")
  },
  guardianEmail: {
    input: document.querySelector("#guardian-email"),
    error: document.querySelector("#guardian-email-error")
  },
  guardianPhone: {
    input: document.querySelector("#guardian-phone"),
    error: document.querySelector("#guardian-phone-error"),
    descriptionId: "phone-hint"
  },
  gradeSection: {
    input: document.querySelector("#grade-section"),
    error: document.querySelector("#grade-section-error"),
    descriptionId: "grade-section-hint"
  },
  consent: {
    input: document.querySelector("#consent"),
    error: document.querySelector("#consent-error")
  }
};

function setFieldError(field, message) {
  field.error.textContent = message;
  if (field.input.type === "checkbox") {
    field.input.setAttribute("aria-invalid", String(Boolean(message)));
  } else {
    field.input.setAttribute("aria-invalid", String(Boolean(message)));
    field.input.setAttribute(
      "aria-describedby",
      [field.descriptionId, field.error.id].filter(Boolean).join(" ")
    );
  }
}

function validateName(value, label) {
  const name = value.trim();
  if (name.length < 2 || name.length > 100) {
    return { value: name, error: `${label} must be between 2 and 100 characters.` };
  }
  return { value: name, error: "" };
}

function normalizePhone(value) {
  const compact = value.trim().replace(/[\s()-]/g, "");
  if (compact === "") {
    return { value: "", error: "" };
  }
  if (/^09\d{9}$/.test(compact)) {
    return { value: `63${compact.slice(1)}`, error: "" };
  }
  if (/^\+639\d{9}$/.test(compact)) {
    return { value: compact.slice(1), error: "" };
  }
  return {
    value: "",
    error: "Enter a valid Philippine mobile number, such as 09171234567 or +639171234567."
  };
}

function validateForm() {
  let valid = true;
  const student = validateName(fields.studentName.input.value, "Student full name");
  const guardian = validateName(fields.guardianName.input.value, "Parent / guardian name");
  const email = fields.guardianEmail.input.value.trim().toLowerCase();
  const phone = normalizePhone(fields.guardianPhone.input.value);

  setFieldError(fields.studentName, student.error);
  setFieldError(fields.guardianName, guardian.error);

  const emailValid = email.length < 254
    && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(email);
  const emailError = emailValid ? "" : "Enter a valid email address under 254 characters.";
  setFieldError(fields.guardianEmail, emailError);
  setFieldError(fields.guardianPhone, phone.error);

  // Validate gradeSection (optional, max 40 chars)
  const gradeSection = fields.gradeSection.input.value.trim();
  let gradeSectionError = "";
  if (gradeSection.length > 40) {
    gradeSectionError = "Grade and section must be 40 characters or fewer.";
  }
  setFieldError(fields.gradeSection, gradeSectionError);

  const consentError = fields.consent.input.checked
    ? ""
    : "Guardian consent is required to register.";
  setFieldError(fields.consent, consentError);

  valid = !student.error && !guardian.error && !emailError && !phone.error && !gradeSectionError && !consentError;
  return {
    valid,
    values: {
      studentName: student.value,
      guardianName: guardian.value,
      guardianEmail: email,
      guardianPhone: phone.value,
      gradeSection: gradeSection || ""
    }
  };
}

function renderQr(id) {
  if (typeof window.QRCode !== "function") {
    throw new Error("The QR code library did not load.");
  }
  qrContainer.replaceChildren();
  new window.QRCode(qrContainer, {
    text: id,
    width: 230,
    height: 230,
    colorDark: "#12263A",
    colorLight: "#ffffff",
    correctLevel: window.QRCode.CorrectLevel.M
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  formMessage.textContent = "";
  resultMessage.textContent = "";

  const honeypot = document.querySelector("#website");
  if (honeypot.value.trim() !== "") {
    formMessage.textContent = "Unable to submit this registration. Please try again.";
    return;
  }

  const { valid, values } = validateForm();
  if (!valid) {
    formMessage.textContent = "Please correct the highlighted fields.";
    const firstInvalid = Object.values(fields).find((field) => (
      field.input.getAttribute("aria-invalid") === "true"
    ));
    firstInvalid?.input.focus();
    return;
  }

  if (!window.crypto?.randomUUID) {
    formMessage.textContent = "This browser cannot create a secure registration ID. Try a current browser.";
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = "Submitting…";

  const id = window.crypto.randomUUID();
  const studentPayload = {
    id,
    studentName: values.studentName,
    guardianName: values.guardianName,
    guardianEmail: values.guardianEmail,
    guardianPhone: values.guardianPhone,
    approved: false,
    consent: true,
    createdAt: serverTimestamp()
  };
  if (values.gradeSection && values.gradeSection.length > 0) {
    studentPayload.gradeSection = values.gradeSection;
  }

  try {
    await setDoc(doc(db, "students", id), studentPayload);
  } catch (error) {
    console.error("Student registration failed.", error);
    formMessage.textContent = "We couldn't save your registration. Check your connection and Firebase setup, then try again.";
    submitButton.disabled = false;
    submitButton.textContent = "Get my QR code";
    return;
  }

  form.hidden = true;
  resultSection.hidden = false;
  resultSection.focus();
  studentNameOutput.textContent = values.studentName;
  if (guardianNameOutput) {
    guardianNameOutput.textContent = `Guardian: ${values.guardianName}`;
  }
  try {
    renderQr(id);
  } catch (error) {
    console.error("Registration was saved, but QR generation failed.", error);
    resultMessage.textContent = "Your registration was saved, but the QR code could not be displayed. Please contact the school; do not submit again.";
    downloadButton.disabled = true;
    printButton.disabled = true;
  }
});

downloadButton.addEventListener("click", () => {
  const canvas = qrContainer.querySelector("canvas");
  const image = qrContainer.querySelector("img");
  const imageUrl = canvas?.toDataURL("image/png") || image?.src;
  if (!imageUrl) {
    resultMessage.textContent = "The QR image is not ready to download. Please try again.";
    return;
  }
  const downloadLink = document.createElement("a");
  downloadLink.href = imageUrl;
  downloadLink.download = "student-attendance-qr.png";
  downloadLink.click();
});

printButton.addEventListener("click", () => {
  window.print();
});
