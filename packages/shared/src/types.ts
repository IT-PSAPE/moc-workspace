export type Department = "cell-0" | "sound" | "visual-media" | "design";
export type SubTeam =
  | "Photography"
  | "Video"
  | "Graphic Design"
  | "Art Production"
  | "Sound"
  | "Cell 0";
export type TaskStatus = "pending" | "in-progress" | "completed";
export type Priority = "low" | "medium" | "high" | "urgent";
export type Progress = 0 | 25 | 50 | 75 | 100;
export type ApprovalStatus = "pending" | "approved" | "rejected";
export interface Leader {
  id: string;
  name: string;
  email: string;
  rank: "BJN" | "CMN" | "SMN" | "GJN" | "TJN";
  department: Department;
  approved: boolean;
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
  priority: Priority;
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
  request: MinistryRequest;
  task: Pick<
    Task,
    "status" | "progress" | "department" | "subTeam" | "completedAt"
  > | null;
}
export interface InternalTaskInput {
  title: string;
  department: Department;
  subTeam: SubTeam;
  priority: Priority;
  dueAt: string;
  instructions: string;
  notes: string;
  ministry?: string;
  service?: string;
}
export type WorkspaceAction =
  | { type: "approve"; requestId: string; priority: Priority }
  | { type: "reject"; requestId: string; reason: string }
  | {
      type: "update-task";
      taskId: string;
      progress?: Progress;
      status?: TaskStatus;
      priority?: Priority;
    }
  | { type: "add-note"; taskId: string; text: string }
  | { type: "create-task"; input: InternalTaskInput }
  | { type: "add-user"; input: Omit<Leader, "id"> }
  | { type: "update-user"; userId: string; approved: boolean }
  | { type: "read-notifications" };
