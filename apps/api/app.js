import { Hono } from "hono";
import { ipAddress } from "@vercel/functions";
import { createRuntimeApp } from "./dist/runtime.js";

// Bundle TypeScript and shared workspace code before Vercel traces the handler.
// Vercel owns the listener and supplies the trusted client-IP header.
const app = new Hono();
app.route("/", createRuntimeApp({ resolveRemoteAddress: (context) => ipAddress(context.req.raw) }));
export default app;
