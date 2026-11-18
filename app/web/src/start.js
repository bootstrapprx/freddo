import { createCsrfMiddleware, createStart } from "@tanstack/react-start";
import { authMiddleware, requestContextMiddleware } from "@/lib/auth-middleware";

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware, requestContextMiddleware],
  functionMiddleware: [authMiddleware],
}));
