import "./load-env";
import { serve } from "@hono/node-server";
import { createRuntimeApp } from "./runtime";

const port = Number(process.env.PORT ?? 3001);
const app = createRuntimeApp();
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`MOC API listening on http://localhost:${info.port}`);
});
