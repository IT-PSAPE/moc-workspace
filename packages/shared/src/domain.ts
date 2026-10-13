import { DEPARTMENTS, getService, isDepartment, MINISTRIES } from "./catalog";
import type {
  Activity,
  InternalTaskInput,
  Leader,
  MinistryRequest,
  PublicTracking,
  PublicRequest,
  RequestInput,
  Task,
  WorkspaceAction,
  WorkspaceState,
} from "./types";

const nowIso = () => new Date().toISOString();
const makeId = (prefix: string) =>
  `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`;
const isCell0 = (user: Leader) => user.department === "cell-0";
const requireCell0 = (user: Leader, action: string) => {
  if (!isCell0(user) || !user.approved)
    throw new Error(`Only an approved Cell 0 user can ${action}.`);
};
const requireApproved = (state: WorkspaceState, user: Leader): Leader => {
  const current = state.users.find((candidate) => candidate.id === user.id);
  if (
    !user.approved ||
    !current?.approved ||
    current.department !== user.department ||
    current.rank !== user.rank
  ) {
    throw new Error("Your leader access has not been approved.");
  }
  return current;
};

function isRealDatePart(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1];
}

function isValidDueDate(value: string): boolean {
  if (typeof value !== "string") return false;
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?$/.exec(
      value,
    );
  if (
    !match ||
    !isRealDatePart(match[1]) ||
    !Number.isFinite(Date.parse(value))
  )
    return false;
  if (match[2] !== undefined)
    return (
      Number(match[2]) < 24 &&
      Number(match[3]) < 60 &&
      Number(match[4] ?? "0") < 60
    );
  return true;
}

function validLeaderRole(
  rank: Leader["rank"],
  department: Leader["department"],
): boolean {
  return department === "cell-0"
    ? ["BJN", "CMN", "SMN"].includes(rank)
    : ["GJN", "TJN"].includes(rank);
}

const isOneOf = <T>(value: unknown, values: readonly T[]): value is T =>
  values.includes(value as T);
const ranks = ["BJN", "CMN", "SMN", "GJN", "TJN"] as const;
const priorities = ["low", "medium", "high", "urgent"] as const;
const progressValues = [0, 25, 50, 75, 100] as const;
const taskStatuses = ["pending", "in-progress", "completed"] as const;

