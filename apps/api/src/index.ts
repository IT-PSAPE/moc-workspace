import "./load-env";
import { cors } from "hono/cors";
import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { fileURLToPath } from "node:url";
import {
  applyAction,
  ensureDailyBannerQuote,
  createRequest,
  publicProjection,
  publicRequest,
  updatePublicRequest,
  validateWorkspaceAction,
  type Department,
  type Session,
  type SubmissionReceipt,
  type WorkspaceAction,
  type WorkspaceState,
} from "@moc/shared";
import { createAuthRouter, getSession } from "./auth";
import { JsonRepository, type Repository } from "./repository";
import type { ReportStorage } from "./report-storage";
import { HTTPException } from "hono/http-exception";
import type { SealedLiveQuery } from "@neon/realtime/client";
import type { WorkspaceRevision } from "./realtime";
import {
  createTrackingCode,
  findRequestByTrackingCode,
  hashTrackingCode,
} from "./tracking";

const allowedOrigins = new Set<string>(
  (
    process.env.API_ALLOWED_ORIGINS ??
    "http://localhost:5173,http://localhost:5174"
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(isOrigin),
);
if (allowedOrigins.size === 0)
  throw new Error(
    "API_ALLOWED_ORIGINS must contain at least one valid origin.",
  );

const dataPath =
  process.env.API_LOCAL_DATA_PATH ??
  fileURLToPath(new URL("../data/state.json", import.meta.url));

export interface ApiOptions {
  now?: () => Date;
  quoteRandom?: () => number;
  resolveSession?: (context: Context) => Promise<Session>;
  reportStorage?: ReportStorage;
  storage?: "local-demo" | "neon-postgres";
  sealWorkspace?: (memberId: string) => Promise<SealedLiveQuery<WorkspaceRevision>>;
  /** Override only for an adapter that supplies a verified transport identity. */
  resolveRemoteAddress?: (context: Context) => string | undefined;
  maxCredentialBuckets?: number;
}

export function createApiApp(
  repository: Repository = new JsonRepository(dataPath),
  options: ApiOptions = {},
): Hono {
  const app = new Hono();
  const resolveSession = options.resolveSession ?? (async (c: Context) => getSession(c));
  const demoEnabled = () => !options.resolveSession && demoAvailable();
  const now = options.now ?? (() => new Date());

  app.use(
    "*",
    cors({
      origin: (origin) => (origin && allowedOrigins.has(origin) ? origin : ""),
      credentials: true,
      allowMethods: ["GET", "POST", "PATCH", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      maxAge: 600,
    }),
  );

  const bodyLimit: MiddlewareHandler = async (c, next) => {
    if (c.req.method === "POST" || c.req.method === "PATCH") {
      const origin = c.req.header("origin");
      if (
        c.req.path !== "/api/track" &&
        (!origin || !allowedOrigins.has(origin))
      )
        return c.json(
          { error: "This origin is not allowed to change workspace data." },
          403,
        );
      const contentLength = Number(c.req.header("content-length") ?? 0);
      if (contentLength > 64 * 1024)
        return c.json({ error: "Request body is too large." }, 413);
      const body = await c.req.raw.clone().arrayBuffer();
      if (body.byteLength > 64 * 1024)
        return c.json({ error: "Request body is too large." }, 413);
    }
    await next();
  };
  app.use("/api/*", bodyLimit);

  const credentialAttempts = new Map<string, number[]>();
  const resolveRemoteAddress =
    options.resolveRemoteAddress ??
    ((context) => {
      try {
        return getConnInfo(context).remote.address;
      } catch {
        return undefined;
      }
    });
  const requestedBucketLimit = options.maxCredentialBuckets;
  const maxCredentialBuckets = Number.isSafeInteger(requestedBucketLimit)
    ? Math.max(1, Math.min(10_000, requestedBucketLimit!))
    : 2_000;
  app.use("/api/track", async (c, next) => {
    if (c.req.method !== "POST") return next();
    return limitCredentialAttempts(
      c,
      next,
      credentialAttempts,
      resolveRemoteAddress(c),
      maxCredentialBuckets,
    );
  });
  app.use("/api/requests", async (c, next) => {
    if (c.req.method !== "PATCH") return next();
    return limitCredentialAttempts(
      c,
      next,
      credentialAttempts,
      resolveRemoteAddress(c),
      maxCredentialBuckets,
    );
  });

  app.onError((error, c) => {
    if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
    console.error(
      "API request failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The request could not be completed.",
      },
      500,
    );
  });

  app.get("/health", (c) => c.json({ status: "ok" as const }));
  app.get("/api/session", async (c) => {
    const session = await resolveSession(c);
    if (session.user) {
      const state = await repository.read();
      const currentUser = state.users.find(
        (user) => user.id === session.user?.id && user.approved,
      );
      return c.json(
        currentUser
          ? { ...session, user: currentUser }
          : { user: null, demo: demoEnabled() },
      );
    }
    return c.json({ ...session, demo: demoEnabled() });
  });
  app.route(
    "/api/auth",
    createAuthRouter({
      findApprovedLeaderByGoogleEmail: (email) =>
        repository.findApprovedLeaderByGoogleEmail(email),
      getDemoLeaderByDepartment: (department) =>
        options.resolveSession ? null : repository.getDemoLeaderByDepartment(department),
    }),
  );

  app.get("/api/catalog", async (c) => {
    const { catalog } = await repository.read();
    return c.json({
      services: catalog.services,
      ministries: catalog.ministries,
      disabledMinistries: catalog.disabledMinistries ?? [],
      departments: catalog.departments,
    });
  });

  app.get("/api/integrations", async (c) => {
    const session = await resolveSession(c);
    if (!isApproved(session)) return unauthorized(c);
    const state = await repository.read();
    const currentUser = state.users.find(
      (user) => user.id === session.user.id && user.approved,
    );
    if (!currentUser) return unauthorized(c);
    if (currentUser.department !== "cell-0" || !currentUser.isLeader)
      return c.json({ error: "Only Cell 0 leaders can view integration status." }, 403);
    const telegramChats = [
      process.env.TELEGRAM_CHAT_CELL_0,
      process.env.TELEGRAM_CHAT_SOUND,
      process.env.TELEGRAM_CHAT_VISUAL_MEDIA,
      process.env.TELEGRAM_CHAT_DESIGN,
    ];
    return c.json({
      telegramConfigured: Boolean(
        process.env.TELEGRAM_BOT_TOKEN && telegramChats.every((chat) => chat),
      ),
      googleConfigured: Boolean(
        process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
      ),
      storage: options.storage ?? "local-demo",
      ...(options.resolveSession ? { neonAuthConfigured: true } : {}),
      ...(options.reportStorage ? { objectStorageConfigured: true } : {}),
    });
  });

  app.post("/api/reports/export", async (c) => {
    const session = await resolveSession(c);
    if (!isApproved(session)) return unauthorized(c);
    const state = await repository.read();
    const actor = state.users.find((user) => user.id === session.user.id && user.approved);
    if (!actor || !actor.isLeader || actor.department !== "cell-0")
      return c.json({ error: "Only Cell 0 leaders can export reports." }, 403);
    if (!options.reportStorage) return c.json({ error: "Report storage is not configured." }, 503);
    const body = await c.req.json().catch(() => null);
    if (!isRecord(body) || typeof body.month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(body.month) ||
      typeof body.csv !== "string" || !body.csv.trim() || body.csv.length > 60_000)
      return c.json({ error: "Choose a month and provide a report under 60 KB." }, 400);
    return c.json(await options.reportStorage.save(actor.id, body.month, body.csv), 201);
  });

  app.post("/api/workspace/live", async (c) => {
    const session = await resolveSession(c);
    if (!isApproved(session)) return unauthorized(c);
    const state = await repository.read();
    if (!state.users.some((user) => user.id === session.user.id && user.approved)) return unauthorized(c);
    if (!options.sealWorkspace) return c.json({ error: "Live updates are not configured." }, 503);
    return c.json(await options.sealWorkspace(session.user.id));
  });

  app.get("/api/workspace", async (c) => {
    const session = await resolveSession(c);
    if (!isApproved(session)) return unauthorized(c);
    let state = await repository.read();
    let user = state.users.find(
      (leader) => leader.id === session.user.id && leader.approved,
    );
    if (!user) return unauthorized(c);
    if (ensureDailyBannerQuote(state, now(), () => 0) !== state) {
      state = await repository.update((current) => {
        user = current.users.find((member) => member.id === session.user.id && member.approved);
        if (!user) throw new HTTPException(401, { message: "Your member access has been revoked. Please sign in again." });
        return ensureDailyBannerQuote(current, now(), options.quoteRandom);
      });
    }
    return c.json(projectWorkspace(state, user!));
  });

  app.post("/api/actions", async (c) => {
    const session = await resolveSession(c);
    if (!isApproved(session)) return unauthorized(c);
    const body: unknown = await c.req.json().catch(() => null);
    try {
      validateWorkspaceAction(body);
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "A valid workspace action is required.",
        },
        400,
      );
    }
    let previous: WorkspaceState | undefined;
    let actor: NonNullable<Session["user"]> | undefined;
    let next: WorkspaceState;
    try {
      next = await repository.update((state) => {
        previous = state;
        actor = state.users.find(
          (leader) => leader.id === session.user!.id && leader.approved,
        );
        if (!actor)
          throw new Error(
            "Your member access has been revoked. Please sign in again.",
          );
        const timestamp = now();
        return ensureDailyBannerQuote(
          applyAction(ensureDailyBannerQuote(state, timestamp, options.quoteRandom), actor, body, timestamp),
          timestamp, options.quoteRandom,
        );
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message ===
          "Your member access has been revoked. Please sign in again."
      )
        return unauthorized(c);
      return c.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "The action could not be applied.",
        },
        400,
      );
    }
    if (!actor) return unauthorized(c);
    const actionText = telegramForAction(
      body,
      previous ?? next,
      next,
      actor.department,
    );
    if (actionText)
      await notifyTelegram(actionText.text, actionText.departments);
    return c.json(projectWorkspace(next, actor));
  });

  app.post("/api/requests", async (c) => {
    const input: unknown = await c.req.json().catch(() => null);
    if (!isRequestInput(input))
      return c.json({ error: "A valid request is required." }, 400);
    const trackingCode = createTrackingCode();
    let request: WorkspaceState["requests"][number] | undefined;
    try {
      await repository.update((state) => {
        const created = createRequest(state, input);
        request = {
          ...created.request,
          trackingCodeHash: hashTrackingCode(
            trackingCode.replace(/[\s-]/g, "").toUpperCase(),
          ),
        };
        return {
          ...created.state,
          requests: created.state.requests.map((item) =>
            item.id === request!.id ? request! : item,
          ),
        };
      });
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "The request could not be created.",
        },
        400,
      );
    }
    if (!request)
      return c.json({ error: "The request could not be created." }, 500);
    await notifyTelegram(
      `New request ${request.reference} from ${request.ministry}: ${request.title}`,
      ["cell-0"],
    );
    const receipt = {
      request: publicRequest(request),
      trackingCode,
    } satisfies SubmissionReceipt;
    return c.json(receipt, 201);
  });

  app.post("/api/track", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    if (!isRecord(body) || typeof body.code !== "string")
      return c.json({ error: "Request was not found." }, 404);
    const state = await repository.read();
    const request = findRequestByTrackingCode(state, body.code);
    if (!request) return c.json({ error: "Request was not found." }, 404);
    const tracking = publicProjection(
      state,
      request.reference,
      request.ministry,
    );
    if (!tracking) return c.json({ error: "Request was not found." }, 404);
    return c.json(tracking);
  });

  app.patch("/api/requests", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    if (
      !isRecord(body) ||
      typeof body.code !== "string" ||
      !isRequestInput(body.input)
    ) {
      return c.json({ error: "Request was not found." }, 404);
    }
    const state = await repository.read();
    const existing = findRequestByTrackingCode(state, body.code);
    if (!existing || existing.status !== "backlog")
      return c.json({ error: "Request was not found." }, 404);
    let result: ReturnType<typeof updatePublicRequest> | undefined;
    try {
      await repository.update((state) => {
        const current = findRequestByTrackingCode(state, body.code);
        if (!current || current.status !== "backlog")
          throw new Error("Request was not found.");
        result = updatePublicRequest(
          state,
          current.reference,
          current.ministry,
          body.input as Parameters<typeof createRequest>[1],
        );
        return result.state;
      });
    } catch (error) {
      if (error instanceof Error && error.message === "Request was not found.")
        return c.json({ error: "Request was not found." }, 404);
      return c.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "The request could not be edited.",
        },
        400,
      );
    }
    if (!result)
      return c.json({ error: "The request could not be edited." }, 500);
    await notifyTelegram(
      `Request ${result.request.reference} was edited by ${result.request.ministry}: ${result.request.title}`,
      ["cell-0"],
    );
    return c.json(publicRequest(result.request));
  });

  return app;
}

