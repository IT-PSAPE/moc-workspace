import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { parse } from "dotenv";

const deployment = JSON.parse(await readFile(new URL("../deployments/vercel.json", import.meta.url), "utf8"));
const local = parse(await readFile(new URL("../.env.local", import.meta.url), "utf8"));
const source = { ...local, ...process.env };
const { projects, scope } = deployment;
const selected = process.argv[2] ? [process.argv[2]] : Object.keys(projects);
if (selected.some((name) => !Object.hasOwn(projects, name))) throw new Error("Choose workspace, portal, or api.");

function required(key) {
  if (!source[key]) throw new Error(`Fill the Supabase API environment first; ${key} is missing.`);
  return source[key];
}
function publicUrl(value) {
  const url = new URL(value);
  if (!["https:", "wss:"].includes(url.protocol) || url.username || url.password || /token|secret|signature|credential|key/i.test(url.search))
    throw new Error("A Config URL must be a public HTTPS or WSS endpoint without credentials.");
  return value.replace(/\/$/, "");
}

const definitions = {
  // Production ignores VITE_API_URL and always uses same-origin /api rewrites.
  workspace: [["VITE_PORTAL_URL", "config", () => publicUrl(projects.portal.url)]],
  portal: [["VITE_WORKSPACE_URL", "config", () => publicUrl(projects.workspace.url)]],
  api: [
    ["SUPABASE_DATABASE_URL", "secret", () => required("SUPABASE_DATABASE_URL")],
    ["SUPABASE_SECRET_KEY", "secret", () => required("SUPABASE_SECRET_KEY")],
    ["SUPABASE_PUBLISHABLE_KEY", "config", () => required("SUPABASE_PUBLISHABLE_KEY")],
    ["SUPABASE_URL", "config", () => publicUrl(required("SUPABASE_URL"))],
    ["SUPABASE_REPORT_BUCKET", "config", () => source.SUPABASE_REPORT_BUCKET || "moc-reports"],
    ["WORKSPACE_URL", "config", () => publicUrl(projects.workspace.url)],
    ["API_ALLOWED_ORIGINS", "config", () => [publicUrl(projects.workspace.url), publicUrl(projects.portal.url), "http://localhost:5173", "http://localhost:5174"].join(",")],
    ["DEMO_MODE", "config", () => "false"],
  ],
};

// Resolve and validate every value before making any remote changes.
const changes = selected.flatMap((name) => definitions[name].map(([key, visibility, value]) => ({ name, key, visibility, value: value() })));
for (const name of selected) {
  const inspected = JSON.parse(execFileSync("vercel", ["project", "inspect", projects[name].name, "--scope", scope, "--format", "json"], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }));
  if (inspected.name !== projects[name].name || inspected.owner?.slug !== scope || inspected.rootDirectory !== projects[name].rootDirectory)
    throw new Error(`The ${name} project does not match the deployment manifest.`);
}
for (const { name, key, visibility, value } of changes) {
  try {
    execFileSync("vercel", ["env", "add", key, "production", "--type", visibility, "--project", projects[name].name, "--scope", scope, "--yes", "--force"], {
      input: value, stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    // Never include the value or a subprocess's raw environment output in errors.
    throw new Error(`Could not configure ${name}.${key} as ${visibility}.`);
  }
  console.log(`${projects[name].name}: ${key} → ${visibility}`);
}
