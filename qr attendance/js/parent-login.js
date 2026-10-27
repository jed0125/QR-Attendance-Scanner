import {
  getAuth,
  isSignInWithEmailLink,
  sendSignInLinkToEmail,
  signInWithEmailLink
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import { app } from "./firebase-config.js";

const auth = getAuth(app);
const form = document.querySelector("#login-form");
const submitButton = document.querySelector("#submit-button");
const resendButton = document.querySelector("#resend-button");
const formMessage = document.querySelector("#form-message");
const emailInput = document.querySelector("#email");
const emailError = document.querySelector("#email-error");
const storageKey = "schoolAttendance.parentSignInEmail";
const cooldownMs = 60_000;

let cooldownUntil = 0;
let completingSignInLink = false;

function setEmailError(message) {
  emailError.textContent = message;
  emailInput.setAttribute("aria-invalid", String(Boolean(message)));
}

function showMessage(message, isError = true) {
  formMessage.textContent = message;
  formMessage.style.color = isError ? "#b42318" : "#28745e";
}

function validEmail(email) {
  return /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(email);
}

function startCooldown() {
  cooldownUntil = Date.now() + cooldownMs;
  submitButton.disabled = true;

  const updateButton = () => {
    const remaining = Math.ceil((cooldownUntil - Date.now()) / 1000);
    if (remaining <= 0) {
      submitButton.disabled = false;
      submitButton.textContent = "Send me a login link";
      return;
    }
    submitButton.textContent = `Wait ${remaining}s…`;
    window.setTimeout(updateButton, 1000);
  };

  updateButton();
}

function setSending(isSending) {
  emailInput.disabled = isSending;
  resendButton.disabled = isSending;
  if (isSending) {
    submitButton.disabled = true;
    submitButton.textContent = "Sending…";
  } else if (!cooldownUntil || Date.now() >= cooldownUntil) {
    submitButton.disabled = false;
    submitButton.textContent = "Send me a login link";
  }
}

async function sendLoginLink() {
  const email = emailInput.value.trim().toLowerCase();
  setEmailError("");
  showMessage("");

  if (!email) {
    setEmailError("Enter your email address.");
    emailInput.focus();
    return;
  }
  if (!validEmail(email)) {
    setEmailError("Enter a valid email address.");
    emailInput.focus();
    return;
  }
  if (Date.now() < cooldownUntil) {
    showMessage(`Please wait ${Math.ceil((cooldownUntil - Date.now()) / 1000)} seconds before requesting another link.`);
    return;
  }

  setSending(true);
  try {
    localStorage.setItem(storageKey, email);
    const actionCodeSettings = {
      url: new URL("parent-login.html", location.href).href,
      handleCodeInApp: true
    };
    await sendSignInLinkToEmail(auth, email, actionCodeSettings);
    showMessage("If this email is registered with the school, check your inbox (and spam) for the link.", false);
    startCooldown();
  } catch (error) {
    console.error("Unable to send parent sign-in link:", error);
    let message = "Unable to send a sign-in link right now. Please try again.";
    if (error.code === "auth/invalid-email") {
      message = "Enter a valid email address.";
      setEmailError(message);
    } else if (error.code === "auth/too-many-requests") {
      message = "Too many requests. Please wait before trying again.";
      startCooldown();
    } else if (error.code === "auth/network-request-failed") {
      message = "Network error. Check your connection and try again.";
    }
    showMessage(message);
  } finally {
    setSending(false);
  }
}

async function completeSignInLink() {
  completingSignInLink = true;
  submitButton.textContent = "Complete sign in";
  resendButton.hidden = false;
  emailInput.value = localStorage.getItem(storageKey) || "";
  showMessage("Enter the email address that received this sign-in link if it is not already filled in.", false);

  if (!emailInput.value) {
    emailInput.focus();
    return;
  }
  await finishSignIn();
}

async function finishSignIn() {
  const email = emailInput.value.trim().toLowerCase();
  setEmailError("");
  if (!email || !validEmail(email)) {
    setEmailError(email ? "Enter a valid email address." : "Enter the email address that received this link.");
    emailInput.focus();
    return;
  }

  submitButton.disabled = true;
  emailInput.disabled = true;
  showMessage("Verifying your sign-in link…", false);
  try {
    await signInWithEmailLink(auth, email, location.href);
    localStorage.removeItem(storageKey);
    location.href = "parent.html";
  } catch (error) {
    console.error("Parent email-link sign-in failed:", error);
    emailInput.disabled = false;
    submitButton.disabled = false;
    let message = "This sign-in link is invalid or has expired. Request a new link to continue.";
    if (error.code === "auth/expired-action-code") {
      message = "This sign-in link has expired. Request a new link to continue.";
    } else if (error.code === "auth/invalid-email") {
      message = "That email address is invalid. Check it and try again, or request a new link.";
    } else if (error.code === "auth/invalid-action-code") {
      message = "This sign-in link is invalid or has already been used. Request a new link to continue.";
    } else if (error.code === "auth/network-request-failed") {
      message = "Network error while verifying the link. Check your connection and try again.";
    }
    showMessage(message);
    resendButton.hidden = false;
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (completingSignInLink && isSignInWithEmailLink(auth, location.href)) {
    await finishSignIn();
    return;
  }
  await sendLoginLink();
});

resendButton.addEventListener("click", sendLoginLink);

if (isSignInWithEmailLink(auth, location.href)) {
  await completeSignInLink();
}