function requireNonEmptyString(
  value: unknown,
  field: string,
): asserts value is string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${field} is required.`);
}

function validateInternalTaskInput(
  input: unknown,
): asserts input is InternalTaskInput {
  if (!input || typeof input !== "object")
    throw new Error("Internal task details are required.");
  const value = input as Record<string, unknown>;
  requireNonEmptyString(value.title, "Task title");
  requireNonEmptyString(value.instructions, "Task instructions");
  requireNonEmptyString(value.notes, "Task notes");
  if (!isDepartment(value.department))
    throw new Error("Choose a valid task department.");
  const groups = DEPARTMENTS.find(
    (department) => department.id === value.department,
  )?.groups;
  if (!isOneOf(value.subTeam, groups ?? []))
    throw new Error("The selected group does not belong to that department.");
  if (!isOneOf(value.priority, priorities))
    throw new Error("Choose a valid task priority.");
  if (typeof value.dueAt !== "string" || !isValidDueDate(value.dueAt))
    throw new Error("A valid task due date is required.");
  for (const field of ["ministry", "service"] as const) {
    if (value[field] !== undefined && typeof value[field] !== "string")
      throw new Error(`Task ${field} must be text.`);
  }
}

function validateNewLeaderInput(input: unknown): void {
  if (!input || typeof input !== "object")
    throw new Error("Leader details are required.");
  const value = input as Record<string, unknown>;
  requireNonEmptyString(value.name, "Leader name");
  requireNonEmptyString(value.email, "Leader email");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email.trim()))
    throw new Error("Enter a valid leader email address.");
  if (!isDepartment(value.department))
    throw new Error("Choose a valid leader department.");
  if (!isOneOf(value.rank, ranks))
    throw new Error("Choose a valid leader rank.");
  if (typeof value.approved !== "boolean")
    throw new Error("Leader approval must be true or false.");
  if (!validLeaderRole(value.rank, value.department))
    throw new Error(
      "Leader rank does not match the selected department. Cell 0 uses BJN, CMN, or SMN; production departments use GJN or TJN.",
    );
}

/** Validate an untrusted action payload before it reaches domain state. */
export function validateWorkspaceAction(
  action: unknown,
): asserts action is WorkspaceAction {
  if (!action || typeof action !== "object" || Array.isArray(action))
    throw new Error("A workspace action is required.");
  const value = action as Record<string, unknown>;
  switch (value.type) {
    case "approve":
      requireNonEmptyString(value.requestId, "Request ID");
      if (!isOneOf(value.priority, priorities))
        throw new Error("Choose a valid request priority.");
      return;
    case "reject":
      requireNonEmptyString(value.requestId, "Request ID");
      requireNonEmptyString(value.reason, "A rejection reason");
      return;
    case "update-task": {
      requireNonEmptyString(value.taskId, "Task ID");
      if (
        value.progress === undefined &&
        value.status === undefined &&
        value.priority === undefined
      )
        throw new Error("Provide a task field to update.");
      if (
        value.progress !== undefined &&
        !isOneOf(value.progress, progressValues)
      )
        throw new Error("Progress must be 0, 25, 50, 75, or 100.");
      if (value.status !== undefined && !isOneOf(value.status, taskStatuses))
        throw new Error("Choose a valid task status.");
      if (value.priority !== undefined && !isOneOf(value.priority, priorities))
        throw new Error("Choose a valid task priority.");
      return;
    }
    case "add-note":
      requireNonEmptyString(value.taskId, "Task ID");
      requireNonEmptyString(value.text, "A note");
      return;
    case "create-task":
      validateInternalTaskInput(value.input);
      return;
    case "add-user":
      validateNewLeaderInput(value.input);
      return;
    case "update-user":
      requireNonEmptyString(value.userId, "Leader ID");
      if (typeof value.approved !== "boolean")
        throw new Error("Leader approval must be true or false.");
      return;
    case "read-notifications":
      return;
    default:
      throw new Error("Choose a valid workspace action.");
  }
}

export function validateRequest(input: RequestInput): void {
  if (!input || typeof input !== "object")
    throw new Error("Request details are required.");
  if (!MINISTRIES.includes(input.ministry))
    throw new Error("Choose a ministry from the ministry list.");
  const service =
    typeof input.service === "string" ? getService(input.service) : undefined;
  if (!service) throw new Error("Choose a valid service.");
  if (!input.title?.trim()) throw new Error("A request title is required.");
  if (!input.instructions?.trim())
    throw new Error("Instructions are required.");
  if (!input.notes?.trim()) throw new Error("Notes are required.");
  if (!input.dueAt || !isValidDueDate(input.dueAt))
    throw new Error("A valid due date is required.");
  if (Date.parse(input.dueAt) <= Date.now())
    throw new Error("The due date must be in the future.");
  const airedDates = input.airedDates ?? [];
  if (
    !Array.isArray(airedDates) ||
    airedDates.some((date) => !isRealDatePart(date))
  ) {
    throw new Error("Aired dates must use the exact YYYY-MM-DD format.");
  }
  const today = new Date().toISOString().slice(0, 10);
  if (airedDates.some((date) => date > today))
    throw new Error("Aired dates cannot be in the future.");
  if (service.requiresAiredDates && airedDates.length === 0)
    throw new Error("Add at least one aired date for this service.");
}

function copyRequestInput(input: RequestInput): RequestInput {
  return {
    ministry: input.ministry,
    service: input.service,
    title: input.title,
    instructions: input.instructions,
    notes: input.notes,
    dueAt: input.dueAt,
    ...(input.airedDates !== undefined
      ? { airedDates: [...input.airedDates] }
      : {}),
  };
}

function appendActivity(
  state: WorkspaceState,
  text: string,
  department: Activity["department"],
  type: Activity["type"],
  taskId?: string,
): Activity[] {
  const activity: Activity = {
    id: makeId("activity"),
    text,
    department,
    type,
    createdAt: nowIso(),
    ...(taskId ? { taskId } : {}),
  };
  return [...state.activities, activity];
}

function appendActivities(
  state: WorkspaceState,
  text: string,
  departments: Activity["department"][],
  type: Activity["type"],
  taskId?: string,
): Activity[] {
  return [...new Set(departments)].reduce((activities, department) => {
    const activity: Activity = {
      id: makeId("activity"),
      text,
      department,
      type,
      createdAt: nowIso(),
      ...(taskId ? { taskId } : {}),
    };
    return [...activities, activity];
  }, state.activities);
}

function appendNotifications(
  state: WorkspaceState,
  text: string,
  departments: Activity["department"][],
): WorkspaceState["notifications"] {
  const createdAt = nowIso();
  const notifications = [...new Set(departments)].map((department) => ({
    id: makeId("notification"),
    text,
    read: false,
    createdAt,
    department,
  }));
  return [...state.notifications, ...notifications];
}

function requestReference(state: WorkspaceState, timestamp: string): string {
  const year = new Date(timestamp).getFullYear();
  const prefix = `MOC-${year}-`;
  const sequence =
    state.requests.reduce((max, request) => {
      const match = request.reference.match(/^MOC-(\d{4})-(\d{4,})$/);
      return match && Number(match[1]) === year
        ? Math.max(max, Number(match[2]))
        : max;
    }, 0) + 1;
  return `${prefix}${String(sequence).padStart(4, "0")}`;
}

export function createRequest(
  state: WorkspaceState,
  input: RequestInput,
): { state: WorkspaceState; request: MinistryRequest } {
  validateRequest(input);
  const createdAt = nowIso();
  const request: MinistryRequest = {
    ...copyRequestInput(input),
    id: makeId("request"),
    reference: requestReference(state, createdAt),
    status: "pending",
    createdAt,
    updatedAt: createdAt,
  };
  const next = {
    ...state,
    requests: [...state.requests, request],
    activities: appendActivity(
      state,
      `Request ${request.reference} submitted by ${request.ministry}.`,
      "cell-0",
      "request",
    ),
    notifications: appendNotifications(
      state,
      `New request ${request.reference}`,
      ["cell-0"],
    ),
  };
  return { state: next, request };
}

export function updatePublicRequest(
  state: WorkspaceState,
  reference: string,
  ministry: string,
  input: RequestInput,
): { state: WorkspaceState; request: MinistryRequest } {
  const existing = state.requests.find(
    (request) =>
      request.reference === reference && request.ministry === ministry,
  );
  if (!existing) throw new Error("Request was not found.");
  if (existing.status !== "pending")
    throw new Error("Only pending requests can be edited.");
  validateRequest(input);
  const request: MinistryRequest = {
    ...copyRequestInput(input),
    id: existing.id,
    reference: existing.reference,
    status: existing.status,
    createdAt: existing.createdAt,
    updatedAt: nowIso(),
    ...(existing.trackingCodeHash
      ? { trackingCodeHash: existing.trackingCodeHash }
      : {}),
  };
  const text = `Request ${request.reference} was edited by ${request.ministry}.`;
  return {
    state: {
      ...state,
      requests: state.requests.map((item) =>
        item.id === existing.id ? request : item,
      ),
      activities: appendActivity(state, text, "cell-0", "request"),
      notifications: appendNotifications(
        state,
        `Request ${request.reference} was updated.`,
        ["cell-0"],
      ),
    },
    request,
  };
}

export function publicProjection(
  state: WorkspaceState,
  reference: string,
  ministry: string,
): PublicTracking | null {
  const request = state.requests.find(
    (item) => item.reference === reference && item.ministry === ministry,
  );
  if (!request) return null;
  const task = request.taskId
    ? state.tasks.find((item) => item.id === request.taskId)
    : undefined;
  return {
    request: {
      ...publicRequest(request),
      airedDates: request.airedDates ? [...request.airedDates] : undefined,
    },
    task: task
      ? {
          status: task.status,
          progress: task.progress,
          department: task.department,
          subTeam: task.subTeam,
          completedAt: task.completedAt,
        }
      : null,
  };
}

/** Remove the credential digest before any request crosses a public boundary. */
export function publicRequest(request: MinistryRequest): PublicRequest {
  const { trackingCodeHash: _trackingCodeHash, ...safeRequest } = request;
  return safeRequest;
}

function makeRequestTask(
  request: MinistryRequest,
  priority: Task["priority"],
): Task {
  const service = getService(request.service)!;
  const createdAt = nowIso();
  return {
    id: makeId("task"),
    requestId: request.id,
    title: request.title,
    ministry: request.ministry,
    service: request.service,
    instructions: request.instructions,
    notes: request.notes,
    department: service.department,
    subTeam: service.subTeam,
    status: "pending",
    priority,
    progress: 0,
    dueAt: request.dueAt,
    createdAt,
    privateNotes: [],
  };
}

function makeInternalTask(input: InternalTaskInput): Task {
  validateInternalTaskInput(input);
  if (input.department === "cell-0" && input.subTeam !== "Cell 0")
    throw new Error("Cell 0 tasks must use the Cell 0 group.");
  const group = DEPARTMENTS.find(
    (department) => department.id === input.department,
  )?.groups;
  if (!group?.includes(input.subTeam))
    throw new Error("The selected group does not belong to that department.");
  if (!isValidDueDate(input.dueAt))
    throw new Error("A valid task due date is required.");
  return {
    title: input.title.trim(),
    ministry: input.ministry?.trim() || "Administration",
    service: input.service?.trim() || "internal",
    instructions: input.instructions.trim(),
    notes: input.notes.trim(),
    department: input.department,
    subTeam: input.subTeam,
    priority: input.priority,
    dueAt: input.dueAt,
    id: makeId("task"),
    status: "pending",
    progress: 0,
    createdAt: nowIso(),
    privateNotes: [],
  };
}

export function applyAction(
  state: WorkspaceState,
  user: Leader,
  action: WorkspaceAction,
): WorkspaceState {
  validateWorkspaceAction(action);
  user = requireApproved(state, user);
  switch (action.type) {
    case "approve": {
      requireCell0(user, "approve requests");
      const request = state.requests.find(
        (item) => item.id === action.requestId,
      );
      if (!request) throw new Error("Request was not found.");
      if (request.status !== "pending")
        throw new Error("Only pending requests can be approved.");
      const task = makeRequestTask(request, action.priority);
      const updated = {
        ...request,
        status: "approved" as const,
        updatedAt: nowIso(),
        taskId: task.id,
      };
      const text = `${request.reference} approved and routed to ${task.department}.`;
      return {
        ...state,
        requests: state.requests.map((item) =>
          item.id === request.id ? updated : item,
        ),
        tasks: [...state.tasks, task],
        activities: appendActivities(
          state,
          text,
          ["cell-0", task.department],
          "approval",
          task.id,
        ),
        notifications: appendNotifications(state, text, [
          "cell-0",
          task.department,
        ]),
      };
    }
    case "reject": {
      requireCell0(user, "reject requests");
      if (!action.reason?.trim())
        throw new Error("A rejection reason is required.");
      const request = state.requests.find(
        (item) => item.id === action.requestId,
      );
      if (!request) throw new Error("Request was not found.");
      if (request.status !== "pending")
        throw new Error("Only pending requests can be rejected.");
      const updated = {
        ...request,
        status: "rejected" as const,
        rejectionReason: action.reason.trim(),
        updatedAt: nowIso(),
      };
      const text = `${request.reference} rejected: ${updated.rejectionReason}`;
      return {
        ...state,
        requests: state.requests.map((item) =>
          item.id === request.id ? updated : item,
        ),
        activities: appendActivity(state, text, "cell-0", "rejection"),
        notifications: appendNotifications(state, text, ["cell-0"]),
      };
    }
    case "update-task": {
      const task = state.tasks.find((item) => item.id === action.taskId);
      if (!task) throw new Error("Task was not found.");
      if (!isCell0(user) && task.department !== user.department)
        throw new Error("You can only edit tasks in your department.");
      let progress = action.progress ?? task.progress;
      let status = action.status ?? task.status;
      if (action.progress === 100 || action.status === "completed") {
        progress = 100;
        status = "completed";
      } else if (action.status === "pending") {
        progress = 0;
        status = "pending";
      } else if (action.status === "in-progress") {
        if (action.progress === undefined && progress === 100) progress = 75;
        if (action.progress === undefined && progress === 0) progress = 25;
        status = "in-progress";
      } else if (action.progress !== undefined) {
        status = progress === 0 ? "pending" : "in-progress";
      }
      const completedAt =
        status === "completed" ? (task.completedAt ?? nowIso()) : undefined;
      const updated: Task = {
        ...task,
        progress,
        status,
        ...(action.priority !== undefined ? { priority: action.priority } : {}),
        ...(completedAt ? { completedAt } : { completedAt: undefined }),
      };
      const justCompleted =
        task.status !== "completed" && updated.status === "completed";
      const text = justCompleted
        ? `${updated.title} completed.`
        : `${updated.title} updated to ${updated.progress}% complete.`;
      return {
        ...state,
        tasks: state.tasks.map((item) =>
          item.id === task.id ? updated : item,
        ),
        activities: appendActivities(
          state,
          text,
          ["cell-0", updated.department],
          justCompleted ? "completed" : "progress",
          updated.id,
        ),
        notifications: justCompleted
          ? appendNotifications(state, text, ["cell-0", updated.department])
          : state.notifications,
      };
    }
    case "add-note": {
      const task = state.tasks.find((item) => item.id === action.taskId);
      if (!task) throw new Error("Task was not found.");
      if (!isCell0(user) && task.department !== user.department)
        throw new Error(
          "You can only add private notes to tasks in your department.",
        );
      const note = {
        id: makeId("note"),
        text: action.text.trim(),
        author: user.name,
        createdAt: nowIso(),
      };
      return {
        ...state,
        tasks: state.tasks.map((item) =>
          item.id === task.id
            ? { ...item, privateNotes: [...item.privateNotes, note] }
            : item,
        ),
        activities: appendActivity(
          state,
          `Private note added to ${task.title}.`,
          task.department,
          "note",
          task.id,
        ),
      };
    }
    case "create-task": {
      requireCell0(user, "create internal tasks");
      const task = makeInternalTask(action.input);
      return {
        ...state,
        tasks: [...state.tasks, task],
        activities: appendActivity(
          state,
          `Internal task created: ${task.title}.`,
          task.department,
          "task",
          task.id,
        ),
      };
    }
    case "add-user": {
      requireCell0(user, "manage leader access");
      if (
        state.users.some(
          (item) =>
            item.email.toLowerCase() ===
            action.input.email.trim().toLowerCase(),
        )
      )
        throw new Error("A leader with that email already exists.");
      const added: Leader = {
        name: action.input.name.trim(),
        email: action.input.email.trim(),
        rank: action.input.rank,
        department: action.input.department,
        approved: action.input.approved,
        id: makeId("leader"),
      };
      return {
        ...state,
        users: [...state.users, added],
        activities: appendActivity(
          state,
          `Leader access added for ${added.name}.`,
          added.department,
          "access",
        ),
      };
    }
    case "update-user": {
      requireCell0(user, "manage leader access");
      const target = state.users.find((item) => item.id === action.userId);
      if (!target) throw new Error("Leader was not found.");
      if (target.id === user.id && !action.approved)
        throw new Error("You cannot revoke your own access.");
      return {
        ...state,
        users: state.users.map((item) =>
          item.id === target.id ? { ...item, approved: action.approved } : item,
        ),
        activities: appendActivity(
          state,
          `Leader access ${action.approved ? "approved" : "revoked"} for ${target.name}.`,
          target.department,
          "access",
        ),
      };
    }
    case "read-notifications":
      return {
        ...state,
        notifications: state.notifications.map((item) =>
          isCell0(user) || item.department === user.department
            ? { ...item, read: true }
            : item,
        ),
      };
  }
}
