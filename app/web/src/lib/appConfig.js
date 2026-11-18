// Public, non-secret configuration of this deployment.
export function getAppParams() {
  return {
    appUrl: typeof window === "undefined" ? "" : window.location.origin,
  };
}