function isApproved(
  session: Session,
): session is Session & { user: NonNullable<Session["user"]> } {
  return session.user !== null && session.user.approved;
}

function limitCredentialAttempts(
  c: Context,
  next: () => Promise<void>,
  buckets: Map<string, number[]>,
  remoteAddress: string | undefined,
  maxBuckets: number,
): Promise<Response | void> {
  const now = Date.now();
  const ip = remoteAddress || "unknown";
  const attempts = (buckets.get(ip) ?? []).filter((at) => now - at < 60_000);
  buckets.delete(ip);
  if (attempts.length >= 20) {
    buckets.set(ip, attempts);
    return Promise.resolve(c.json({ error: "Request was not found." }, 429));
  }
  attempts.push(now);
  if (!buckets.has(ip) && buckets.size >= maxBuckets) {
    for (const [key, values] of buckets)
      if (values.every((at) => now - at >= 60_000)) buckets.delete(key);
    if (buckets.size >= maxBuckets) {
      const oldest = buckets.keys().next().value as string | undefined;
      if (oldest !== undefined) buckets.delete(oldest);
    }
  }
  buckets.set(ip, attempts);
  return next();
}

function unauthorized(c: Context) {
  return c.json(
    { error: "Sign in with an approved member account to continue." },
    401,
  );
}

