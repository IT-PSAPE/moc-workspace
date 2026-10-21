import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Browser checks use the real API against a throwaway JSON store. Never write
// screenshot fixtures, approvals or progress updates into the running demo.
export async function startUiTestApi(origins) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const directory = await mkdtemp(path.join(tmpdir(), "moc-ui-check-"));
  const child = spawn(
    path.join(root, "node_modules/.bin/tsx"),
    ["apps/api/src/server.ts"],
    {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: "development",
        PORT: "0",
        DEMO_MODE: "true",
        API_LOCAL_DATA_PATH: path.join(directory, "state.json"),
        API_ALLOWED_ORIGINS: origins.join(","),
        TELEGRAM_BOT_TOKEN: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let diagnostics = "";
  child.stderr.on("data", (chunk) => {
    diagnostics += chunk.toString();
  });
  async function stop() {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null)
        return resolve();
      child.once("exit", resolve);
      setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 2000).unref();
    });
    await rm(directory, { recursive: true, force: true });
  }
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Isolated API did not start: ${diagnostics}`)),
        10000,
      );
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error(`Isolated API exited: ${diagnostics}`));
      });
      child.stdout.on("data", (chunk) => {
        const match = chunk.toString().match(/http:\/\/localhost:(\d+)/);
        if (match) {
          clearTimeout(timer);
          resolve(match[0]);
        }
      });
    });
    return { url, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

export async function routeUiTestApi(context, clientApiUrl, testApiUrl) {
  await context.route(`${clientApiUrl}/api/**`, async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({
      url: `${testApiUrl}${url.pathname}${url.search}`,
    });
    await route.fulfill({ response });
  });
}
