import { useEffect, useRef, useState } from "react";
import { ArrowRightLeft, Trash2 } from "lucide-react";
import { Badge, Button, CellCombobox, Modal } from "@moc/ui";
import type { DepartmentDefinition, Member } from "@moc/shared";
import { ConfirmDialog } from "./UiDialogs";

type MemberBulkActionsProps = {
  members: Member[];
  departments: DepartmentDefinition[];
  busy: boolean;
  onMove: (department: string, groups: string[]) => Promise<void>;
  onRemove: () => Promise<void>;
};

export function MemberBulkActions({
  members,
  departments,
  busy,
  onMove,
  onRemove,
}: MemberBulkActionsProps) {
  const [moveOpen, setMoveOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [departmentId, setDepartmentId] = useState("");
  const [groups, setGroups] = useState<string[]>([]);
  const [error, setError] = useState("");
  const moveInFlight = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const destination = departments.find((department) => department.id === departmentId);
  const memberNames = members.map((member) => member.name).join(", ");

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function move(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || moveInFlight.current) return;
    if (!destination || !groups.length) {
      setError("Choose a department and at least one group.");
      return;
    }
    moveInFlight.current = true;
    setError("");
    try {
      await onMove(destination.id, groups);
      setMoveOpen(false);
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : "Could not move these members. Try again.");
    } finally {
      moveInFlight.current = false;
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        disabled={busy}
        onClick={() => {
          setDepartmentId("");
          setGroups([]);
          setError("");
          setMoveOpen(true);
        }}
      >
        <ArrowRightLeft size={14} aria-hidden="true" />
        Move to department
      </Button>
      <Button type="button" size="sm" variant="danger" disabled={busy} onClick={() => setRemoveOpen(true)}>
        <Trash2 size={14} aria-hidden="true" />
        Remove members
      </Button>
      <Modal
        open={moveOpen}
        title="Move members"
        onClose={() => {
          if (!moveInFlight.current) setMoveOpen(false);
        }}
      >
        <form className="flex flex-col gap-5" onSubmit={(event) => void move(event)} aria-busy={busy || undefined}>
          <p className="m-0 text-sm leading-6 text-[var(--ink-secondary)]">
            Move {members.length} {members.length === 1 ? "member" : "members"}: {memberNames}.
          </p>
          <div className="space-y-2">
            <p className="m-0 text-sm font-medium text-[var(--ink)]">Department</p>
            <div className="rounded-[var(--radius-sm)] border border-[var(--line-control)]">
              <CellCombobox
                label="Destination department"
                value={departmentId ? [departmentId] : []}
                placeholder="Choose a department"
                options={departments.map((department) => ({ value: department.id, label: department.name }))}
                displayValue={destination ? <Badge color={destination.color}>{destination.name}</Badge> : undefined}
                readOnly={busy}
                onValueChange={async ([nextDepartmentId]) => {
                  setDepartmentId(nextDepartmentId ?? "");
                  setGroups([]);
                  setError("");
                }}
              />
            </div>
          </div>
          <div className="space-y-2">
            <p className="m-0 text-sm font-medium text-[var(--ink)]">Groups</p>
            <div className="rounded-[var(--radius-sm)] border border-[var(--line-control)]">
              <CellCombobox
                label="Destination groups"
                multiple
                value={groups}
                placeholder={destination ? "Choose groups" : "Choose a department first"}
                disabled={!destination}
                readOnly={busy}
                options={(destination?.groups ?? []).map((group) => ({ value: group, label: group }))}
                displayValue={groups.length ? <span className="flex flex-wrap gap-1">{groups.map((group) => <Badge key={group} color={destination?.color}>{group}</Badge>)}</span> : undefined}
                onValueChange={async (nextGroups) => {
                  setGroups(nextGroups);
                  setError("");
                }}
              />
            </div>
            <p className="m-0 text-xs leading-5 text-[var(--muted)]">Choose at least one group. This replaces the selected members’ current department and groups.</p>
          </div>
          {error && <p ref={errorRef} tabIndex={-1} role="alert" className="m-0 text-sm leading-5 text-[var(--danger-text)]">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" disabled={busy} onClick={() => setMoveOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={busy || !destination || !groups.length}>
              {busy ? "Moving…" : "Move members"}
            </Button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={removeOpen}
        onClose={() => setRemoveOpen(false)}
        title="Remove members?"
        description={`Remove ${members.length} ${members.length === 1 ? "workspace member" : "workspace members"}: ${memberNames}. They will lose workspace access. This cannot be undone.`}
        confirmLabel="Remove members"
        onConfirm={onRemove}
      />
    </>
  );
}
