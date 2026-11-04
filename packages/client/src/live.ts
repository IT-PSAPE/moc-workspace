import { WORKSPACE_FALLBACK_INTERVAL_MS } from "./query-policy";

export type LiveSignal = { event: "revision"; revision: string } | { event: "revoked" } | { event: "paused" } | { event: "connected" };

/** API-only SSE transport. Permanent failures stop reconnects, hidden tabs abort
 * the reader, and temporary service failures use the 15-minute fallback. */
export function subscribeWorkspaceEvents(url: string, signal: (value: LiveSignal) => void) {
  const controller = new AbortController();
  let lastRevision: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (delay: number) => {
    if (!controller.signal.aborted) timer = setTimeout(() => { void connect(); }, delay);
  };
  async function connect() {
    let retryDelay = 1000;
    try {
      const response = await fetch(url, { credentials: "include", headers: { Accept: "text/event-stream" }, signal: controller.signal });
      if (response.status === 401 || response.status === 403) { await response.body?.cancel(); signal({ event: "revoked" }); return; }
      if (!response.ok || !response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
        await response.body?.cancel();
        signal({ event: "paused" });
        if (response.status >= 400 && response.status < 500) return;
        schedule(WORKSPACE_FALLBACK_INTERVAL_MS); return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let revoked = false;
      try {
        while (!controller.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
          let boundary: number;
          while ((boundary = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
            const event = frame.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim();
            const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
            if (event === "revoked") { signal({ event: "revoked" }); revoked = true; return; }
            if (event === "paused") { signal({ event: "paused" }); retryDelay = WORKSPACE_FALLBACK_INTERVAL_MS; }
            if (event === "revision") {
              const parsed = JSON.parse(data) as { revision?: unknown };
              if (typeof parsed.revision === "string") {
                signal({ event: "connected" });
                if (parsed.revision !== lastRevision) {
                  lastRevision = parsed.revision;
                  signal({ event: "revision", revision: parsed.revision });
                }
              }
            }
          }
          if (buffer.length > 16_384) throw new Error("Invalid live update stream.");
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      if (!revoked) schedule(retryDelay);
    } catch {
      if (controller.signal.aborted) return;
      signal({ event: "paused" });
      schedule(WORKSPACE_FALLBACK_INTERVAL_MS);
    }
  }
  void connect();
  return () => { controller.abort(); clearTimeout(timer); };
}
