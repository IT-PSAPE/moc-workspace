import {
  createContext,
  useContext,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  rowSelectionFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
  type ReactTable,
  type RowData,
  type Row,
} from "@tanstack/react-table";
import { Button as BaseButton } from "@base-ui/react/button";
import { Info, Minus } from "lucide-react";
import { Checkbox } from "./Checkbox";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "./table";
import { cn } from "./utils";
import { Tooltip } from "./tooltip";

export type DataTableColumnMeta = {
  className?: string;
  headerClassName?: string;
  rowHeader?: boolean;
  label?: string;
};

const dataTableFeatures = tableFeatures({
  columnMeta: {} as DataTableColumnMeta,
  rowSelectionFeature,
});

export type DataTableFeatures = typeof dataTableFeatures;
export type DataTableInstance<TData extends RowData> = ReactTable<DataTableFeatures, TData>;
export type DataTableColumnDef<TData extends RowData> = ColumnDef<DataTableFeatures, TData>;
export type DataTableRootProps<TData extends RowData> = ComponentProps<"div"> & {
  columns: DataTableColumnDef<TData>[];
  data: TData[];
  getRowId: (row: TData) => string;
  enableRowSelection?: boolean | ((row: Row<DataTableFeatures, TData>) => boolean);
  children: ReactNode;
};

const DataTableContext = createContext<unknown>(null);

function useInstance<TData extends RowData = RowData>() {
  const table = useContext(DataTableContext);
  if (!table) throw new Error("DataTable parts must be inside DataTable.Root.");
  // React context erases the row generic; Root and column definitions own it.
  return table as DataTableInstance<TData>;
}

function Root<TData extends RowData>({
  columns,
  data,
  getRowId,
  enableRowSelection,
  children,
  ...props
}: DataTableRootProps<TData>) {
  const table = useTable({
    features: dataTableFeatures,
    columns,
    data,
    getRowId: (row) => getRowId(row),
    enableRowSelection,
  });
  return (
    <DataTableContext.Provider value={table}>
      <Frame {...props}>{children}</Frame>
    </DataTableContext.Provider>
  );
}

function Frame({ className, ...props }: ComponentProps<"div">) {
  // Empty rows use this container's visible width even when the table scrolls.
  return (
    <div
      data-slot="data-table"
      className={cn("w-full min-w-0 max-w-full overflow-hidden rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-xs)] [container-type:inline-size]", className)}
      {...props}
    />
  );
}

