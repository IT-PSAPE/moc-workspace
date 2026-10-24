import { DEPARTMENT_COLORS } from "./types";
import type {
  Activity,
  Catalog,
  DepartmentDefinition,
  InternalTaskInput,
  Leader,
  LifecycleTimestamps,
  Member,
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
const isLeader = (user: Leader) => user.approved && user.isLeader;
const isCell0Leader = (user: Leader) => isCell0(user) && isLeader(user);
const requireCell0 = (user: Leader, action: string) => {
  if (!isCell0(user) || !isLeader(user))
    throw new Error(`Only an approved Cell 0 leader can ${action}.`);
};
const requireLeader = (user: Leader, action: string) => {
  if (!isLeader(user))
    throw new Error(`Only an approved leader can ${action}.`);
};
const requireApproved = (state: WorkspaceState, user: Leader): Leader => {
  const current = state.users.find((candidate) => candidate.id === user.id);
  if (
    !user.approved ||
    !current?.approved ||
    current.department !== user.department ||
    current.duty !== user.duty
  ) {
    throw new Error("Your member access has not been approved.");
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

const isOneOf = <T>(value: unknown, values: readonly T[]): value is T =>
  values.includes(value as T);
const isStableCatalogId = (value: string) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
const taskStatuses = ["pending", "in-progress", "completed"] as const;

function normalizedName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function departmentFromCatalog(
  catalog: Catalog,
  department: unknown,
): DepartmentDefinition | undefined {
  return typeof department === "string"
    ? catalog.departments.find((item) => item.id === department)
    : undefined;
}

function requireValidGroups(
  catalog: Catalog,
  department: unknown,
  groups: unknown,
): asserts groups is string[] {
  const definition = departmentFromCatalog(catalog, department);
  if (!definition) throw new Error("Choose a valid department.");
  if (
    !Array.isArray(groups) ||
    groups.length === 0 ||
    Array.from(groups).some(
      (group) =>
        typeof group !== "string" || !definition.groups.includes(group),
    )
  )
    throw new Error("Choose one or more groups from the selected department.");
  if (new Set(groups.map(normalizedName)).size !== groups.length)
    throw new Error("A group can only be selected once.");
}

function requireNonEmptyString(
  value: unknown,
  field: string,
): asserts value is string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${field} is required.`);
}

function withoutRemovedTaskFields(task: Task): Task {
  const {
    priority: _priority,
    progress: _progress,
    completedAt: _completedAt,
    ...currentTask
  } = task as Task & {
    priority?: unknown;
    progress?: unknown;
    completedAt?: unknown;
  };
  return currentTask;
}

function recordMilestone(
  lifecycle: LifecycleTimestamps | undefined,
  milestone: keyof LifecycleTimestamps,
  timestamp: string,
): LifecycleTimestamps {
  return { ...lifecycle, [milestone]: lifecycle?.[milestone] ?? timestamp };
}

function validateInternalTaskInput(
  input: unknown,
  catalog: Catalog,
): asserts input is InternalTaskInput {
  if (!input || typeof input !== "object")
    throw new Error("Internal task details are required.");
  const value = input as Record<string, unknown>;
  requireNonEmptyString(value.title, "Task title");
  requireNonEmptyString(value.instructions, "Task instructions");
  requireNonEmptyString(value.notes, "Task notes");
  requireValidGroups(catalog, value.department, [value.subTeam]);
  if (typeof value.dueAt !== "string" || !isValidDueDate(value.dueAt))
    throw new Error("A valid task due date is required.");
  for (const field of ["ministry", "service"] as const) {
    if (value[field] !== undefined && typeof value[field] !== "string")
      throw new Error(`Task ${field} must be text.`);
  }
  if (typeof value.ministry === "string" && value.ministry && !catalog.ministries.includes(value.ministry))
    throw new Error("Choose a ministry from the ministry list.");
  if (value.service && value.service !== "internal") {
    const service = catalog.services.find((item) => item.id === value.service);
    if (
      !service ||
      service.department !== value.department ||
      service.subTeam !== value.subTeam
    )
      throw new Error("Choose a service mapped to the selected department and group.");
  }
}

function validateNewMemberInput(input: unknown, catalog: Catalog): void {
  if (!input || typeof input !== "object")
    throw new Error("Member details are required.");
  const value = input as Record<string, unknown>;
  requireNonEmptyString(value.name, "Member name");
  requireNonEmptyString(value.email, "Member email");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email.trim()))
    throw new Error("Enter a valid member email address.");
  requireNonEmptyString(value.duty, "Member duty");
  if (typeof value.isLeader !== "boolean")
    throw new Error("Choose whether the member is a leader.");
  requireValidGroups(catalog, value.department, value.groups);
}

function validateDepartmentInput(input: unknown): void {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Department details are required.");
  const value = input as Record<string, unknown>;
  requireNonEmptyString(value.id, "Department ID");
  if (!isStableCatalogId(value.id.trim()))
    throw new Error("Department ID must use lowercase letters, numbers, and hyphens.");
  requireNonEmptyString(value.name, "Department name");
  requireNonEmptyString(value.color, "Department color");
  if (!isOneOf(value.color, DEPARTMENT_COLORS))
    throw new Error("Choose a valid department color.");
  if (
    !Array.isArray(value.groups) ||
    value.groups.length === 0 ||
    value.groups.some((group) => typeof group !== "string" || !group.trim())
  )
    throw new Error("Add at least one department group.");
  if (new Set(value.groups.map(normalizedName)).size !== value.groups.length)
    throw new Error("Department group names must be unique.");
}

function validateGroupRenames(
  groupRenames: unknown,
  department: DepartmentDefinition,
  existing: DepartmentDefinition | undefined,
): Record<string, string> {
  if (groupRenames === undefined) return {};
  if (!groupRenames || typeof groupRenames !== "object" || Array.isArray(groupRenames))
    throw new Error("Department group renames must be a mapping.");
  const renames = groupRenames as Record<string, unknown>;
  const entries = Object.entries(renames);
  if (!existing && entries.length > 0)
    throw new Error("New departments cannot rename existing groups.");
  const sourceKeys = new Set<string>();
  const destinations = new Set<string>();
  for (const [source, destination] of entries) {
    requireNonEmptyString(source, "Original group name");
    requireNonEmptyString(destination, "New group name");
    const sourceKey = normalizedName(source);
    const destinationName = destination.trim();
    const destinationKey = normalizedName(destinationName);
    if (sourceKeys.has(sourceKey))
      throw new Error("A group can only be renamed once.");
    if (destinations.has(destinationKey))
      throw new Error("Group renames cannot target the same group.");
    if (!existing?.groups.includes(source))
      throw new Error("The original group to rename was not found.");
    if (source === destinationName)
      throw new Error("A group rename must use a different name.");
    if (!department.groups.some((group) => normalizedName(group) === destinationKey))
      throw new Error("Each renamed group must appear in the saved department groups.");
    sourceKeys.add(sourceKey);
    destinations.add(destinationKey);
  }
  const unchanged = existing?.groups
    .filter((group) => !sourceKeys.has(normalizedName(group)))
    .map(normalizedName) ?? [];
  if (entries.some(([, destination]) => unchanged.includes(normalizedName(destination as string))))
    throw new Error("Group renames cannot merge into another existing group.");
  const exactDestinations = Object.create(null) as Record<string, string>;
  for (const [source, destination] of entries) {
    const key = normalizedName(destination as string);
    exactDestinations[source] = department.groups.find(
      (group) => normalizedName(group) === key,
    )!;
  }
  return exactDestinations;
}

function validateServiceInput(input: unknown, catalog: Catalog): void {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Service details are required.");
  const value = input as Record<string, unknown>;
  requireNonEmptyString(value.id, "Service ID");
  if (!isStableCatalogId(value.id.trim()))
    throw new Error("Service ID must use lowercase letters, numbers, and hyphens.");
  requireNonEmptyString(value.name, "Service name");
  requireValidGroups(catalog, value.department, [value.subTeam]);
  if (
    value.requiresAiredDates !== undefined &&
    typeof value.requiresAiredDates !== "boolean"
  )
    throw new Error("Aired date requirement must be true or false.");
  if (value.enabled !== undefined && typeof value.enabled !== "boolean")
    throw new Error("Request type availability must be true or false.");
}

function validateMemberChanges(
  changes: unknown,
  catalog: Catalog,
  allowUncataloguedGroups = false,
): void {
  if (!changes || typeof changes !== "object" || Array.isArray(changes))
    throw new Error("Member changes are required.");
  const value = changes as Record<string, unknown>;
  const allowed = ["name", "duty", "department", "groups", "isLeader", "approved"];
  if (Object.keys(value).some((field) => !allowed.includes(field)))
    throw new Error("Email and unknown member fields cannot be changed.");
  if (Object.keys(value).length === 0)
    throw new Error("Choose at least one member field to change.");
  for (const field of ["name", "duty"] as const)
    if (value[field] !== undefined) requireNonEmptyString(value[field], field);
  if (value.department !== undefined && typeof value.department !== "string")
    throw new Error("Choose a valid department.");
  if (value.groups !== undefined && !Array.isArray(value.groups))
    throw new Error("Choose one or more groups from the selected department.");
  if (value.isLeader !== undefined && typeof value.isLeader !== "boolean")
    throw new Error("Leader status must be true or false.");
  if (value.approved !== undefined && typeof value.approved !== "boolean")
    throw new Error("Member access must be true or false.");
  if (
    !allowUncataloguedGroups &&
    value.department !== undefined &&
    value.groups !== undefined
  )
    requireValidGroups(catalog, value.department, value.groups);
}

function validateCreateGroups(input: unknown): string[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 20)
    throw new Error("Create up to 20 groups at a time.");
  const groups = input.map((group) => {
    if (typeof group !== "string")
      throw new Error("New group names must be text.");
    const label = group.trim();
    if (!label || label.length > 120)
      throw new Error("New group names must be between 1 and 120 characters.");
    return label;
  });
  if (new Set(groups.map(normalizedName)).size !== groups.length)
    throw new Error("New group names must be unique.");
  return groups;
}

function validateGroupAssignment(
  changes: unknown,
  createGroups: string[],
): void {
  if (createGroups.length === 0) return;
  if (!changes || typeof changes !== "object" || Array.isArray(changes))
    throw new Error("Member changes are required.");
  const groups = (changes as Record<string, unknown>).groups;
  if (!Array.isArray(groups) || groups.some((group) => typeof group !== "string"))
    throw new Error("Select every new group in the member's group assignment.");
  const selected = new Set(groups.map((group) => normalizedName(group as string)));
  if (createGroups.some((group) => !selected.has(normalizedName(group))))
    throw new Error("Select every new group in the member's group assignment.");
}

function validateSelectedIds(
  input: unknown,
  label: string,
): asserts input is string[] {
  const singular = label === "ministries" ? "ministry" : label.slice(0, -1);
  if (!Array.isArray(input) || input.length === 0 || input.length > 100)
    throw new Error(`Select between 1 and 100 ${label}.`);
  if (Array.from(input).some((id) => typeof id !== "string" || !id.trim()))
    throw new Error(`Every selected ${singular} needs a valid ID.`);
  if (new Set(input).size !== input.length)
    throw new Error(`Select each ${singular} only once.`);
}

/** Validate an untrusted action payload before it reaches domain state. */
export function validateWorkspaceAction(
  action: unknown,
  catalog?: Catalog,
): asserts action is WorkspaceAction {
  if (!action || typeof action !== "object" || Array.isArray(action))
    throw new Error("A workspace action is required.");
  const value = action as Record<string, unknown>;
  switch (value.type) {
    case "approve":
      requireNonEmptyString(value.requestId, "Request ID");
      return;
    case "reject":
      requireNonEmptyString(value.requestId, "Request ID");
      requireNonEmptyString(value.reason, "A rejection reason");
      return;
    case "update-task": {
      requireNonEmptyString(value.taskId, "Task ID");
      if (Object.prototype.hasOwnProperty.call(value, "progress"))
        throw new Error("Percentage progress is no longer supported; update task status.");
      if (value.status === undefined)
        throw new Error("Provide a task status to update.");
      if (!isOneOf(value.status, taskStatuses))
        throw new Error("Choose a valid task status.");
      return;
    }
    case "add-note":
      requireNonEmptyString(value.taskId, "Task ID");
      requireNonEmptyString(value.text, "A note");
      return;
    case "add-request-note":
      requireNonEmptyString(value.requestId, "Request ID");
      requireNonEmptyString(value.text, "A comment");
      return;
    case "create-task":
      if (catalog) validateInternalTaskInput(value.input, catalog);
      else if (!value.input || typeof value.input !== "object")
        throw new Error("Internal task details are required.");
      return;
    case "save-ministry":
      requireNonEmptyString(value.name, "Ministry name");
      if (value.previousName !== undefined)
        requireNonEmptyString(value.previousName, "Previous ministry name");
      return;
    case "set-ministry-enabled":
      requireNonEmptyString(value.name, "Ministry name");
      if (typeof value.enabled !== "boolean")
        throw new Error("Ministry availability must be true or false.");
      return;
    case "delete-ministry":
      requireNonEmptyString(value.name, "Ministry name");
      return;
    case "delete-ministries":
      validateSelectedIds(value.names, "ministries");
      if (new Set(value.names.map(normalizedName)).size !== value.names.length)
        throw new Error("Select each ministry only once.");
      return;
    case "save-service":
      if (catalog) validateServiceInput(value.service, catalog);
      else if (!value.service || typeof value.service !== "object")
        throw new Error("Service details are required.");
      else if ((value.service as Record<string, unknown>).enabled !== undefined &&
        typeof (value.service as Record<string, unknown>).enabled !== "boolean")
        throw new Error("Request type availability must be true or false.");
      return;
    case "delete-service":
      requireNonEmptyString(value.serviceId, "Service ID");
      return;
    case "delete-services":
      validateSelectedIds(value.serviceIds, "services");
      return;
    case "save-department":
      if (catalog) {
        validateDepartmentInput(value.department);
        const department = value.department as DepartmentDefinition;
        const existing = catalog.departments.find((item) => item.id === department.id);
        validateGroupRenames(value.groupRenames, department, existing);
      }
      else if (!value.department || typeof value.department !== "object")
        throw new Error("Department details are required.");
      return;
    case "delete-department":
      requireNonEmptyString(value.departmentId, "Department ID");
      return;
    case "delete-departments":
      validateSelectedIds(value.departmentIds, "departments");
      return;
    case "delete-members":
      validateSelectedIds(value.userIds, "members");
      return;
    case "move-members":
      validateSelectedIds(value.userIds, "members");
      requireNonEmptyString(value.department, "Department");
      if (catalog) requireValidGroups(catalog, value.department, value.groups);
      else if (
        !Array.isArray(value.groups) ||
        value.groups.length === 0 ||
        Array.from(value.groups).some((group) => typeof group !== "string" || !group.trim()) ||
        new Set(value.groups.map(normalizedName)).size !== value.groups.length
      )
        throw new Error("Choose one or more groups from the selected department.");
      return;
    case "invite-member":
      if (catalog) validateNewMemberInput(value.input, catalog);
      else if (!value.input || typeof value.input !== "object")
        throw new Error("Member details are required.");
      return;
    case "update-member":
      requireNonEmptyString(value.userId, "Member ID");
      {
        const createGroups = validateCreateGroups(value.createGroups);
        validateGroupAssignment(value.changes, createGroups);
        if (catalog)
          validateMemberChanges(value.changes, catalog, createGroups.length > 0);
        else if (!value.changes || typeof value.changes !== "object")
          throw new Error("Member changes are required.");
      }
      return;
    case "read-notifications":
      return;
    default:
      throw new Error("Choose a valid workspace action.");
  }
}

/** Existing choices may only be supplied from a request already found in stored state. */
export function validateRequest(
  input: RequestInput,
  catalog: Catalog,
  existingRequest?: Pick<MinistryRequest, "status" | "ministry" | "service">,
): void {
  if (!input || typeof input !== "object")
    throw new Error("Request details are required.");
  if (!catalog.ministries.includes(input.ministry))
    throw new Error("Choose a ministry from the ministry list.");
  const editingBacklog = existingRequest?.status === "backlog";
  if (
    catalog.disabledMinistries?.includes(input.ministry) &&
    !(editingBacklog && existingRequest.ministry === input.ministry)
  )
    throw new Error("This ministry is switched off. Choose an available ministry.");
  const service =
    typeof input.service === "string"
      ? catalog.services.find((item) => item.id === input.service)
      : undefined;
  if (!service) throw new Error("Choose a valid service.");
  if (
    service.enabled === false &&
    !(editingBacklog && existingRequest.service === input.service)
  )
    throw new Error("This request type is switched off. Choose an available request type.");
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
  validateRequest(input, state.catalog);
  const createdAt = nowIso();
  const request: MinistryRequest = {
    ...copyRequestInput(input),
    id: makeId("request"),
    reference: requestReference(state, createdAt),
    status: "backlog",
    createdAt,
    updatedAt: createdAt,
    lifecycle: { receivedAt: createdAt },
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
  if (existing.status !== "backlog")
    throw new Error("Only backlog requests can be edited.");
  validateRequest(input, state.catalog, existing);
  const request: MinistryRequest = {
    ...copyRequestInput(input),
    id: existing.id,
    reference: existing.reference,
    status: existing.status,
    createdAt: existing.createdAt,
    updatedAt: nowIso(),
    ...(existing.lifecycle ? { lifecycle: { ...existing.lifecycle } } : {}),
    ...(existing.privateNotes ? { privateNotes: existing.privateNotes } : {}),
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
          department: task.department,
          subTeam: task.subTeam,
          ...(task.lifecycle ? { lifecycle: { ...task.lifecycle } } : {}),
        }
      : null,
  };
}

/** Remove private data before any request crosses a public boundary. */
export function publicRequest(request: MinistryRequest): PublicRequest {
  const {
    trackingCodeHash: _trackingCodeHash,
    privateNotes: _privateNotes,
    ...safeRequest
  } = request;
  return safeRequest;
}

function makeRequestTask(
  request: MinistryRequest,
  catalog: Catalog,
  createdAt: string,
): Task {
  const service = catalog.services.find((item) => item.id === request.service);
  if (!service) throw new Error("The request service is no longer available.");
  return {
    id: makeId("task"),
    requestId: request.id,
    title: request.title,
    ministry: request.ministry,
    service: request.service,
    instructions: request.instructions,
    notes: request.notes,
    ...(request.airedDates ? { airedDates: [...request.airedDates] } : {}),
    department: service.department,
    subTeam: service.subTeam,
    status: "pending",
    dueAt: request.dueAt,
    createdAt,
    ...(request.lifecycle ? { lifecycle: { ...request.lifecycle } } : {}),
    privateNotes: [...(request.privateNotes ?? [])],
  };
}

function makeInternalTask(input: InternalTaskInput, catalog: Catalog): Task {
  validateInternalTaskInput(input, catalog);
  if (!isValidDueDate(input.dueAt))
    throw new Error("A valid task due date is required.");
  const ministry = input.ministry?.trim() || catalog.ministries[0];
  if (!ministry) throw new Error("Add a ministry before creating tasks.");
  return {
    title: input.title.trim(),
    ministry,
    service: input.service?.trim() || "internal",
    instructions: input.instructions.trim(),
    notes: input.notes.trim(),
    department: input.department,
    subTeam: input.subTeam,
    dueAt: input.dueAt,
    id: makeId("task"),
    status: "pending",
    createdAt: nowIso(),
    privateNotes: [],
  };
}

function saveMinistry(
  state: WorkspaceState,
  name: string,
  previousName?: string,
): WorkspaceState {
  const nextName = name.trim();
  const previous = previousName
    ? state.catalog.ministries.find(
        (item) => normalizedName(item) === normalizedName(previousName),
      )
    : undefined;
  if (previousName && !previous)
    throw new Error("The ministry to rename was not found.");
  if (
    state.catalog.ministries.some(
      (item) =>
        normalizedName(item) === normalizedName(nextName) && item !== previous,
    )
  )
    throw new Error("A ministry with that name already exists.");
  const ministries = previous
    ? state.catalog.ministries.map((item) => (item === previous ? nextName : item))
    : [...state.catalog.ministries, nextName];
  if (!previous)
    return { ...state, catalog: { ...state.catalog, ministries } };
  const previousKey = normalizedName(previous);
  return {
    ...state,
    catalog: {
      ...state.catalog,
      ministries,
      ...(state.catalog.disabledMinistries ? {
        disabledMinistries: state.catalog.disabledMinistries.map((item) =>
          normalizedName(item) === previousKey ? nextName : item,
        ),
      } : {}),
    },
    requests: state.requests.map((request) =>
      normalizedName(request.ministry) === previousKey
        ? { ...request, ministry: nextName }
        : request,
    ),
    tasks: state.tasks.map((task) =>
      normalizedName(task.ministry) === previousKey
        ? { ...withoutRemovedTaskFields(task), ministry: nextName }
        : task,
    ),
  };
}

function setMinistryEnabled(
  state: WorkspaceState,
  name: string,
  enabled: boolean,
): WorkspaceState {
  const ministry = state.catalog.ministries.find(
    (item) => normalizedName(item) === normalizedName(name),
  );
  if (!ministry) throw new Error("The ministry was not found.");
  const disabledMinistries = (state.catalog.disabledMinistries ?? []).filter(
    (item) => normalizedName(item) !== normalizedName(ministry),
  );
  if (!enabled) disabledMinistries.push(ministry);
  return { ...state, catalog: { ...state.catalog, disabledMinistries } };
}

function deleteMinistry(state: WorkspaceState, name: string): WorkspaceState {
  const ministry = state.catalog.ministries.find(
    (item) => normalizedName(item) === normalizedName(name),
  );
  if (!ministry) throw new Error("The ministry was not found.");
  const key = normalizedName(ministry);
  if (
    state.requests.some((request) => normalizedName(request.ministry) === key) ||
    state.tasks.some((task) => normalizedName(task.ministry) === key)
  )
    throw new Error("This ministry is in use by a request or task and cannot be deleted. Switch it off instead.");
  if (state.catalog.ministries.length === 1)
    throw new Error("At least one ministry must remain in the catalog. You can switch it off instead.");
  return {
    ...state,
    catalog: {
      ...state.catalog,
      ministries: state.catalog.ministries.filter((item) => item !== ministry),
      ...(state.catalog.disabledMinistries ? {
        disabledMinistries: state.catalog.disabledMinistries.filter(
          (item) => normalizedName(item) !== key,
        ),
      } : {}),
    },
  };
}

function saveService(state: WorkspaceState, input: unknown): WorkspaceState {
  validateServiceInput(input, state.catalog);
  const service = input as Catalog["services"][number];
  const existing = state.catalog.services.find((item) => item.id === service.id.trim());
  const normalized = {
    ...service,
    id: service.id.trim(),
    name: service.name.trim(),
    enabled: service.enabled ?? existing?.enabled ?? true,
  };
  if (
    state.catalog.services.some(
      (item) =>
        item.id !== normalized.id &&
        normalizedName(item.name) === normalizedName(normalized.name),
    )
  )
    throw new Error("A service with that name already exists.");
  const services = existing
    ? state.catalog.services.map((item) =>
        item.id === existing.id ? normalized : item,
      )
    : [...state.catalog.services, normalized];
  return { ...state, catalog: { ...state.catalog, services } };
}

function deleteService(state: WorkspaceState, serviceId: string): WorkspaceState {
  const service = state.catalog.services.find((item) => item.id === serviceId);
  if (!service) throw new Error("The service was not found.");
  if (
    state.requests.some((request) => request.service === serviceId) ||
    state.tasks.some((task) => task.service === serviceId)
  )
    throw new Error("This request type is in use by a request or task and cannot be deleted. Switch it off instead.");
  return {
    ...state,
    catalog: {
      ...state.catalog,
      services: state.catalog.services.filter((item) => item.id !== serviceId),
    },
  };
}

function saveDepartment(
  state: WorkspaceState,
  input: unknown,
  groupRenames?: Record<string, string>,
): WorkspaceState {
  validateDepartmentInput(input);
  const value = input as DepartmentDefinition;
  const department: DepartmentDefinition = {
    ...value,
    id: value.id.trim(),
    name: value.name.trim(),
    groups: value.groups.map((group) => group.trim()),
  };
  const existing = state.catalog.departments.find(
    (item) => item.id === department.id,
  );
  const renames = validateGroupRenames(groupRenames, department, existing);
  if (
    state.catalog.departments.some(
      (item) =>
        item.id !== department.id &&
        normalizedName(item.name) === normalizedName(department.name),
    )
  )
    throw new Error("A department with that name already exists.");
  if (!existing && department.id === "cell-0")
    throw new Error("Cell 0 keeps its reserved department ID.");
  if (existing) {
    const removedGroups = existing.groups.filter(
      (group) =>
        !renames[group] &&
        !department.groups.includes(group),
    );
    const referenced =
      state.users.some(
        (member) =>
          member.department === department.id &&
          member.groups.some((group) => removedGroups.includes(group)),
      ) ||
      state.tasks.some(
        (task) =>
          task.department === department.id &&
          removedGroups.includes(task.subTeam),
      ) ||
      state.catalog.services.some(
        (service) =>
          service.department === department.id &&
          removedGroups.includes(service.subTeam),
      );
    if (referenced)
      throw new Error("Reassign members, services, and tasks before removing a referenced group.");
  }
  const departments = existing
    ? state.catalog.departments.map((item) =>
        item.id === existing.id ? department : item,
      )
    : [...state.catalog.departments, department];
  const renamedUsers = Object.keys(renames).length
    ? state.users.map((member) =>
        member.department === department.id
          ? {
              ...member,
              groups: member.groups.map((group) => renames[group] ?? group),
            }
          : member,
      )
    : state.users;
  const renamedServices = Object.keys(renames).length
    ? state.catalog.services.map((service) =>
        service.department === department.id
          ? { ...service, subTeam: renames[service.subTeam] ?? service.subTeam }
          : service,
      )
    : state.catalog.services;
  const renamedTasks = Object.keys(renames).length
    ? state.tasks.map((task) =>
        task.department === department.id
          ? {
              ...withoutRemovedTaskFields(task),
              subTeam: renames[task.subTeam] ?? task.subTeam,
            }
          : task,
      )
    : state.tasks;
  return {
    ...state,
    catalog: { ...state.catalog, departments, services: renamedServices },
    users: renamedUsers,
    tasks: renamedTasks,
  };
}

function deleteDepartment(
  state: WorkspaceState,
  departmentId: string,
): WorkspaceState {
  if (departmentId === "cell-0")
    throw new Error("The Cell 0 department cannot be deleted.");
  const department = state.catalog.departments.find(
    (item) => item.id === departmentId,
  );
  if (!department) throw new Error("The department was not found.");
  if (
    state.users.some((member) => member.department === departmentId) ||
    state.tasks.some((task) => task.department === departmentId) ||
    state.catalog.services.some((service) => service.department === departmentId)
  )
    throw new Error("Reassign members, services, and tasks before deleting this department.");
  return {
    ...state,
    catalog: {
      ...state.catalog,
      departments: state.catalog.departments.filter(
        (item) => item.id !== departmentId,
      ),
    },
  };
}

function inviteMember(state: WorkspaceState, input: unknown): WorkspaceState {
  validateNewMemberInput(input, state.catalog);
  const value = input as {
    name: string;
    email: string;
    duty: string;
    department: string;
    groups: string[];
    isLeader: boolean;
  };
  const email = value.email.trim().toLowerCase();
  if (state.users.some((member) => normalizedName(member.email) === email))
    throw new Error("A member with that email already exists.");
  const member: Member = {
    id: makeId("member"),
    name: value.name.trim(),
    email,
    duty: value.duty.trim(),
    department: value.department,
    groups: [...value.groups],
    isLeader: value.isLeader,
    approved: true,
    invitedAt: nowIso(),
  };
  return {
    ...state,
    users: [...state.users, member],
    activities: appendActivity(
      state,
      `Invitation ready to share for ${member.name}.`,
      member.department,
      "access",
    ),
  };
}

function selectedMembers(state: WorkspaceState, userIds: string[]): Member[] {
  return userIds.map((id) => {
    const member = state.users.find((item) => item.id === id);
    if (!member) throw new Error("A selected member was not found.");
    return member;
  });
}

function deleteMembers(
  state: WorkspaceState,
  user: Leader,
  userIds: string[],
): WorkspaceState {
  const members = selectedMembers(state, userIds);
  if (members.some((member) => member.id === user.id))
    throw new Error("You cannot delete your own Cell 0 admin account.");
  const removedIds = new Set(userIds);
  return {
    ...state,
    users: state.users.filter((member) => !removedIds.has(member.id)),
    activities: appendActivity(
      state,
      `${members.length} workspace ${members.length === 1 ? "member" : "members"} removed.`,
      "cell-0",
      "access",
    ),
  };
}

function moveMembers(
  state: WorkspaceState,
  user: Leader,
  userIds: string[],
  department: string,
  groups: string[],
): WorkspaceState {
  const members = selectedMembers(state, userIds);
  if (members.some((member) => member.id === user.id))
    throw new Error("You cannot move your own Cell 0 admin account with a bulk action.");
  return userIds.reduce(
    (next, userId) => updateMember(next, user, userId, { department, groups }),
    state,
  );
}

function updateMember(
  state: WorkspaceState,
  user: Leader,
  userId: string,
  changes: unknown,
  createGroupsInput?: unknown,
): WorkspaceState {
  const createGroups = validateCreateGroups(createGroupsInput);
  validateGroupAssignment(changes, createGroups);
  validateMemberChanges(changes, state.catalog, createGroups.length > 0);
  const target = state.users.find((member) => member.id === userId);
  if (!target) throw new Error("The member was not found.");
  const value = changes as Partial<
    Pick<Member, "name" | "duty" | "department" | "groups" | "isLeader" | "approved">
  >;
  const department = value.department ?? target.department;
  const departmentDefinition = state.catalog.departments.find(
    (item) => item.id === department,
  );
  if (!departmentDefinition)
    throw new Error("Choose a valid department.");
  const canonicalGroups = new Map<string, string>();
  const newGroupLabels: string[] = [];
  for (const requested of createGroups) {
    const key = normalizedName(requested);
    const existing = departmentDefinition.groups.find(
      (group) => normalizedName(group) === key,
    );
    const canonical = existing ?? requested;
    canonicalGroups.set(key, canonical);
    if (!existing) newGroupLabels.push(canonical);
  }
  const groups = (value.groups ?? target.groups).map(
    (group) => canonicalGroups.get(normalizedName(group)) ?? group,
  );
  const nextDepartment = {
    ...departmentDefinition,
    groups: [...departmentDefinition.groups, ...newGroupLabels],
  };
  const nextCatalog: Catalog = {
    ...state.catalog,
    departments: state.catalog.departments.map((item) =>
      item.id === department ? nextDepartment : item,
    ),
  };
  requireValidGroups(nextCatalog, department, groups);
  if (
    target.id === user.id &&
    (value.approved === false ||
      value.isLeader === false ||
      department !== "cell-0")
  )
    throw new Error("You cannot revoke, demote, or move your own Cell 0 admin account.");
  const updated: Member = {
    ...target,
    ...(value.name !== undefined ? { name: value.name.trim() } : {}),
    ...(value.duty !== undefined ? { duty: value.duty.trim() } : {}),
    department,
    groups: [...groups],
    ...(value.isLeader !== undefined ? { isLeader: value.isLeader } : {}),
    ...(value.approved !== undefined ? { approved: value.approved } : {}),
  };
  return {
    ...state,
    catalog: nextCatalog,
    users: state.users.map((member) =>
      member.id === target.id ? updated : member,
    ),
    activities: appendActivity(
      state,
      `Member access updated for ${target.name}.`,
      target.department,
      "access",
    ),
  };
}

export function applyAction(
  state: WorkspaceState,
  user: Leader,
  action: WorkspaceAction,
): WorkspaceState {
  validateWorkspaceAction(action, state.catalog);
  user = requireApproved(state, user);
  switch (action.type) {
    case "approve": {
      requireCell0(user, "approve requests");
      const request = state.requests.find(
        (item) => item.id === action.requestId,
      );
      if (!request) throw new Error("Request was not found.");
      if (request.status !== "backlog" && request.status !== "rejected")
        throw new Error("Only backlog or rejected requests can be approved.");
      if (request.taskId || state.tasks.some((task) => task.requestId === request.id))
        throw new Error("This request already has an assigned task.");
      const timestamp = nowIso();
      const approvedRequest: MinistryRequest = {
        ...request,
        status: "approved",
        updatedAt: timestamp,
        lifecycle: recordMilestone(request.lifecycle, "approvedAt", timestamp),
      };
      const task = makeRequestTask(approvedRequest, state.catalog, timestamp);
      const updated = { ...approvedRequest, taskId: task.id };
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
      if (request.status !== "backlog")
        throw new Error("Only backlog requests can be rejected.");
      const timestamp = nowIso();
      const updated = {
        ...request,
        status: "rejected" as const,
        rejectionReason: action.reason.trim(),
        updatedAt: timestamp,
        lifecycle: recordMilestone(request.lifecycle, "rejectedAt", timestamp),
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
      if (!isCell0Leader(user) && task.department !== user.department)
        throw new Error("You can only edit tasks in your department.");
      const status = action.status;
      const statusChanged = task.status !== status;
      const milestone = statusChanged
        ? status === "in-progress"
          ? "inProgressAt"
          : status === "completed"
            ? "completedAt"
            : undefined
        : undefined;
      const request = task.requestId
        ? state.requests.find((item) => item.id === task.requestId)
        : undefined;
      const lifecycle = milestone
        ? recordMilestone({ ...request?.lifecycle, ...task.lifecycle }, milestone, nowIso())
        : task.lifecycle;
      const updated: Task = {
        ...withoutRemovedTaskFields(task),
        status,
        ...(lifecycle ? { lifecycle } : {}),
      };
      const nextState = {
        ...state,
        tasks: state.tasks.map((item) =>
          item.id === task.id ? updated : item,
        ),
        requests: milestone && request
          ? state.requests.map((item) => item.id === request.id
            ? { ...item, lifecycle: { ...item.lifecycle, ...lifecycle } }
            : item)
          : state.requests,
      };
      if (!statusChanged) return nextState;
      const justCompleted = updated.status === "completed";
      const statusLabel = updated.status === "in-progress" ? "in progress" : updated.status;
      const text = justCompleted
        ? `${updated.title} completed.`
        : `${updated.title} status changed to ${statusLabel}.`;
      return {
        ...nextState,
        activities: appendActivities(
          state,
          text,
          ["cell-0", updated.department],
          justCompleted ? "completed" : "status",
          updated.id,
        ),
        notifications: justCompleted
          ? appendNotifications(state, text, ["cell-0", updated.department])
          : state.notifications,
      };
    }
    case "add-request-note": {
      requireCell0(user, "comment on requests");
      const request = state.requests.find(
        (item) => item.id === action.requestId,
      );
      if (!request) throw new Error("Request was not found.");
      if (request.taskId)
        return applyAction(state, user, {
          type: "add-note",
          taskId: request.taskId,
          text: action.text,
        });
      const note = {
        id: makeId("note"),
        text: action.text.trim(),
        author: user.name,
        createdAt: nowIso(),
      };
      return {
        ...state,
        requests: state.requests.map((item) =>
          item.id === request.id
            ? { ...item, privateNotes: [...(item.privateNotes ?? []), note] }
            : item,
        ),
        activities: appendActivity(
          state,
          `Private comment added to ${request.title}.`,
          "cell-0",
          "note",
        ),
      };
    }
    case "add-note": {
      const task = state.tasks.find((item) => item.id === action.taskId);
      if (!task) throw new Error("Task was not found.");
      if (!isCell0Leader(user) && task.department !== user.department)
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
            ? {
                ...withoutRemovedTaskFields(item),
                privateNotes: [...item.privateNotes, note],
              }
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
      const task = makeInternalTask(action.input, state.catalog);
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
    case "save-ministry":
      requireLeader(user, "manage request options");
      return saveMinistry(state, action.name, action.previousName);
    case "set-ministry-enabled":
      requireLeader(user, "manage request options");
      return setMinistryEnabled(state, action.name, action.enabled);
    case "delete-ministry":
      requireLeader(user, "manage request options");
      return deleteMinistry(state, action.name);
    case "delete-ministries":
      requireLeader(user, "manage request options");
      return action.names.reduce(deleteMinistry, state);
    case "save-service":
      requireLeader(user, "manage request options");
      return saveService(state, action.service);
    case "delete-service":
      requireLeader(user, "manage request options");
      return deleteService(state, action.serviceId);
    case "delete-services":
      requireLeader(user, "manage request options");
      return action.serviceIds.reduce(deleteService, state);
    case "save-department":
      requireCell0(user, "manage departments");
      return saveDepartment(state, action.department, action.groupRenames);
    case "delete-department":
      requireCell0(user, "manage departments");
      return deleteDepartment(state, action.departmentId);
    case "delete-departments":
      requireCell0(user, "manage departments");
      return action.departmentIds.reduce(deleteDepartment, state);
    case "delete-members":
      requireCell0(user, "manage members");
      return deleteMembers(state, user, action.userIds);
    case "move-members":
      requireCell0(user, "manage members");
      return moveMembers(state, user, action.userIds, action.department, action.groups);
    case "invite-member":
      requireCell0(user, "invite members");
      return inviteMember(state, action.input);
    case "update-member":
      requireCell0(user, "manage members");
      return updateMember(
        state,
        user,
        action.userId,
        action.changes,
        action.createGroups,
      );
    case "read-notifications":
      return {
        ...state,
        notifications: state.notifications.map((item) =>
          isCell0Leader(user) || item.department === user.department
            ? { ...item, read: true }
            : item,
        ),
      };
  }
}
