import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import {
  Check,
  Clipboard,
  LockKeyhole,
  RefreshCw,
  UserPlus,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  CellCombobox,
  DataTable,
  EditableTextCell,
  Field,
  Modal,
  Switch,
  type DataTableColumnDef,
} from "@moc/ui";
import type { Department, DepartmentDefinition, Member, SubTeam } from "@moc/shared";
import { useWorkspace } from "@moc/client";
import { DepartmentManagement } from "../DepartmentManagement";
import RequestCatalog from "../RequestCatalog";
import BannerQuotes from "../BannerQuotes";
import { MemberBulkActions } from "../components/MemberBulkActions";
import "./workflows.css";
import "./members.css";

type MemberForm = Pick<
  Member,
  "name" | "email" | "duty" | "department" | "groups" | "isLeader"
>;

const blankForm: MemberForm = {
  name: "",
  email: "",
  duty: "",
  department: "",
  groups: [],
  isLeader: false,
};

function departmentName(
  id: string,
  departments: { id: string; name: string }[],
) {
  return departments.find((department) => department.id === id)?.name ?? id;
}

type MemberRow = {
  member: Member;
  departments: DepartmentDefinition[];
  dutyOptions: { value: string; label: string }[];
  busyKey: string;
  currentUserId: string;
  onSave: (member: Member, changes: Partial<Omit<MemberForm, "email">>, field: string, createGroups?: string[]) => Promise<void>;
  onChangeLeader: (member: Member, checked: boolean) => void;
  onChangeAccess: (member: Member, checked: boolean) => void;
};