function Toolbar({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="data-table-toolbar" className={cn("flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-4", className)} {...props} />;
}

function Title({ className, ...props }: ComponentProps<"h2">) {
  return <h2 data-slot="data-table-title" className={cn("m-0 text-lg font-semibold text-[var(--ink)]", className)} {...props} />;
}

function Actions({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="data-table-actions" className={cn("ml-auto flex min-w-0 max-w-full flex-wrap items-center gap-2", className)} {...props} />;
}

function SelectionCheckbox({
  indeterminate,
  className,
  ...props
}: ComponentProps<typeof Checkbox.Root>) {
  return (
    <Checkbox.Root
      indeterminate={indeterminate}
      className={(state) => cn(
        "group/selection max-[767px]:size-11 max-[767px]:border-transparent max-[767px]:bg-transparent max-[767px]:shadow-none max-[767px]:data-[checked]:border-transparent max-[767px]:data-[checked]:bg-transparent max-[767px]:data-[indeterminate]:border-transparent max-[767px]:data-[indeterminate]:bg-transparent",
        typeof className === "function" ? className(state) : className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none inline-flex items-center justify-center max-[767px]:size-4 max-[767px]:rounded-[4px] max-[767px]:border max-[767px]:border-[var(--line-control)] max-[767px]:bg-[var(--surface)] max-[767px]:shadow-[var(--shadow-xs)] max-[767px]:group-data-[checked]/selection:border-[var(--brand-fill)] max-[767px]:group-data-[checked]/selection:bg-[var(--brand-fill)] max-[767px]:group-data-[indeterminate]/selection:border-[var(--brand-fill)] max-[767px]:group-data-[indeterminate]/selection:bg-[var(--brand-fill)]"
      >
        <Checkbox.Indicator>
          {indeterminate ? <Minus size={12} strokeWidth={2.5} aria-hidden="true" /> : undefined}
        </Checkbox.Indicator>
      </span>
    </Checkbox.Root>
  );
}

function SelectAllRows() {
  const table = useInstance();
  const eligibleRows = table.getRowModel().flatRows.filter((row) => row.getCanSelect());
  const selectedCount = eligibleRows.filter((row) => row.getIsSelected()).length;
  return (
    <SelectionCheckbox
      aria-label="Select all rows"
      checked={eligibleRows.length > 0 && selectedCount === eligibleRows.length}
      indeterminate={selectedCount > 0 && selectedCount < eligibleRows.length}
      disabled={eligibleRows.length === 0}
      onCheckedChange={(checked) => table.toggleAllRowsSelected(checked)}
    />
  );
}

function createSelectionColumn<TData extends RowData>({
  getLabel,
}: { getLabel: (row: TData) => string }): DataTableColumnDef<TData> {
  return {
    id: "select",
    header: () => <SelectAllRows />,
    meta: { label: "Select", headerClassName: "w-11 text-center max-[767px]:p-0", className: "w-11 text-center max-[767px]:p-0" },
    cell: ({ row }) => (
      <SelectionCheckbox
        aria-label={getLabel(row.original)}
        checked={row.getIsSelected()}
        disabled={!row.getCanSelect()}
        onCheckedChange={(checked, details) => {
          // Base UI exposes the original click so TanStack can preserve Shift ranges.
          row.getToggleSelectedHandler()({ target: { checked }, nativeEvent: details.event });
        }}
      />
    ),
  };
}

export type DataTableSelectionBarProps<TData extends RowData> = Omit<ComponentProps<"div">, "children"> & {
  disabled?: boolean;
  children: (selection: { selectedRows: TData[]; clearSelection: () => void }) => ReactNode;
};

function SelectionBar<TData extends RowData>({
  children,
  disabled = false,
  className,
  ...props
}: DataTableSelectionBarProps<TData>) {
  const table = useInstance<TData>();
  // Materialized rows exclude stale IDs, while preserving selection during a save.
  const selectedRows = table.getSelectedRowModel().flatRows.map((row) => row.original);
  const clearSelection = () => table.resetRowSelection(true);
  if (!selectedRows.length) return null;
  return (
    <div
      data-slot="data-table-selection-bar"
      role="region"
      aria-label="Selected rows"
      className={cn("flex flex-wrap items-center gap-3 border-b border-[var(--line)] bg-[var(--surface-sunken)] px-4 py-3", className)}
      {...props}
    >
      <span className="text-sm font-medium text-[var(--ink)]" role="status" aria-live="polite" aria-atomic="true">
        {selectedRows.length} selected
      </span>
      <BaseButton type="button" className="button button-ghost button-sm" disabled={disabled} onClick={clearSelection}>
        Clear selection
      </BaseButton>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {children({ selectedRows, clearSelection })}
      </div>
    </div>
  );
}

function CellNotice({
  label,
  children = <Info size={14} aria-hidden="true" />,
  className,
  ...props
}: ComponentProps<"button"> & { label: string }) {
  return (
    <Tooltip label={label} side="top">
      <button
        {...props}
        type="button"
        aria-label={label}
        data-slot="data-table-cell-notice"
        className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded-sm border-0 bg-transparent p-0 align-middle text-[var(--muted)] focus-visible:outline-none focus-visible:shadow-[var(--ring-brand)]", className)}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function Caption({ className, ...props }: ComponentProps<typeof TableCaption>) {
  return <TableCaption className={cn("sr-only", className)} {...props} />;
}

function Header({ children, ...props }: ComponentProps<typeof TableHeader>) {
  const table = useInstance();
  return (
    <TableHeader {...props}>
      {children === undefined ? table.getHeaderGroups().map((headerGroup) => (
        <TableRow key={headerGroup.id}>
          {headerGroup.headers.map((header) => (
            <TableHead
              key={header.id}
              scope="col"
              className={header.column.columnDef.meta?.headerClassName}
            >
              {header.isPlaceholder ? null : <table.FlexRender header={header} />}
            </TableHead>
          ))}
        </TableRow>
      )) : children}
    </TableHeader>
  );
}

export type DataTableBodyProps<TData extends RowData = RowData> = Omit<ComponentProps<typeof TableBody>, "children"> & {
  children?: ReactNode | ((row: Row<DataTableFeatures, TData>) => ReactNode);
  emptyMessage?: ReactNode;
  rowClassName?: string;
};

function Body<TData extends RowData = RowData>({
  children,
  emptyMessage = "No results.",
  rowClassName,
  ...props
}: DataTableBodyProps<TData>) {
  const table = useInstance<TData>();
  const rows = table.getRowModel().rows;
  return (
    <TableBody {...props}>
      {typeof children !== "function" && children !== undefined ? children : (
        rows.length ? rows.map((row) => {
          if (typeof children === "function") return children(row);
          return (
            <TableRow
              key={row.id}
              className={rowClassName}
              data-state={row.getIsSelected() ? "selected" : undefined}
            >
              {row.getAllCells().map((cell) => {
                const meta = cell.column.columnDef.meta;
                const content = <table.FlexRender cell={cell} />;
                return meta?.rowHeader ? (
                  <TableHead key={cell.id} scope="row" className={cn("text-sm font-normal whitespace-normal [overflow-wrap:anywhere] text-[var(--ink)]", meta.className)} data-label={meta.label}>
                    {content}
                  </TableHead>
                ) : (
                  <TableCell key={cell.id} className={meta?.className} data-label={meta?.label}>
                    {content}
                  </TableCell>
                );
              })}
            </TableRow>
          );
        }) : (
          <TableRow>
            <TableCell colSpan={Math.max(table.getAllLeafColumns().length, 1)} className="p-0 text-center text-[var(--muted)]">
              <div className="sticky left-0 flex min-h-20 w-[100cqw] max-w-full items-center justify-center px-4 py-6">
                {emptyMessage}
              </div>
            </TableCell>
          </TableRow>
        )
      )}
    </TableBody>
  );
}

export const DataTable = {
  Root,
  Frame,
  Toolbar,
  Title,
  Actions,
  SelectionBar,
  SelectionCheckbox,
  createSelectionColumn,
  Table,
  Caption,
  Header,
  Body,
  Footer: TableFooter,
  Row: TableRow,
  Head: TableHead,
  Cell: TableCell,
  CellNotice,
  useInstance,
};