function demoAvailable(): boolean {
  return (
    process.env.DEMO_MODE === "true" && process.env.NODE_ENV !== "production"
  );
}

function projectWorkspace(
  state: WorkspaceState,
  user: NonNullable<Session["user"]>,
): WorkspaceState {
  if (user.department === "cell-0" && user.isLeader)
    return {
      ...state,
      requests: state.requests.map(
        ({ trackingCodeHash: _trackingCodeHash, ...request }) => request,
      ),
    };
  const cell0RequestTaskIds = new Set<string>();
  if (user.department === "cell-0") {
    const approvedRequests = new Map(
      state.requests
        .filter((request) => request.status === "approved")
        .map((request) => [request.id, request]),
    );
    const assignedTaskIds = new Set(
      [...approvedRequests.values()].flatMap((request) =>
        request.taskId ? [request.taskId] : [],
      ),
    );
    for (const task of state.tasks) {
      const request = task.requestId
        ? approvedRequests.get(task.requestId)
        : undefined;
      if (
        assignedTaskIds.has(task.id) ||
        (request && !request.taskId)
      )
        cell0RequestTaskIds.add(task.id);
    }
  }
  const publicTasks = state.tasks.filter((task) =>
    user.department === "cell-0"
      ? task.department === "cell-0" || cell0RequestTaskIds.has(task.id)
      : task.department !== "cell-0",
  );
  return {
    catalog: state.catalog,
    bannerQuotes: state.bannerQuotes ? { quotes: [], daily: state.bannerQuotes.daily } : undefined,
    tasks: publicTasks.map((task) =>
      task.department === user.department || cell0RequestTaskIds.has(task.id)
        ? task
        : { ...task, privateNotes: [] },
    ),
    requests: user.department === "cell-0"
      ? state.requests.map(({ trackingCodeHash: _trackingCodeHash, ...request }) => request)
      : [],
    users: state.users.filter((leader) => leader.id === user.id),
    activities: state.activities.filter(
      (activity) => activity.department === user.department,
    ),
    notifications: state.notifications.filter(
      (notification) => notification.department === user.department,
    ),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOrigin(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.origin === value
    );
  } catch {
    return false;
  }
}

