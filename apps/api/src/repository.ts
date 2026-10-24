import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  DEPARTMENTS,
  DEPARTMENT_COLORS,
  MINISTRIES,
  SERVICES,
  createSeedState,
  type Catalog,
  type DepartmentDefinition,
  type Leader,
  type LifecycleTimestamps,
  type WorkspaceState,
} from "@moc/shared";
import { DEMO_TRACKING_CODES, hashTrackingCode } from "./tracking";

export interface Repository {
  read(): Promise<WorkspaceState>;
  update(
    mutator: (state: WorkspaceState) => WorkspaceState,
  ): Promise<WorkspaceState>;
  findApprovedLeaderByGoogleEmail(email: string): Promise<Leader | null>;
  getDemoLeaderByDepartment(department: Leader["department"]): Leader | null;
}

const initialState = (): WorkspaceState => {
  const state = createSeedState();
  return {
    ...state,
    requests: state.requests.map((request, index) => {
      const code = DEMO_TRACKING_CODES[index];
      return code
        ? {
            ...request,
            trackingCodeHash: hashTrackingCode(
              code.replace(/[\s-]/g, "").toUpperCase(),
            ),
          }
        : request;
    }),
  };
};

function parseState(source: string): WorkspaceState {
  const value: unknown = JSON.parse(source);
  if (typeof value !== "object" || value === null)
    throw new Error("Workspace state must be an object");
  const candidate = value as Partial<WorkspaceState>;
  if (
    !Array.isArray(candidate.tasks) ||
    !Array.isArray(candidate.requests) ||
    !Array.isArray(candidate.users) ||
    !Array.isArray(candidate.activities) ||
    !Array.isArray(candidate.notifications)
  ) {
    throw new Error("Workspace state is missing required collections");
  }
  const legacyTaskMinistries =
    candidate.catalog === undefined
      ? candidate.tasks.flatMap((task) =>
          isRecord(task) && typeof task.ministry === "string"
            ? [task.ministry]
            : [],
        )
      : [];
  const catalog = parseCatalog(candidate.catalog, legacyTaskMinistries);
  const parsedTasks = candidate.tasks.map((task) => {
    if (!isRecord(task)) throw new Error("Workspace task is malformed");
    const legacyTask = task as WorkspaceState["tasks"][number] & {
      priority?: unknown;
      progress?: unknown;
      completedAt?: unknown;
    };
    const {
      priority: _priority,
      progress: _progress,
      completedAt,
      ...currentTask
    } = legacyTask;
    if (!["pending", "in-progress", "completed"].includes(currentTask.status))
      throw new Error("Workspace task status is malformed");
    const lifecycle = parseLifecycle(currentTask.lifecycle, completedAt);
    return { ...currentTask, ...(lifecycle ? { lifecycle } : {}) };
  });
  const requests = candidate.requests.map((request) => {
    if (!isRecord(request)) throw new Error("Workspace request is malformed");
    const legacyRequest = request as Omit<
      WorkspaceState["requests"][number],
      "status"
    > & { status: WorkspaceState["requests"][number]["status"] | "pending" };
    const status = legacyRequest.status === "pending" ? "backlog" : legacyRequest.status;
    if (!["backlog", "approved", "rejected"].includes(status))
      throw new Error("Workspace request status is malformed");
    const lifecycle = parseLifecycle(legacyRequest.lifecycle);
    return { ...legacyRequest, status, ...(lifecycle ? { lifecycle } : {}) };
  });
  const tasks = parsedTasks.map((task) => {
    if (task.airedDates !== undefined) return task;
    const request = requests.find((item) => item.id === task.requestId || item.taskId === task.id);
    return request?.airedDates !== undefined
      ? { ...task, airedDates: [...request.airedDates] }
      : task;
  });
  const activities = candidate.activities.map((activity) => {
    if (!isRecord(activity)) throw new Error("Workspace activity is malformed");
    const legacyActivity = activity as Omit<
      WorkspaceState["activities"][number],
      "type"
    > & { type: WorkspaceState["activities"][number]["type"] | "progress" };
    return {
      ...legacyActivity,
      type: legacyActivity.type === "progress" ? "status" : legacyActivity.type,
      text: normalizeLegacyStatusText(legacyActivity.text),
    };
  });
  const notifications = candidate.notifications.map((notification) => {
    if (!isRecord(notification)) throw new Error("Workspace notification is malformed");
    return {
      ...notification,
      text: normalizeLegacyStatusText(notification.text),
    };
  });
  const users = candidate.users.map((member) => {
    if (!isRecord(member)) throw new Error("Workspace member is malformed");
    const legacyMember = member as Leader & { rank?: unknown };
    const { rank, ...currentMember } = legacyMember;
    if (
      typeof currentMember.id !== "string" ||
      typeof currentMember.name !== "string" ||
      typeof currentMember.email !== "string" ||
      typeof currentMember.department !== "string" ||
      typeof currentMember.approved !== "boolean"
    )
      throw new Error("Workspace member is missing required fields");
    if (rank !== undefined && (typeof rank !== "string" || !rank.trim()))
      throw new Error("Legacy member duty is malformed");
    if (
      currentMember.duty !== undefined &&
      (typeof currentMember.duty !== "string" || !currentMember.duty.trim())
    )
      throw new Error("Workspace member duty is malformed");
    if (
      currentMember.groups !== undefined &&
      (!Array.isArray(currentMember.groups) ||
        currentMember.groups.length === 0 ||
        currentMember.groups.some((group) => typeof group !== "string"))
    )
      throw new Error("Workspace member groups are malformed");
    if (
      currentMember.isLeader !== undefined &&
      typeof currentMember.isLeader !== "boolean"
    )
      throw new Error("Workspace member leadership status is malformed");
    const defaultGroups = catalog.departments.find(
      (department) => department.id === currentMember.department,
    )?.groups;
    if (!currentMember.duty && typeof rank !== "string")
      throw new Error("Workspace member is missing legacy duty data");
    if (!currentMember.groups && !defaultGroups)
      throw new Error("Workspace member department is missing from the catalog");
    const department = catalog.departments.find(
      (item) => item.id === currentMember.department,
    );
    const groups = currentMember.groups ?? defaultGroups ?? [];
    if (!department || groups.some((group) => !department.groups.includes(group)))
      throw new Error("Workspace member groups do not match the department catalog");
    return {
      ...currentMember,
      duty:
        typeof currentMember.duty === "string" && currentMember.duty.trim()
          ? currentMember.duty
          : typeof rank === "string" && rank.trim()
            ? rank
            : "Member",
      groups:
        Array.isArray(currentMember.groups) && currentMember.groups.length > 0
          ? [...currentMember.groups]
          : [...(defaultGroups ?? [])],
      isLeader:
        typeof currentMember.isLeader === "boolean"
          ? currentMember.isLeader
          : true,
    };
  });
  for (const task of tasks) {
    const department = catalog.departments.find(
      (item) => item.id === task.department,
    );
    if (!department || !department.groups.includes(task.subTeam))
      throw new Error("Workspace task routing does not match the department catalog");
    if (task.service !== "internal" && !catalog.services.some((item) => item.id === task.service))
      throw new Error("Workspace task service is missing from the catalog");
    if (!catalog.ministries.some((ministry) => foldName(ministry) === foldName(task.ministry)))
      throw new Error("Workspace task ministry is missing from the catalog");
  }
  for (const request of requests) {
    if (
      typeof request.ministry !== "string" ||
      !catalog.ministries.includes(request.ministry)
    )
      throw new Error("Workspace request ministry is missing from the catalog");
    if (
      typeof request.service !== "string" ||
      !catalog.services.some((item) => item.id === request.service)
    )
      throw new Error("Workspace request service is missing from the catalog");
  }
  return { ...candidate, catalog, tasks, requests, activities, notifications, users } as WorkspaceState;
}

