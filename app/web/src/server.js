import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";

// The Worker's entry: TanStack Start's default streaming handler.
const handler = createStartHandler((ctx) => defaultStreamHandler(ctx));

export default { fetch: handler };
