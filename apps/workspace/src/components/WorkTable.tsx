import { AlertTriangle } from "lucide-react";
import type { DepartmentColor } from "@moc/shared";
import {
  Badge,
  DataTable,
  type BadgeTone,
  type DataTableColumnDef,
} from "@moc/ui";

/** The shared visible fields for request and task tables. */
export type WorkTableRow = {
  id: string;
  title: string;
  ministry: string;
  serviceName: string;
  dueAt: string;
  groupName: string;
  departmentName: string;
  departmentColor?: DepartmentColor;
  statusLabel: string;
  statusTone?: BadgeTone;
  isShortNotice?: boolean;
  onOpen: () => void;
};

// Explicit widths keep the same fields stable across views, filters, and empty states.
export const WORK_TABLE_MIN_WIDTH = 1080;

const dateTimeFormatter = new Intl.DateTimeFormat("en-ZA", {
  timeZone: "Africa/Johannesburg",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function TaskCell({ row }: { row: WorkTableRow }) {
  return (
    <button
      type="button"
      className="w-full appearance-none rounded-sm border-0 bg-transparent p-0 text-left text-sm font-semibold text-[var(--ink)] no-underline hover:no-underline focus-visible:outline-none focus-visible:shadow-[var(--ring-brand)]"
      aria-label={`Open ${row.title}`}
      onClick={row.onOpen}
    >
      {row.title}
    </button>
  );
}

function DueDateCell({ row }: { row: WorkTableRow }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <time dateTime={row.dueAt}>
        {dateTimeFormatter.format(new Date(row.dueAt))}
      </time>
      {row.isShortNotice && (
        <DataTable.CellNotice
          label="Short notice"
          className="text-[var(--warning-text)]"
        >
          <AlertTriangle size={14} aria-hidden="true" />
        </DataTable.CellNotice>
      )}
    </span>
  );
}

function GroupCell({ row }: { row: WorkTableRow }) {
  return <Badge color={row.departmentColor}>{row.groupName}</Badge>;
}

function DepartmentCell({ row }: { row: WorkTableRow }) {
  return <Badge color={row.departmentColor}>{row.departmentName}</Badge>;
}

function StatusCell({ row }: { row: WorkTableRow }) {
  return <Badge tone={row.statusTone}>{row.statusLabel}</Badge>;
}

export function createWorkColumns<T extends WorkTableRow>(): DataTableColumnDef<T>[] {
  return [
    {
      id: "task",
      header: "Task",
      accessorFn: (row) => row.title,
      meta: {
        rowHeader: true,
        label: "Task",
        headerClassName: "w-[240px]",
        className: "font-medium text-[var(--ink)]",
      },
      cell: ({ row }) => <TaskCell row={row.original} />,
    },
    {
      id: "ministry",
      header: "Ministry",
      accessorFn: (row) => row.ministry,
      meta: { label: "Ministry", headerClassName: "w-[120px]" },
    },
    {
      id: "service",
      header: "Service",
      accessorFn: (row) => row.serviceName,
      meta: { label: "Service", headerClassName: "w-[170px]" },
    },
    {
      id: "due-date",
      header: "Due date",
      accessorFn: (row) => row.dueAt,
      meta: { label: "Due date", headerClassName: "w-[170px]" },
      cell: ({ row }) => <DueDateCell row={row.original} />,
    },
    {
      id: "group",
      header: "Group",
      accessorFn: (row) => row.groupName,
      meta: { label: "Group", headerClassName: "w-[130px]" },
      cell: ({ row }) => <GroupCell row={row.original} />,
    },
    {
      id: "department",
      header: "Department",
      accessorFn: (row) => row.departmentName,
      meta: { label: "Department", headerClassName: "w-[140px]" },
      cell: ({ row }) => <DepartmentCell row={row.original} />,
    },
    {
      id: "status",
      header: "Status",
      accessorFn: (row) => row.statusLabel,
      meta: { label: "Status", headerClassName: "w-[110px]" },
      cell: ({ row }) => <StatusCell row={row.original} />,
    },
  ];
}

export const WorkTable = {
  createColumns: createWorkColumns,
  TaskCell,
  DueDateCell,
  GroupCell,
  DepartmentCell,
  StatusCell,
};
