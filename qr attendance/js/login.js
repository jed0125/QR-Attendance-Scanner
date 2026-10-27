import { getAuth, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";
import { app } from "./firebase-config.js";

const auth = getAuth(app);
const db = getFirestore(app);

const form = document.querySelector("#login-form");
const submitButton = document.querySelector("#submit-button");
const formMessage = document.querySelector("#form-message");
const emailInput = document.querySelector("#email");
const passwordInput = document.querySelector("#password");
const emailError = document.querySelector("#email-error");
const passwordError = document.querySelector("#password-error");

function setFieldError(input, errorEl, message) {
  errorEl.textContent = message;
  input.setAttribute("aria-invalid", String(Boolean(message)));
}

function clearFieldErrors() {
  setFieldError(emailInput, emailError, "");
  setFieldError(passwordInput, passwordError, "");
}

function showMessage(message, isError = true) {
  formMessage.textContent = message;
  formMessage.style.color = isError ? "#b42318" : "#28745e";
}

function setLoading(isLoading) {
  submitButton.disabled = isLoading;
  submitButton.textContent = isLoading ? "Signing in…" : "Sign in";
  emailInput.disabled = isLoading;
  passwordInput.disabled = isLoading;
}

async function checkStaffDocument(uid) {
  const staffRef = doc(db, "staff", uid);
  const staffSnap = await getDoc(staffRef);
  return staffSnap.exists() ? staffSnap.data() : null;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearFieldErrors();
  showMessage("");

  const email = emailInput.value.trim().toLowerCase();
  const password = passwordInput.value;

  if (!email) {
    setFieldError(emailInput, emailError, "Enter your email address.");
    emailInput.focus();
    return;
  }
  if (!password) {
    setFieldError(passwordInput, passwordError, "Enter your password.");
    passwordInput.focus();
    return;
  }

  setLoading(true);

  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // Check if user has a staff document
    const staffData = await checkStaffDocument(user.uid);
    if (!staffData) {
      await signOut(auth);
      showMessage("This account is not authorized.");
      setFieldError(emailInput, emailError, "This account is not authorized.");
      return;
    }

    // Success — redirect to approvals page
    window.location.href = "approvals.html";
  } catch (error) {
    console.error("Sign-in failed:", error);
    let message = "Sign in failed. Please try again.";
    switch (error.code) {
      case "auth/invalid-email":
        message = "Enter a valid email address.";
        setFieldError(emailInput, emailError, message);
        break;
      case "auth/user-not-found":
      case "auth/wrong-password":
      case "auth/invalid-credential":
        message = "Incorrect email or password.";
        setFieldError(passwordInput, passwordError, message);
        break;
      case "auth/too-many-requests":
        message = "Too many failed attempts. Please try again later.";
        break;
      case "auth/network-request-failed":
        message = "Network error. Check your connection and try again.";
        break;
      default:
        message = `Sign in failed: ${error.message}`;
    }
    showMessage(message);
  } finally {
    setLoading(false);
  }
});