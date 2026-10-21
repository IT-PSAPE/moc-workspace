export type Department = string;
export type SubTeam = string;
export type DepartmentColor =
  | "pink"
  | "purple"
  | "amber"
  | "blue"
  | "green"
  | "teal";
export interface DepartmentDefinition {
  id: Department;
  name: string;
  groups: SubTeam[];
  color: DepartmentColor;
}
export type TaskStatus = "pending" | "in-progress" | "completed";
export type Progress = 0 | 25 | 50 | 75 | 100;
export type ApprovalStatus = "pending" | "approved" | "rejected";
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
  department: Department;
  subTeam: SubTeam;
  status: TaskStatus;
  progress: Progress;
  dueAt: string;
  createdAt: string;
  completedAt?: string;
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
    | "progress"
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
}
export interface PublicTracking {
  request: PublicRequest;
  task: Pick<
    Task,
    "status" | "progress" | "department" | "subTeam" | "completedAt"
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
  | { type: "approve"; requestId: string }
  | { type: "reject"; requestId: string; reason: string }
  | {
      type: "update-task";
      taskId: string;
      progress?: Progress;
      status?: TaskStatus;
    }
  | { type: "add-note"; taskId: string; text: string }
  | { type: "add-request-note"; requestId: string; text: string }
  | { type: "create-task"; input: InternalTaskInput }
  | { type: "save-ministry"; name: string; previousName?: string }
  | { type: "delete-ministry"; name: string }
  | { type: "save-service"; service: Service }
  | { type: "delete-service"; serviceId: string }
  | {
      type: "save-department";
      department: DepartmentDefinition;
      groupRenames?: Record<string, string>;
    }
  | { type: "delete-department"; departmentId: string }
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
    }
  | { type: "read-notifications" };
