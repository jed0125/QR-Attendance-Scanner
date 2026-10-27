import { getCurrentStaff, signOutAndRedirect } from "./auth-guard.js";
import { applySiteConfig } from "./site-config.js";

/**
 * Staff navigation links configuration.
 * Each link has: href, label, isAdminOnly (optional)
 */
export const NAV_LINKS = [
  { href: "dashboard.html", label: "Dashboard", isAdminOnly: false },
  { href: "scanner.html", label: "Scanner", isAdminOnly: false },
  { href: "approvals.html", label: "Approvals", isAdminOnly: false },
  { href: "students.html", label: "Students", isAdminOnly: false },
  { href: "reports.html", label: "Reports", isAdminOnly: false },
  { href: "settings.html", label: "Settings", isAdminOnly: true }
];

export function createLogoMark() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "28");
  svg.setAttribute("height", "28");
  svg.setAttribute("viewBox", "0 0 28 28");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("aria-hidden", "true");
  svg.className = "logo-mark";

  for (const [x, y] of [[3, 3], [17, 3], [3, 17]]) {
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", String(x));
    rect.setAttribute("y", String(y));
    rect.setAttribute("width", "8");
    rect.setAttribute("height", "8");
    rect.setAttribute("rx", "1");
    svg.appendChild(rect);
  }

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M17 17h3v3h-3zM22 22h3M22 17v2");
  svg.appendChild(path);

  return svg;
}

/**
 * Build the shared staff nav bar into a container.
 * This is the one place to edit the staff navigation.
 * Built with createElement and textContent only (no innerHTML).
 *
 * @param {HTMLElement} container - element with class "nav-bar"
 * @param {Object} options
 * @param {string} options.currentPage - current page href, e.g. "dashboard.html"
 * @param {boolean} options.includeScannerButton - show mint "Open scanner" button
 * @param {Function} options.onSignOut - sign out callback
 */
export function buildNavBar(container, { currentPage, includeScannerButton = true, onSignOut }) {
  container.replaceChildren();

  const staff = getCurrentStaff();

  // Links (role-filtered)
  const links = NAV_LINKS.filter(
    (link) => !link.isAdminOnly || (staff && staff.role === "admin")
  );

  links.forEach((link, index) => {
    if (index > 0) {
      const sep = document.createElement("span");
      sep.className = "nav-separator";
      sep.setAttribute("aria-hidden", "true");
      sep.textContent = "·";
      container.appendChild(sep);
    }

    const isActive = link.href === currentPage;
    const a = document.createElement("a");
    a.href = link.href;
    a.className = "nav-link" + (isActive ? " active" : "");
    a.textContent = link.label;
    if (isActive) {
      a.setAttribute("aria-current", "page");
    }
    container.appendChild(a);
  });

  // Mint "Open scanner" button
  if (includeScannerButton) {
    const sep = document.createElement("span");
    sep.className = "nav-separator";
    sep.setAttribute("aria-hidden", "true");
    sep.textContent = "·";
    container.appendChild(sep);

    const openScanner = document.createElement("a");
    openScanner.href = "scanner.html";
    openScanner.className = "nav-btn-open";
    openScanner.setAttribute("role", "button");
    openScanner.textContent = "Open scanner";
    container.appendChild(openScanner);
  }

  // Sign out
  const sep = document.createElement("span");
  sep.className = "nav-separator";
  sep.setAttribute("aria-hidden", "true");
  sep.textContent = "·";
  container.appendChild(sep);

  const signoutBtn = document.createElement("button");
  signoutBtn.type = "button";
  signoutBtn.className = "nav-signout";
  signoutBtn.id = "signout-button";
  signoutBtn.textContent = "Sign out";
  if (typeof onSignOut === "function") {
    signoutBtn.addEventListener("click", onSignOut);
  }
  container.appendChild(signoutBtn);

  // Ensure site config text and favicons are synced
  applySiteConfig();
}

/**
 * Initialize the staff navigation for a page.
 * Call this after the auth guard resolves.
 * @param {string} currentPage - current page href, e.g. "dashboard.html"
 */
export function initStaffNav(currentPage) {
  const navContainer = document.querySelector(".nav-bar");
  if (!navContainer) return;

  buildNavBar(navContainer, {
    currentPage,
    includeScannerButton: currentPage !== "scanner.html",
    onSignOut: signOutAndRedirect
  });
}
