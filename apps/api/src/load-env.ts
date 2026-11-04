import { config } from "dotenv";
import { fileURLToPath } from "node:url";

// Runtime values win. Local Supabase credentials stay in ignored environment files.
for (const path of ["../../../.env.local", "../../../.env", "../.env"]) {
  config({ path: fileURLToPath(new URL(path, import.meta.url)) });
}
