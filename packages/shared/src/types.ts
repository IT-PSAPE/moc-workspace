export type Department = string;
export type SubTeam = string;
export const DEPARTMENT_COLORS = [
  "pink", "purple", "amber", "blue", "green", "teal",
  "red", "orange", "cyan", "indigo", "lime", "slate",
] as const;
export type DepartmentColor = (typeof DEPARTMENT_COLORS)[number];
export interface DepartmentDefinition {
  id: Department;
  name: string;
  groups: SubTeam[];
  color: DepartmentColor;
}
export type TaskStatus = "pending" | "in-progress" | "completed";
export type ApprovalStatus = "backlog" | "approved" | "rejected";
/** First recorded entry into each lifecycle stage; older records may have gaps. */
export interface LifecycleTimestamps {
  receivedAt?: string;
  approvedAt?: string;
  rejectedAt?: string;
  inProgressAt?: string;
  completedAt?: string;
}
export interface Member {
  id: string;
  name: string;
  email: string;
  duty: string;
  department: Department;
  groups: SubTeam[];
  isLeader: boolean;
  approved: boolean;
  invitedAt?: string;
}
export type Leader = Member;
export interface Catalog {
  ministries: string[];
  /** Ministries retained for historical requests but hidden from new submissions. */
  disabledMinistries?: string[];
  services: Service[];
  departments: DepartmentDefinition[];
}
export interface RequestInput {
  ministry: string;
  service: string;
  title: string;
  instructions: string;
  notes: string;
  dueAt: string;
  airedDates?: string[];
}
export interface MinistryRequest extends RequestInput {
  id: string;
  reference: string;
  status: ApprovalStatus;
  createdAt: string;
  updatedAt: string;
  lifecycle?: LifecycleTimestamps;
  rejectionReason?: string;
  taskId?: string;
  privateNotes?: Task["privateNotes"];
  /** SHA-256 digest of the issued public tracking credential. */
  trackingCodeHash?: string;
}
export interface Task {
  id: string;
  requestId?: string;
  title: string;
  ministry: string;
  service: string;
  instructions: string;
  notes: string;
  airedDates?: string[];
  department: Department;
  subTeam: SubTeam;
  status: TaskStatus;
  dueAt: string;
  createdAt: string;
  lifecycle?: LifecycleTimestamps;
  privateNotes: {
    id: string;
    text: string;
    author: string;
    createdAt: string;
  }[];
}
export interface Activity {
  id: string;
  text: string;
  department: Department;
  type:
    | "request"
    | "approval"
    | "rejection"
    | "status"
    | "completed"
    | "note"
    | "task"
    | "access";
  createdAt: string;
  taskId?: string;
}
export interface Notification {
  id: string;
  text: string;
  read: boolean;
  createdAt: string;
  department: Department;
}
export interface WorkspaceState {
  catalog: Catalog;
  tasks: Task[];
  requests: MinistryRequest[];
  users: Leader[];
  activities: Activity[];
  notifications: Notification[];
  /** Optional for workspaces saved before configurable banner quotes. */
  bannerQuotes?: BannerQuoteSettings;
}
export interface BannerQuote {
  id: string;
  text: string;
  author: string;
}
export interface BannerQuoteSettings {
  quotes: BannerQuote[];
  /** Snapshots keep today's banner stable when the library is edited. */
  daily?: {
    date: string;
    selected: BannerQuote | null;
    override?: BannerQuote;
  };
}
export interface Session {
  user: Leader | null;
  demo: boolean;
}
export interface Service {
  id: string;
  name: string;
  department: Department;
  subTeam: SubTeam;
  requiresAiredDates?: boolean;
  /** Missing values remain enabled for catalogs saved before availability controls. */
  enabled?: boolean;
}
export interface PublicTracking {
  request: PublicRequest;
  task: Pick<
    Task,
    "status" | "department" | "subTeam" | "lifecycle"
  > | null;
}
export type PublicRequest = Omit<
  MinistryRequest,
  "trackingCodeHash" | "privateNotes"
>;
export interface SubmissionReceipt {
  request: PublicRequest;
  trackingCode: string;
}
export interface InternalTaskInput {
  title: string;
  department: Department;
  subTeam: SubTeam;
  dueAt: string;
  instructions: string;
  notes: string;
  ministry?: string;
  service?: string;
}
export type WorkspaceAction =
  | { type: "save-banner-quote"; quote: { id?: string; text: string; author: string } }
  | { type: "delete-banner-quotes"; quoteIds: string[] }
  | { type: "set-banner-quote-today"; quoteId: string }
  | { type: "reset-banner-quote-today" }
  | { type: "approve"; requestId: string }
  | { type: "reject"; requestId: string; reason: string }
  | {
      type: "update-task";
      taskId: string;
      status: TaskStatus;
    }
  | { type: "add-note"; taskId: string; text: string }
  | { type: "add-request-note"; requestId: string; text: string }
  | { type: "create-task"; input: InternalTaskInput }
  | { type: "save-ministry"; name: string; previousName?: string }
  | { type: "set-ministry-enabled"; name: string; enabled: boolean }
  | { type: "delete-ministry"; name: string }
  | { type: "delete-ministries"; names: string[] }
  | { type: "save-service"; service: Service }
  | { type: "delete-service"; serviceId: string }
  | { type: "delete-services"; serviceIds: string[] }
  | {
      type: "save-department";
      department: DepartmentDefinition;
      groupRenames?: Record<string, string>;
    }
  | { type: "delete-department"; departmentId: string }
  | { type: "delete-departments"; departmentIds: string[] }
  | { type: "delete-members"; userIds: string[] }
  | {
      type: "move-members";
      userIds: string[];
      department: Department;
      groups: SubTeam[];
    }
  | {
      type: "invite-member";
      input: {
        name: string;
        email: string;
        duty: string;
        department: Department;
        groups: SubTeam[];
        isLeader: boolean;
      };
    }
  | {
      type: "update-member";
      userId: string;
      changes: Partial<
        Pick<
          Member,
          | "name"
          | "duty"
          | "department"
          | "groups"
          | "isLeader"
          | "approved"
        >
      >;
      createGroups?: string[];
    }
  | { type: "read-notifications" };
