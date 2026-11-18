import { createStart } from "@tanstack/react-start";

// Server functions and routes share the request context; authentication is layered in
// by src/lib/auth-middleware.js as the auth implementation lands.
export const startInstance = createStart(() => ({}));
