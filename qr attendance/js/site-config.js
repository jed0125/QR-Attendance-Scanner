/**
 * Site configuration — shared across all pages.
 * Change SCHOOL_NAME here to update the header on every page.
 */

export const SCHOOL_NAME = "[SCHOOL NAME]";

/**
 * Logo mark as inline SVG string (mint on dark, currentColor).
 * Used in site header and as favicon data URI.
 */
export const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="17" y="3" width="8" height="8" rx="1"/><rect x="3" y="17" width="8" height="8" rx="1"/><path d="M17 17h3v3h-3zM22 22h3M22 17v2"/></svg>`;

/**
 * Mint-accented logo SVG as data URI for favicon.
 */
export const LOGO_FAVICON = "data:image/svg+xml," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="%237FD6BE" stroke-width="2"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="17" y="3" width="8" height="8" rx="1"/><rect x="3" y="17" width="8" height="8" rx="1"/><path d="M17 17h3v3h-3zM22 22h3M22 17v2"/></svg>`
);

/**
 * Apply school name and favicon across the document via textContent.
 */
export function applySiteConfig() {
  // Update all school-name elements safely with textContent
  document.querySelectorAll(".school-name").forEach((el) => {
    el.textContent = SCHOOL_NAME;
  });

  // Set or update favicon to inline-SVG data URI
  let favicon = document.querySelector('link[rel="icon"]');
  if (!favicon) {
    favicon = document.createElement("link");
    favicon.rel = "icon";
    favicon.type = "image/svg+xml";
    document.head.appendChild(favicon);
  }
  favicon.href = LOGO_FAVICON;
}

// Auto-run when DOM is ready
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applySiteConfig);
  } else {
    applySiteConfig();
  }
}