const lifecycleFields = [
  "receivedAt",
  "approvedAt",
  "rejectedAt",
  "inProgressAt",
  "completedAt",
] as const;

function parseLifecycle(value: unknown, legacyCompletedAt?: unknown): LifecycleTimestamps | undefined {
  if (value === undefined && legacyCompletedAt === undefined) return undefined;
  if (value !== undefined && !isRecord(value))
    throw new Error("Workspace lifecycle is malformed");
  const lifecycle = { ...(value ?? {}) } as Record<string, unknown>;
  if (legacyCompletedAt !== undefined) {
    if (!isIsoTimestamp(legacyCompletedAt))
      throw new Error("Workspace lifecycle completedAt is malformed");
    lifecycle.completedAt ??= legacyCompletedAt;
  }
  for (const [field, timestamp] of Object.entries(lifecycle)) {
    if (!lifecycleFields.some((candidate) => candidate === field) || !isIsoTimestamp(timestamp))
      throw new Error(`Workspace lifecycle ${field} is malformed`);
  }
  return lifecycle as LifecycleTimestamps;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, year, month, day, hour, minute, second] = match;
  const daysInMonth = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return Number(month) >= 1 && Number(month) <= 12 &&
    Number(day) >= 1 && Number(day) <= daysInMonth &&
    Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 59;
}

