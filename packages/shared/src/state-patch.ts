import type { WorkspaceAction, WorkspaceState } from "./types";

/** Server-owned corrections; keyed arrays send only changed records/fields. */
export type StatePatch =
  | { kind: "replace"; value: unknown }
  | { kind: "object"; fields: Record<string, StatePatch>; remove: string[] }
  | { kind: "rows"; changes: [string, StatePatch][]; remove: string[]; order?: string[] };
export interface ActionReceipt { ok: true; changes?: StatePatch }

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const rows = (value: unknown): value is { id: string }[] =>
  Array.isArray(value) && value.every((item) => record(item) && typeof item.id === "string");

export function statePatch(before: unknown, after: unknown): StatePatch | undefined {
  if (JSON.stringify(before) === JSON.stringify(after)) return undefined;
  if (rows(before) && rows(after)) {
    const previous = new Map(before.map((row) => [row.id, row]));
    const next = new Map(after.map((row) => [row.id, row]));
    const remove = before.filter((row) => !next.has(row.id)).map((row) => row.id);
    const changes: [string, StatePatch][] = [];
    for (const row of after) {
      const patch = statePatch(previous.get(row.id), row);
      if (patch) changes.push([row.id, patch]);
    }
    const natural = [...before.filter((row) => next.has(row.id)), ...after.filter((row) => !previous.has(row.id))].map((row) => row.id);
    const order = after.map((row) => row.id);
    return { kind: "rows", changes, remove, ...(JSON.stringify(natural) === JSON.stringify(order) ? {} : { order }) };
  }
  if (record(before) && record(after)) {
    const fields = Object.fromEntries(Object.keys(after).flatMap((key) => {
      const patch = statePatch(before[key], after[key]);
      return patch ? [[key, patch]] : [];
    }));
    return { kind: "object", fields, remove: Object.keys(before).filter((key) => !(key in after)) };
  }
  return { kind: "replace", value: after };
}

export function applyStatePatch<T>(current: T, patch?: StatePatch): T {
  if (!patch) return current;
  if (patch.kind === "replace") return patch.value as T;
  if (patch.kind === "object") {
    const source: Record<string, unknown> = record(current) ? current : {};
    return Object.fromEntries([
      ...Object.entries(source).filter(([key]) => !patch.remove.includes(key) && !Object.hasOwn(patch.fields, key)),
      ...Object.entries(patch.fields).map(([key, value]) => [key, applyStatePatch(source[key], value)]),
    ]) as T;
  }
  const result = new Map((rows(current) ? current : []).map((row) => [row.id, row]));
  for (const id of patch.remove) result.delete(id);
  for (const [id, change] of patch.changes) result.set(id, applyStatePatch(result.get(id), change)!);
  if (!patch.order) return [...result.values()] as T;
  // Missing optimistic rows may have rolled back; preserve unrelated newer rows.
  return [...patch.order.filter((id) => result.has(id)).map((id) => result.get(id)), ...[...result].filter(([id]) => !patch.order!.includes(id)).map(([, row]) => row)] as T;
}

/** Include canonical targets even when another writer already made the same edit. */
export function workspaceActionPatch(before: WorkspaceState, after: WorkspaceState, action: WorkspaceAction): StatePatch {
  const diff = statePatch(before, after);
  const fields = diff?.kind === "object" ? { ...diff.fields } : {};
  if (/ministry|ministries|service|department/.test(action.type) || action.type === "update-member" || action.type === "move-members")
    fields.catalog = { kind: "replace", value: after.catalog };
  if (action.type.includes("banner-quote"))
    fields.bannerQuotes = { kind: "replace", value: after.bannerQuotes };
  if (action.type === "read-notifications")
    fields.notifications = { kind: "replace", value: after.notifications };
  function confirmRows(key: "tasks" | "requests" | "users", ids: string[]) {
    const confirmed = after[key].filter((item) => ids.includes(item.id));
    const existing = fields[key];
    fields[key] = {
      kind: "rows", remove: existing?.kind === "rows" ? existing.remove : [],
      changes: [
        ...(existing?.kind === "rows" ? existing.changes.filter(([id]) => !ids.includes(id)) : []),
        ...confirmed.map((row): [string, StatePatch] => [row.id, { kind: "replace", value: row }]),
      ],
    };
  }
  if (action.type === "update-task") {
    confirmRows("tasks", [action.taskId]);
    const requestId = after.tasks.find((task) => task.id === action.taskId)?.requestId;
    if (requestId) confirmRows("requests", [requestId]);
  }
  if (action.type === "delete-request") {
    const taskIds = before.tasks.filter((task) => task.requestId === action.requestId).map((task) => task.id);
    if (taskIds.length) confirmRows("tasks", taskIds);
  }
  if (action.type === "update-member") confirmRows("users", [action.userId]);
  if (action.type === "move-members") confirmRows("users", action.userIds);
  return { kind: "object", fields, remove: diff?.kind === "object" ? diff.remove : [] };
}
