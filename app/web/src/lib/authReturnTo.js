// Post-auth destination, shared by the auth pages and the login gate.
// Keep the check in one place — it is security-sensitive.
//
// A same-origin check alone is not enough: a value like "/.//evil.com" or
// "/\evil.com" parses same-origin but normalizes to a protocol-relative URL when
// assigned to location.href, so the resolved path must start with exactly one
// "/" and contain no backslash.
//
// An auth page is never a destination: coming back to /reset-password?token=…
// would carry a live one-time credential through the login round-trip, and the
// other pages would just loop.
const AUTH_PAGES = new Set(["/login", "/register", "/forgot-password", "/reset-password", "/mfa"]);

export function safeReturnTo(search) {
  if (typeof window === "undefined") return "/";
  const params = new URLSearchParams(search ?? window.location.search);
  return sanitizeReturnTo(params.get("returnTo"));
}

export function sanitizeReturnTo(raw) {
  if (!raw || typeof window === "undefined") return "/";
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return "/";
    // One-time credentials must never ride through a login round-trip.
    for (const param of ["returnTo", "token", "access_token"]) {
      url.searchParams.delete(param);
    }
    if (AUTH_PAGES.has(url.pathname.replace(/\/+$/, "") || "/")) return "/";
    const path = url.pathname + url.search;
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return "/";
    return path;
  } catch {
    return "/";
  }
}

export function currentPath() {
  if (typeof window === "undefined") return "/";
  return sanitizeReturnTo(window.location.pathname + window.location.search);
}

export function returnToSearch(returnTo) {
  return returnTo && returnTo !== "/" ? { returnTo } : {};
}