function parseCatalog(value: unknown, legacyTaskMinistries: string[] = []): Catalog {
  const isLegacyStateWithoutCatalog = value === undefined;
  if (!isLegacyStateWithoutCatalog && !isRecord(value))
    throw new Error("Workspace catalog is malformed");
  const source = (isLegacyStateWithoutCatalog ? {} : value) as Partial<Catalog>;
  if (
    !isLegacyStateWithoutCatalog &&
    (["ministries", "services", "departments"] as const).some(
      (collection) => !Object.prototype.hasOwnProperty.call(source, collection),
    )
  )
    throw new Error("Workspace catalog is incomplete");
  const ministries = isLegacyStateWithoutCatalog
    ? [
        ...MINISTRIES,
        ...legacyTaskMinistries.filter(
          (ministry) => !MINISTRIES.some((seeded) => foldName(seeded) === foldName(ministry)),
        ),
      ]
    : source.ministries;
  const services = isLegacyStateWithoutCatalog
    ? SERVICES.map((service) => ({ ...service }))
    : source.services;
  if (
    !Array.isArray(ministries) ||
    ministries.length === 0 ||
    ministries.some((ministry) => typeof ministry !== "string" || !ministry.trim())
  )
    throw new Error("Workspace ministry catalog is malformed");
  if (
    !Array.isArray(services) ||
    services.some(
      (service) =>
        !isRecord(service) ||
        typeof service.id !== "string" ||
        !service.id.trim() ||
        !isStableCatalogId(service.id) ||
        typeof service.name !== "string" ||
        !service.name.trim() ||
        typeof service.department !== "string" ||
        typeof service.subTeam !== "string" ||
        (service.enabled !== undefined && typeof service.enabled !== "boolean") ||
        (service.requiresAiredDates !== undefined &&
          typeof service.requiresAiredDates !== "boolean"),
    )
  )
    throw new Error("Workspace service catalog is malformed");
  const rawDepartments = isLegacyStateWithoutCatalog ? DEPARTMENTS : source.departments;
  if (!Array.isArray(rawDepartments) || rawDepartments.length === 0)
    throw new Error("Workspace department catalog is malformed");
  const departments = rawDepartments.map((department) => {
    if (
      !isRecord(department) ||
      typeof department.id !== "string" ||
      !department.id.trim() ||
      !isStableCatalogId(department.id) ||
      typeof department.name !== "string" ||
      !department.name.trim() ||
      !Array.isArray(department.groups) ||
      department.groups.length === 0 ||
      department.groups.some((group) => typeof group !== "string" || !group.trim()) ||
      !Object.prototype.hasOwnProperty.call(department, "color")
    )
      throw new Error("Workspace department catalog is malformed");
    const color = department.color;
    if (!DEPARTMENT_COLORS.some((preset) => preset === color))
      throw new Error("Workspace department color is malformed");
    return { ...department, groups: [...department.groups], color } as DepartmentDefinition;
  });
  const folded = foldName;
  const hasDuplicates = (values: string[]) =>
    new Set(values.map(folded)).size !== values.length;
  const disabledMinistries = source.disabledMinistries;
  if (
    disabledMinistries !== undefined &&
    (!Array.isArray(disabledMinistries) ||
      disabledMinistries.some((ministry) =>
        typeof ministry !== "string" || !ministries.includes(ministry)) ||
      hasDuplicates(disabledMinistries))
  )
    throw new Error("Workspace ministry availability is malformed");
  if (!departments.some((department) => department.id === "cell-0"))
    throw new Error("Workspace department catalog must include Cell 0");
  if (
    hasDuplicates(departments.map(({ id }) => id)) ||
    hasDuplicates(departments.map(({ name }) => name)) ||
    hasDuplicates(ministries) ||
    hasDuplicates(services.map((service) => service.name)) ||
    new Set(services.map((service) => service.id)).size !== services.length ||
    departments.some((department) => hasDuplicates(department.groups))
  )
    throw new Error("Workspace catalog contains duplicate names or IDs");
  if (
    services.some((service) => {
      const department = departments.find((item) => item.id === service.department);
      return !department || !department.groups.includes(service.subTeam);
    })
  )
    throw new Error("Workspace service routing does not match the department catalog");
  return {
    ministries: [...ministries],
    ...(disabledMinistries !== undefined
      ? { disabledMinistries: [...disabledMinistries] }
      : {}),
    services: services.map((service) => ({ ...service })),
    departments,
  };
}