function isRequestInput(
  value: unknown,
): value is Parameters<typeof createRequest>[1] {
  if (!isRecord(value)) return false;
  const stringFields = [
    "ministry",
    "service",
    "title",
    "instructions",
    "notes",
    "dueAt",
  ] as const;
  return (
    stringFields.every((field) => typeof value[field] === "string") &&
    (value.airedDates === undefined ||
      (Array.isArray(value.airedDates) &&
        value.airedDates.every((date) => typeof date === "string")))
  );
}

interface TelegramNotice {
  text: string;
  departments: Department[];
}

function telegramForAction(
  action: WorkspaceAction,
  before: WorkspaceState,
  after: WorkspaceState,
  actorDepartment: Department,
): TelegramNotice | null {
  if (action.type === "approve") {
    const request = after.requests.find((item) => item.id === action.requestId);
    if (!request) return null;
    const task = after.tasks.find((item) => item.id === request.taskId);
    return {
      text: `Request ${request.reference} approved for ${request.ministry}: ${request.title}`,
      departments: ["cell-0", ...(task ? [task.department] : [])],
    };
  }
  if (action.type === "reject") {
    const request = after.requests.find((item) => item.id === action.requestId);
    return request
      ? {
          text: `Request ${request.reference} rejected by Cell 0: ${request.title}`,
          departments: ["cell-0"],
        }
      : null;
  }
  if (action.type === "update-task") {
    const oldTask = before.tasks.find((item) => item.id === action.taskId);
    const task = after.tasks.find((item) => item.id === action.taskId);
    if (
      task &&
      task.status === "completed" &&
      oldTask?.status !== "completed"
    ) {
      return {
        text: `Task completed for ${task.ministry}: ${task.title}`,
        departments: ["cell-0", task.department],
      };
    }
  }
  if (actorDepartment === "cell-0" && action.type === "create-task") {
    return null;
  }
  return null;
}

async function notifyTelegram(
  text: string,
  departments: Department[],
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error(
      "Telegram notification skipped: bot token is not configured.",
    );
    return;
  }
  const recipients = new Map<Department, string>([
    ["cell-0", process.env.TELEGRAM_CHAT_CELL_0 ?? ""],
    ["sound", process.env.TELEGRAM_CHAT_SOUND ?? ""],
    ["visual-media", process.env.TELEGRAM_CHAT_VISUAL_MEDIA ?? ""],
    ["design", process.env.TELEGRAM_CHAT_DESIGN ?? ""],
  ]);
  const sends = departments.map(async (department) => {
    const chatId = recipients.get(department);
    if (!chatId) {
      console.error(
        `Telegram notification skipped for ${department}: chat ID is not configured.`,
      );
      return;
    }
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text }),
        },
      );
      if (!response.ok)
        console.error(
          `Telegram notification failed for ${department}: HTTP ${response.status}`,
        );
    } catch (error) {
      console.error(
        `Telegram notification failed for ${department}: ${error instanceof Error ? error.message : "network error"}`,
      );
    }
  });
  await Promise.all(sends);
}
