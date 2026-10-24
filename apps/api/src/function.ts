import { createRuntimeApp } from "./runtime";

// Neon owns the HTTP listener; the same app runs through @hono/node-server locally.
export default createRuntimeApp();