// Stable definitions keep an open editor mounted while its row is saving.
const memberColumns: DataTableColumnDef<MemberRow>[] = [
  DataTable.createSelectionColumn<MemberRow>({
    getLabel: ({ member }) => `Select ${member.name}`,
  }),
  {
    id: "member", header: "Member",
    meta: { rowHeader: true, label: "Member", headerClassName: "w-[230px]", className: "p-0 text-sm font-semibold text-[var(--ink)] whitespace-normal" },
    cell: ({ row }) => {
      const { member, busyKey, onSave, currentUserId } = row.original;
      return <div className="relative">
        <EditableTextCell label={`Name for ${member.name}`} value={member.name}
          readOnly={Boolean(busyKey) && busyKey !== `member-${member.id}-name`}
          validate={(value) => value.trim() ? undefined : "Enter a member name."}
          onSave={(value) => onSave(member, { name: value.trim() }, "name")} />
        {member.id === currentUserId && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-normal text-[var(--muted)]">You</span>}
      </div>;
    },
  },
  {
    id: "email", header: "Email",
    meta: { label: "Email", headerClassName: "w-[230px]", className: "text-xs text-[var(--muted)] [overflow-wrap:anywhere]" },
    cell: ({ row }) => row.original.member.email,
  },
  {
    id: "duty", header: "Duty",
    meta: { label: "Duty", headerClassName: "w-[150px]", className: "p-0" },
    cell: ({ row }) => {
      const { member, dutyOptions, busyKey, onSave } = row.original;
      return <CellCombobox label={`${member.name} duty`} value={member.duty ? [member.duty] : []}
        options={dutyOptions} displayValue={member.duty ? <Badge>{member.duty}</Badge> : undefined}
        readOnly={Boolean(busyKey) && busyKey !== `member-${member.id}-duty`}
        onValueChange={(values) => values[0] ? onSave(member, { duty: values[0] }, "duty") : Promise.reject(new Error("Choose a duty."))}
        onCreate={(duty) => onSave(member, { duty }, "duty")} createLabel="Create new duty" />;
    },
  },
  {
    id: "department", header: "Department",
    meta: { label: "Department", headerClassName: "w-[170px]", className: "p-0" },
    cell: ({ row }) => {
      const { member, departments, busyKey, onSave, currentUserId } = row.original;
      const protectedAdmin = member.id === currentUserId && member.isLeader && member.department === "cell-0";
      return <CellCombobox label={`${member.name} department`} value={[member.department]}
        options={departments.map((department) => ({ value: department.id, label: department.name }))}
        displayValue={<Badge color={departments.find((department) => department.id === member.department)?.color}>{departmentName(member.department, departments)}</Badge>}
        disabled={protectedAdmin}
        readOnly={Boolean(busyKey) && busyKey !== `member-${member.id}-department`}
        onValueChange={([departmentId]) => {
          const nextDepartment = departments.find((item) => item.id === departmentId);
          if (!nextDepartment) return Promise.reject(new Error("Choose a valid department."));
          const groups = member.groups.filter((group) => nextDepartment.groups.includes(group));
          return onSave(member, { department: nextDepartment.id, groups: groups.length ? groups : nextDepartment.groups.slice(0, 1) }, "department");
        }} />;
    },
  },
  {
    id: "groups", header: "Groups",
    meta: { label: "Groups", headerClassName: "w-[180px]", className: "p-0" },
    cell: ({ row }) => {
      const { member, departments, busyKey, onSave, currentUserId } = row.original;
      const groupOptions = departments.find((item) => item.id === member.department)?.groups ?? [];
      const selectedGroups = member.groups.filter((group) => groupOptions.includes(group));
      const protectedAdmin = member.id === currentUserId && member.isLeader && member.department === "cell-0";
      return <CellCombobox label={`${member.name} groups`} multiple value={selectedGroups}
        options={groupOptions.map((group) => ({ value: group, label: group }))}
        displayValue={selectedGroups.length ? <span className="flex flex-wrap gap-1">{selectedGroups.map((group) => <Badge key={group} color={departments.find((department) => department.id === member.department)?.color}>{group}</Badge>)}</span> : "Not assigned"}
        disabled={protectedAdmin}
        readOnly={Boolean(busyKey) && busyKey !== `member-${member.id}-groups`}
        onValueChange={(groups) => groups.length ? onSave(member, { groups }, "groups") : Promise.reject(new Error("Choose at least one group."))}
        onCreate={(group) => onSave(member, { groups: [...selectedGroups, group] }, "groups", [group])}
        createLabel="Create new group" />;
    },
  },
  {
    id: "leader", header: "Leader",
    meta: { label: "Leader", headerClassName: "w-[90px]" },
    cell: ({ row }) => {
      const { member, busyKey, currentUserId, onChangeLeader } = row.original;
      const protectedAdmin = member.id === currentUserId && member.isLeader && member.department === "cell-0";
      return <Switch checked={member.isLeader} disabled={Boolean(busyKey) || protectedAdmin}
        name={`${member.name} leader role`} compact onChange={(checked) => onChangeLeader(member, checked)} />;
    },
  },
  {
    id: "access", header: "Access",
    meta: { label: "Access", headerClassName: "w-[90px]" },
    cell: ({ row }) => {
      const { member, busyKey, currentUserId, onChangeAccess } = row.original;
      return <Switch checked={member.approved} disabled={Boolean(busyKey) || member.id === currentUserId}
        name={`${member.name} workspace access`} compact onChange={(checked) => onChangeAccess(member, checked)} />;
    },
  },
];

export default function SettingsPage() {
  const { state, user, loading, act } = useWorkspace();
  const { hash } = useLocation();
  const section = hash === "public-request" ? "public-request" : hash === "banner-quotes" ? "banner-quotes" : hash === "departments" ? "departments" : "members";
  const [tableOverflow, setTableOverflow] = useState(false);
  const [tableWrapElement, setTableWrapElement] = useState<HTMLDivElement | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState<MemberForm>(blankForm);
  const [busyKey, setBusyKey] = useState("");
  const [feedback, setFeedback] = useState("");
  const [retryOperation, setRetryOperation] = useState<(() => Promise<void>) | null>(null);
  const [inviteLink, setInviteLink] = useState("");
  const [invitedEmail, setInvitedEmail] = useState("");
  const [copyFeedback, setCopyFeedback] = useState("");
  const inviteButtonRef = useRef<HTMLButtonElement>(null);
  const inviteNameRef = useRef<HTMLInputElement>(null);
  const inviteFeedbackRef = useRef<HTMLDivElement>(null);
  const departments = state?.catalog?.departments ?? [];
  const members = state?.users ?? [];
  const canManage = Boolean(
    user?.approved && user.isLeader && user.department === "cell-0",
  );
  const canManagePublicRequest = Boolean(user?.approved && user.isLeader);
  useEffect(() => {
    if (inviteOpen && feedback) inviteFeedbackRef.current?.focus();
  }, [inviteOpen, feedback]);
  const sortedMembers = useMemo(
    () =>
      members
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, "en-ZA")),
    [members],
  );
  const dutyOptions = useMemo(() => {
    const duties = new Map<string, string>();
    for (const member of members) {
      const duty = member.duty.trim();
      if (duty && !duties.has(duty.toLocaleLowerCase()))
        duties.set(duty.toLocaleLowerCase(), duty);
    }
    return [...duties.values()]
      .sort((a, b) => a.localeCompare(b))
      .map((duty) => ({ value: duty, label: duty }));
  }, [members]);

  useEffect(() => {
    const wrapper = tableWrapElement;
    if (section !== "members" || !wrapper) {
      setTableOverflow(false);
      return;
    }

    const updateOverflow = () =>
      setTableOverflow(wrapper.scrollWidth > wrapper.clientWidth + 1);
    updateOverflow();
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(wrapper);
    if (wrapper.firstElementChild) observer.observe(wrapper.firstElementChild);
    return () => observer.disconnect();
  }, [section, tableWrapElement, sortedMembers.length, inviteOpen, inviteLink]);

  const run = async (
    key: string,
    operation: () => Promise<void>,
    onSuccess?: () => void,
  ) => {
    setBusyKey(key);
    setFeedback("");
    try {
      await operation();
      setRetryOperation(null);
      onSuccess?.();
      return true;
    } catch (cause) {
      setRetryOperation(() => async () => {
        await operation();
        onSuccess?.();
      });
      setFeedback(
        cause instanceof Error ? cause.message : "The change could not be saved.",
      );
      return false;
    } finally {
      setBusyKey("");
    }
  };

  const initialForm = (): MemberForm => {
    const department =
      departments.find((item) => item.id !== "cell-0") ?? departments[0];
    return {
      ...blankForm,
      department: department?.id ?? "",
      groups: department?.groups.slice(0, 1) ?? [],
    };
  };

  const chooseDepartment = (
    form: MemberForm,
    update: (next: MemberForm) => void,
    departmentId: Department,
  ) => {
    const nextDepartment = departments.find(
      (department) => department.id === departmentId,
    );
    update({
      ...form,
      department: departmentId,
      groups: nextDepartment?.groups.slice(0, 1) ?? [],
    });
  };

  const toggleGroup = (
    form: MemberForm,
    update: (next: MemberForm) => void,
    group: SubTeam,
    checked: boolean,
  ) =>
    update({
      ...form,
      groups: checked
        ? [...new Set([...form.groups, group])]
        : form.groups.filter((item) => item !== group),
    });

  const inviteMember = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busyKey) return;
    if (!inviteForm.groups.length) {
      setFeedback("Choose at least one group for this member.");
      return;
    }
    await run(
      "invite",
      async () => {
        await act({
          type: "invite-member",
          input: {
            ...inviteForm,
            name: inviteForm.name.trim(),
            email: inviteForm.email.trim(),
            duty: inviteForm.duty.trim(),
          },
        });
      },
      () => {
        setInviteLink(`${window.location.origin}/login`);
        setInvitedEmail(inviteForm.email.trim());
        setCopyFeedback("");
        setInviteOpen(false);
        setInviteForm(initialForm());
        setFeedback("Member invited. Their sign-in link is ready to share.");
      },
    );
  };

  const saveMemberCell = async (
    member: Member,
    changes: Partial<Omit<MemberForm, "email">>,
    field: string,
    createGroups?: string[],
  ) => {
    const key = `member-${member.id}-${field}`;
    setBusyKey(key);
    try {
      await act({
        type: "update-member",
        userId: member.id,
        changes,
        ...(createGroups ? { createGroups } : {}),
      });
    } finally {
      setBusyKey("");
    }
  };

  const changeMemberAccess = (member: Member, approved: boolean) =>
    void run(`access-${member.id}`, async () => {
      await act({
        type: "update-member",
        userId: member.id,
        changes: { approved },
      });
    });

  const changeLeaderRole = (member: Member, isLeader: boolean) =>
    void run(`role-${member.id}`, async () => {
      await act({
        type: "update-member",
        userId: member.id,
        changes: { isLeader },
      });
    });

  const runMemberBulkAction = async (operation: () => Promise<void>) => {
    if (busyKey) throw new Error("Wait for the current change to finish.");
    setBusyKey("bulk-members");
    setFeedback("");
    setRetryOperation(null);
    try {
      await operation();
    } finally {
      setBusyKey("");
    }
  };

  const copyLink = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopyFeedback("Sign-in link copied.");
    } catch {
      setCopyFeedback("Copy was unavailable. Select the link above to copy it.");
    }
  };

  const retryLastAction = () => {
    const operation = retryOperation;
    if (operation) void run("retry", operation);
  };

  const closeInvite = () => {
    if (busyKey) return;
    setInviteOpen(false);
    setFeedback("");
    setRetryOperation(null);
  };

  if (loading)
    return (
      <div className="workspace-page">
        <div className="workflow-skeleton" />
      </div>
    );
  if (!user?.approved)
    return (
      <div className="workspace-page">
        <section className="workflow-empty">
          <LockKeyhole />
          <h2>Account access required</h2>
          <p>
            Sign in with an approved member account to view workspace settings.
          </p>
        </section>
      </div>
    );

  return (
    <div className="workspace-page workflow-page members-settings-page">
      <div className="page-header workflow-header">
        <div className="page-heading">
          <div>
            <h1>Settings</h1>
          </div>
        </div>
      </div>

      {feedback && !inviteOpen && (
        <div className="workflow-alert members-feedback" role="alert">
          <span>{feedback}</span>
          {retryOperation && (
            <Button
              size="sm"
              variant="secondary"
              disabled={Boolean(busyKey)}
              onClick={retryLastAction}
            >
              <RefreshCw size={14} />
              {busyKey === "retry" ? "Retrying…" : "Retry"}
            </Button>
          )}
          <button
            type="button"
            aria-label="Dismiss message"
            onClick={() => setFeedback("")}
          >
            <X size={15} />
          </button>
        </div>
      )}

      {section === "public-request" && canManagePublicRequest ? (
        <RequestCatalog />
      ) : section === "banner-quotes" && canManage ? (
        <BannerQuotes />
      ) : canManage ? (
        <>
          {section === "members" ? (
          <section
            className="members-section"
            id="members"
            aria-labelledby="members-heading"
          >
            <div className="members-section-heading">
              <h2 id="members-heading">Members</h2>
              <Button
                ref={inviteButtonRef}
                variant="primary"
                disabled={Boolean(busyKey)}
                onClick={() => {
                  setFeedback("");
                  setRetryOperation(null);
                  setInviteForm(initialForm());
                  setInviteOpen(true);
                }}
              >
                <UserPlus size={16} /> Invite member
              </Button>
            </div>

            {inviteLink && (
              <aside className="members-invite-ready" aria-live="polite">
                <div className="members-invite-ready-copy">
                  <Check size={17} aria-hidden="true" />
                  <div>
                    <strong>Invitation ready to share</strong>
                    <p>
                      Share this workspace sign-in link with {invitedEmail || "the invited member"}. Google must verify the invited email address. No email was sent.
                    </p>
                  </div>
                </div>
                <div className="members-invite-link-row">
                  <input
                    aria-label="Workspace sign-in link"
                    readOnly
                    value={inviteLink}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <Button size="sm" variant="secondary" onClick={() => void copyLink()}>
                    <Clipboard size={14} /> Copy link
                  </Button>
                </div>
                {copyFeedback && <span className="members-copy-feedback">{copyFeedback}</span>}
              </aside>
            )}

            <Modal open={inviteOpen} title="Invite a member" className="[--modal-width:560px]"
              initialFocus={inviteNameRef} finalFocus={inviteButtonRef}
              onClose={closeInvite}>
              <form className="members-form" onSubmit={inviteMember} aria-busy={Boolean(busyKey) || undefined}>
                <p className="m-0 text-sm leading-5 text-[var(--muted)]">The invitation is bound to the email address they verify.</p>
                <div className="members-form-grid">
                  <Field label="Full name">
                    <input
                      ref={inviteNameRef}
                      disabled={Boolean(busyKey)}
                      required
                      maxLength={120}
                      autoComplete="name"
                      value={inviteForm.name}
                      onChange={(event) =>
                        setInviteForm({ ...inviteForm, name: event.target.value })
                      }
                      placeholder="Member name"
                    />
                  </Field>
                  <Field label="Email address">
                    <input
                      disabled={Boolean(busyKey)}
                      required
                      type="email"
                      maxLength={254}
                      autoComplete="email"
                      value={inviteForm.email}
                      onChange={(event) =>
                        setInviteForm({ ...inviteForm, email: event.target.value })
                      }
                      placeholder="name@example.org"
                    />
                  </Field>
                  <Field label="Duty">
                    <input
                      disabled={Boolean(busyKey)}
                      required
                      maxLength={120}
                      value={inviteForm.duty}
                      onChange={(event) =>
                        setInviteForm({ ...inviteForm, duty: event.target.value })
                      }
                      placeholder="For example, Sound operator"
                    />
                  </Field>
                  <Field label="Department">
                    <select
                      disabled={Boolean(busyKey)}
                      required
                      value={inviteForm.department}
                      onChange={(event) =>
                        chooseDepartment(
                          inviteForm,
                          setInviteForm,
                          event.target.value,
                        )
                      }
                    >
                      <option value="" disabled>
                        Choose a department
                      </option>
                      {departments.map((department) => (
                        <option value={department.id} key={department.id}>
                          {department.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <GroupPicker
                  disabled={Boolean(busyKey)}
                  departments={departments}
                  form={inviteForm}
                  onToggle={(group, checked) =>
                    toggleGroup(inviteForm, setInviteForm, group, checked)
                  }
                />
                <Switch
                  className="member-switch"
                  checked={inviteForm.isLeader}
                  disabled={Boolean(busyKey)}
                  name="Invite member as a leader"
                  onChange={(checked) =>
                    setInviteForm({ ...inviteForm, isLeader: checked })
                  }
                  help="Leaders can manage request options. Workspace access is controlled separately."
                />
                {feedback && <div ref={inviteFeedbackRef} tabIndex={-1} className="workflow-alert members-feedback" role="alert">
                  <span>{feedback}</span>
                  {retryOperation && <Button size="sm" type="button" disabled={Boolean(busyKey)} onClick={retryLastAction}>
                    <RefreshCw size={14} aria-hidden="true" /> {busyKey === "retry" ? "Retrying…" : "Retry"}
                  </Button>}
                </div>}
                <div className="members-form-actions">
                  <Button type="button" disabled={Boolean(busyKey)} onClick={closeInvite}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    type="submit"
                    disabled={Boolean(busyKey) || departments.length === 0}
                  >
                    <UserPlus size={15} />
                    {busyKey === "invite" || busyKey === "retry" ? "Inviting…" : "Invite member"}
                  </Button>
                </div>
              </form>
            </Modal>

            {tableOverflow && <p className="members-table-scroll-cue" aria-hidden="true">Scroll horizontally to see all member fields →</p>}
            <DataTable.Root
              className="mt-2"
              columns={memberColumns}
              data={sortedMembers.map((member) => ({
                member, departments, dutyOptions, busyKey,
                currentUserId: user.id,
                onSave: saveMemberCell,
                onChangeLeader: changeLeaderRole,
                onChangeAccess: changeMemberAccess,
              }))}
              getRowId={(row) => row.member.id}
              enableRowSelection={(row) => !busyKey && row.original.member.id !== user.id}
            >
              <DataTable.SelectionBar<MemberRow> disabled={Boolean(busyKey)}>
                {({ selectedRows, clearSelection }) => (
                  <MemberBulkActions
                    members={selectedRows.map(({ member }) => member)}
                    departments={departments}
                    busy={Boolean(busyKey)}
                    onMove={async (department, groups) => {
                      await runMemberBulkAction(async () => {
                        await act({
                          type: "move-members",
                          userIds: selectedRows.map(({ member }) => member.id),
                          department,
                          groups,
                        });
                      });
                      clearSelection();
                    }}
                    onRemove={async () => {
                      await runMemberBulkAction(async () => {
                        await act({
                          type: "delete-members",
                          userIds: selectedRows.map(({ member }) => member.id),
                        });
                      });
                      clearSelection();
                    }}
                  />
                )}
              </DataTable.SelectionBar>
              <div
                ref={setTableWrapElement}
                className="members-table-wrap"
                role="region"
                aria-label="Members table; scroll horizontally to see all columns"
                tabIndex={0}
              >
                <DataTable.Table className="members-table min-w-[1180px] table-fixed" containerClassName="overflow-visible">
                  <DataTable.Caption>Workspace members</DataTable.Caption>
                  <DataTable.Header />
                  <DataTable.Body emptyMessage="No members yet. Invite the first member to get started." />
                </DataTable.Table>
              </div>
            </DataTable.Root>
          </section>
          ) : (
          <section
            className="members-section department-management-section"
            id="departments"
            aria-label="Departments and groups"
          >
            <DepartmentManagement />
          </section>
          )}
        </>
      ) : (
        <section className="members-section account-members-summary" aria-labelledby="account-heading">
          <div className="members-section-heading">
            <div>
              <div>
                <h2 id="account-heading">Your account</h2>
                <p>{user.name}</p>
              </div>
            </div>
            <Badge tone={user.approved ? "green" : "gold"}>
              {user.approved ? "Approved access" : "Access paused"}
            </Badge>
          </div>
          <dl className="members-account-details">
            <div><dt>Email</dt><dd>{user.email}</dd></div>
            <div><dt>Duty</dt><dd>{user.duty || "Not set"}</dd></div>
            <div><dt>Department</dt><dd>{departmentName(user.department, departments)}</dd></div>
            <div><dt>Groups</dt><dd>{user.groups?.join(", ") || "Not assigned"}</dd></div>
            <div><dt>Role</dt><dd>{user.isLeader ? "Leader" : "Member"}</dd></div>
          </dl>
        </section>
      )}
    </div>
  );
}

function GroupPicker({
  departments,
  form,
  onToggle,
  disabled = false,
}: {
  departments: { id: string; groups: string[] }[];
  form: MemberForm;
  onToggle: (group: string, checked: boolean) => void;
  disabled?: boolean;
}) {
  const groups = departments.find((department) => department.id === form.department)?.groups ?? [];
  return (
    <fieldset className="members-groups-fieldset" disabled={disabled}>
      <legend>Groups</legend>
      <div className="members-group-options">
        {groups.map((group) => (
          <label key={group} className="members-group-option">
            <input
              type="checkbox"
              checked={form.groups.includes(group)}
              onChange={(event) => onToggle(group, event.target.checked)}
            />
            <span>{group}</span>
          </label>
        ))}
        {groups.length === 0 && <span className="members-helper">Choose a department to see its groups.</span>}
      </div>
    </fieldset>
  );
}
