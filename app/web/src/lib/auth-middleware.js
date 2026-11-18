import { createMiddleware } from "@tanstack/react-start";
import { setResponseStatus } from "@tanstack/react-start/server";

// F2 placeholder: session resolution moves to better-auth in the auth phase.
// Keeping the middleware names/contract avoids touching every page twice.
const currentUser = async () => null;

export const authMiddleware = createMiddleware({ type: "function" })
  .server(async ({ next }) => next({ context: { user: await currentUser() } }));

export const requestContextMiddleware = createMiddleware({ type: "request" }).server(({ next }) => next());

// Add to a server function that needs a signed-in caller:
//   createServerFn().middleware([requireUser]).handler(({ context }) => context.user.id)
export const requireUser = createMiddleware({ type: "function" }).server(async ({ next, context }) => {
  const user = await currentUser(context);
  if (!user) {
    setResponseStatus(401);
    throw Object.assign(new Error("Unauthorized"), { status: 401, code: "UNAUTHORIZED" });
  }
  return next({ context: { user } });
});

// For server routes: `server: { middleware: [requireUserRoute], handlers }`.
export const requireUserRoute = createMiddleware({ type: "request" }).server(async ({ next, context }) => {
  const user = await currentUser(context);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return next({ context: { user } });
});
