import "dotenv/config";
import { serve } from "@hono/node-server";
import { createApiApp } from "./index";

if (process.env.NODE_ENV === "production") {
  throw new Error(
    "Production startup is disabled until a durable database repository is configured. The local JSON store is for development only.",
  );
}

const port = Number(process.env.PORT ?? 3001);
const app = createApiApp();
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`MOC API listening on http://localhost:${info.port}`);
});