function foldName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function isStableCatalogId(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeLegacyStatusText(text: string): string {
  return text.replace(
    /^([\s\S]+) (?:updated to|is now) (?:0|25|50|75|100)% complete\.$/,
    "$1 status updated.",
  );
}

function requiresMigration(source: string): boolean {
  const value: unknown = JSON.parse(source);
  if (typeof value !== "object" || value === null) return false;
  const state = value as Partial<WorkspaceState>;
  const hasLegacyTaskFields =
    Array.isArray(state.tasks) &&
    state.tasks.some(
      (task) =>
        typeof task === "object" &&
        task !== null &&
        (Object.prototype.hasOwnProperty.call(task, "priority") ||
          Object.prototype.hasOwnProperty.call(task, "progress") ||
          Object.prototype.hasOwnProperty.call(task, "completedAt")),
    );
  const hasLegacyRequestStatus = Array.isArray(state.requests) &&
    state.requests.some((request) => isRecord(request) &&
      (request as { status?: unknown }).status === "pending");
  const hasMissingAiredDateSnapshot = Array.isArray(state.tasks) &&
    Array.isArray(state.requests) && state.tasks.some((task) => {
      if (!isRecord(task) || task.airedDates !== undefined) return false;
      return state.requests!.some((request) => isRecord(request) &&
        (request.id === task.requestId || request.taskId === task.id) &&
        request.airedDates !== undefined);
    });
  const hasLegacyStatusHistory =
    (Array.isArray(state.activities) &&
      state.activities.some((activity) =>
        isRecord(activity) &&
        ((activity as { type?: unknown }).type === "progress" ||
          (typeof activity.text === "string" &&
            normalizeLegacyStatusText(activity.text) !== activity.text)),
      )) ||
    (Array.isArray(state.notifications) &&
      state.notifications.some((notification) =>
        isRecord(notification) &&
        typeof notification.text === "string" &&
        normalizeLegacyStatusText(notification.text) !== notification.text,
      ));
  const hasLegacyMember =
    Array.isArray(state.users) &&
    state.users.some((member) => {
      if (typeof member !== "object" || member === null) return false;
      return (
        Object.prototype.hasOwnProperty.call(member, "rank") ||
        !Object.prototype.hasOwnProperty.call(member, "duty") ||
        !Object.prototype.hasOwnProperty.call(member, "groups") ||
        !Object.prototype.hasOwnProperty.call(member, "isLeader")
      );
    });
  const catalog = state.catalog as Partial<Catalog> | undefined;
  const hasLegacyCatalog =
    !catalog ||
    !Array.isArray(catalog.ministries) ||
    !Array.isArray(catalog.services) ||
    !Array.isArray(catalog.departments) ||
    catalog.departments.some(
      (department) =>
        typeof department !== "object" ||
        department === null ||
        !Object.prototype.hasOwnProperty.call(department, "color"),
    );
  return hasLegacyTaskFields || hasLegacyRequestStatus || hasMissingAiredDateSnapshot ||
    hasLegacyStatusHistory || hasLegacyMember || hasLegacyCatalog;
}

/** Local JSON adapter. Replace this implementation with a durable repository for production. */
export class JsonRepository implements Repository {
  private pending: Promise<void> = Promise.resolve();
  private initialization: Promise<WorkspaceState> | undefined;
  private migration: Promise<void> | undefined;
  private readonly filePath: string;

  constructor(
    filePath: string,
    private readonly seed: () => WorkspaceState = initialState,
  ) {
    this.filePath = resolve(filePath);
  }

  async read(): Promise<WorkspaceState> {
    await this.migrateLegacyWorkspaceState();
    try {
      return parseState(await readFile(this.filePath, "utf8"));
    } catch (error) {
      if (isMissingFile(error)) {
        this.initialization ??= this.write(this.seed());
        return await this.initialization;
      }
      throw error;
    }
  }

  async update(
    mutator: (state: WorkspaceState) => WorkspaceState,
  ): Promise<WorkspaceState> {
    let release: (() => void) | undefined;
    const previous = this.pending;
    this.pending = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    await previous;
    try {
      const next = mutator(await this.read());
      return await this.write(next);
    } finally {
      release?.();
    }
  }

  async findApprovedLeaderByGoogleEmail(email: string): Promise<Leader | null> {
    const normalized = email.trim().toLowerCase();
    return (
      (await this.read()).users.find(
        (user) => user.approved && user.email.toLowerCase() === normalized,
      ) ?? null
    );
  }

  getDemoLeaderByDepartment(department: Leader["department"]): Leader | null {
    return (
      this.seed().users.find(
        (user) => user.department === department && user.approved,
      ) ?? null
    );
  }

  private async write(state: WorkspaceState): Promise<WorkspaceState> {
    const normalized = parseState(JSON.stringify(state));
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, this.filePath);
    return normalized;
  }

  private async migrateLegacyWorkspaceState(): Promise<void> {
    this.migration ??= (async () => {
      let source: string;
      try {
        source = await readFile(this.filePath, "utf8");
      } catch (error) {
        if (isMissingFile(error)) return;
        throw error;
      }
      if (!requiresMigration(source)) return;
      await this.write(parseState(source));
    })();
    await this.migration;
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
