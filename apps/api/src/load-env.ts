import { config } from "dotenv";
import { fileURLToPath } from "node:url";

// Runtime values win. Neon pulls secrets at the monorepo root, not in apps/api.
for (const path of ["../../../.env.local", "../../../.env", "../.env"]) {
  config({ path: fileURLToPath(new URL(path, import.meta.url)) });
}
