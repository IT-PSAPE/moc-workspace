import { applyAction, applyStatePatch, projectWorkspace, statePatch, type ActionReceipt, type StatePatch, type WorkspaceAction, type WorkspaceState } from "@moc/shared";

interface PendingSave { action: WorkspaceAction; patch?: StatePatch; createdIds: Set<string> }

function collectIds(value: unknown, result = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => collectIds(item, result));
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if ((key === "id" || key.endsWith("Id")) && typeof item === "string") result.add(item);
      else if (key.endsWith("Ids") && Array.isArray(item)) item.forEach((id) => { if (typeof id === "string") result.add(id); });
      else collectIds(item, result);
    }
  }
  return result;
}

function restoreOptimisticIds(value: unknown, replacements: Map<string, string>): unknown {
  if (typeof value === "string") return replacements.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => restoreOptimisticIds(item, replacements));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, restoreOptimisticIds(item, replacements)]));
  return value;
}

function generatedIds(before: WorkspaceState, after: WorkspaceState, action: WorkspaceAction) {
  const known = collectIds(before);
  const supplied = collectIds(action);
  return new Set([...collectIds(after)].filter((id) => !known.has(id) && !supplied.has(id)));
}

/** Rebase pending edits over confirmed data instead of restoring a stale whole snapshot. */
export class OptimisticWorkspace {
  private pending: PendingSave[] = [];
  needsRefresh = false;
  constructor(private confirmed: WorkspaceState, private readonly userId: string) {}

  get state(): WorkspaceState {
    return this.pending.reduce((state, save) => applyStatePatch(state, save.patch), this.confirmed);
  }

  begin(action: WorkspaceAction): PendingSave {
    const references = collectIds(action);
    if (this.pending.some((save) => [...save.createdIds].some((id) => references.has(id))))
      throw new Error("This item is still saving. Please wait and try again.");
    const before = this.state;
    const user = before.users.find((member) => member.id === this.userId);
    if (!user) throw new Error("Please refresh your workspace before saving.");
    const after = projectWorkspace(applyAction(before, user, action), user);
    const save = {
      action,
      patch: statePatch(before, after),
      createdIds: generatedIds(before, after, action),
    };
    this.pending.push(save);
    return save;
  }

  finish(save: PendingSave, receipt?: ActionReceipt | WorkspaceState): WorkspaceState {
    if (receipt) this.confirmed = "ok" in receipt
      ? applyStatePatch(this.confirmed, receipt.changes) : receipt;
    this.pending = this.pending.filter((entry) => entry !== save);
    let visible = this.confirmed;
    for (const pending of this.pending) {
      try {
        const user = visible.users.find((member) => member.id === this.userId)!;
        const predicted = projectWorkspace(applyAction(visible, user, pending.action), user);
        const remainingIds = [...pending.createdIds];
        const replacements = new Map<string, string>();
        for (const id of generatedIds(visible, predicted, pending.action)) {
          const index = remainingIds.findIndex((existing) => existing.split("-")[0] === id.split("-")[0]);
          if (index !== -1) replacements.set(id, remainingIds.splice(index, 1)[0]);
        }
        const rebased = restoreOptimisticIds(predicted, replacements) as WorkspaceState;
        pending.createdIds = generatedIds(visible, rebased, pending.action);
        pending.patch = statePatch(visible, rebased);
        visible = rebased;
      } catch {
        // Stale/partial data may no longer support a prediction. Let the queued
        // server action validate it and keep its existing form error handling.
        pending.patch = undefined;
      }
    }
    return visible;
  }

  get confirmedState(): WorkspaceState { return this.confirmed; }
  get idle(): boolean { return this.pending.length === 0; }
}
