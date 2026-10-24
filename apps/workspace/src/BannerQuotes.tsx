import { useRef, useState, type FormEvent, type RefObject } from "react";
import { ChevronDown, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useWorkspace } from "@moc/client";
import {
  BANNER_QUOTE_AUTHOR_MAX_LENGTH, BANNER_QUOTE_MAX_LENGTH,
  currentBannerQuote, type BannerQuote, type WorkspaceAction,
} from "@moc/shared";
import { Badge, Button, CellCombobox, DataTable, EditableTextCell, Field, Modal, type DataTableColumnDef } from "@moc/ui";
import { ConfirmDialog } from "./components/UiDialogs";

type QuoteRow = {
  quote: BannerQuote;
  busyKey: string;
  save: (quote: BannerQuote, field: "text" | "author", value: string) => Promise<void>;
};

const columns: DataTableColumnDef<QuoteRow>[] = [
  DataTable.createSelectionColumn<QuoteRow>({ getLabel: ({ quote }) => `Select quote by ${quote.author}` }),
  {
    id: "quote", header: "Quote",
    meta: { rowHeader: true, label: "Quote", className: "p-0 whitespace-normal font-normal" },
    cell: ({ row }) => {
      const { quote, busyKey, save } = row.original;
      return <EditableTextCell label={`Quote by ${quote.author}`} value={quote.text} maxLength={BANNER_QUOTE_MAX_LENGTH}
        readOnly={Boolean(busyKey) && busyKey !== `${quote.id}-text`}
        validate={(value) => value.trim() ? undefined : "Enter a quote."}
        onSave={(value) => save(quote, "text", value)} />;
    },
  },
  {
    id: "author", header: "Attribution",
    meta: { label: "Attribution", headerClassName: "w-[30%]", className: "p-0 whitespace-normal" },
    cell: ({ row }) => {
      const { quote, busyKey, save } = row.original;
      return <EditableTextCell label={`Attribution for ${quote.text}`} value={quote.author} maxLength={BANNER_QUOTE_AUTHOR_MAX_LENGTH}
        readOnly={Boolean(busyKey) && busyKey !== `${quote.id}-author`}
        validate={(value) => value.trim() ? undefined : "Enter an attribution."}
        onSave={(value) => save(quote, "author", value)} />;
    },
  },
];

function DeleteQuotes({ count, busy, onDelete, fallbackFocus }: {
  count: number; busy: boolean; onDelete: () => Promise<void>; fallbackFocus: RefObject<HTMLButtonElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return <>
    <Button ref={triggerRef} type="button" size="sm" variant="danger" disabled={busy || count > 100} onClick={() => setOpen(true)}>
      <Trash2 size={14} aria-hidden="true" /> Delete quotes
    </Button>
    {count > 100 && <span className="text-xs text-[var(--muted)]">Select up to 100 quotes at a time.</span>}
    <ConfirmDialog open={open} onClose={() => setOpen(false)} title="Delete quotes?"
      description={`Delete ${count} selected ${count === 1 ? "quote" : "quotes"} from the library? Today's banner stays the same unless you change it above.`}
      confirmLabel="Delete quotes" onConfirm={onDelete}
      finalFocus={() => triggerRef.current?.isConnected ? triggerRef.current : fallbackFocus.current} />
  </>;
}

export default function BannerQuotes() {
  const { state, user, act } = useWorkspace();
  const [newQuote, setNewQuote] = useState<{ text: string; author: string } | null>(null);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const inFlight = useRef(false);
  const newButtonRef = useRef<HTMLButtonElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const settings = state.bannerQuotes;
  const quotes = settings?.quotes ?? [];
  const today = currentBannerQuote(settings);
  const currentLibraryQuote = quotes.find((quote) =>
    quote.id === today?.id && quote.text === today.text && quote.author === today.author,
  );
  const busy = Boolean(busyKey);

  async function mutate(action: WorkspaceAction, key: string) {
    if (inFlight.current) throw new Error("Wait for the current change to finish.");
    inFlight.current = true;
    setBusyKey(key);
    try { await act(action); }
    finally { inFlight.current = false; setBusyKey(""); }
  }

  async function updateToday(action: WorkspaceAction) {
    setError("");
    try { await mutate(action, "today"); }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : "Today's quote could not be changed.");
      throw cause;
    }
  }

  async function createQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newQuote || inFlight.current) return;
    setFormError("");
    try {
      await mutate({ type: "save-banner-quote", quote: newQuote }, "create");
      setNewQuote(null);
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : "The quote could not be created."); }
  }

  if (!user?.approved || !user.isLeader || user.department !== "cell-0") return null;

  const rows: QuoteRow[] = quotes.map((quote) => ({
    quote, busyKey,
    save: (item, field, value) => mutate({ type: "save-banner-quote", quote: { ...item, [field]: value } }, `${item.id}-${field}`),
  }));

  return <section id="banner-quotes" className="flex min-w-0 flex-col gap-5" aria-labelledby="banner-quotes-heading">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="banner-quotes-heading" className="m-0 text-lg font-semibold">Banner quotes</h2>
      <Button ref={newButtonRef} variant="primary" disabled={busy} onClick={() => { setFormError(""); setNewQuote({ text: "", author: "" }); }}>
        <Plus size={16} aria-hidden="true" /> New quote
      </Button>
    </header>
    <section className="flex min-w-0 flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] p-5" aria-labelledby="today-quote-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="today-quote-heading" className="m-0 text-sm font-semibold">Today’s quote</h3>
          <Badge>{settings?.daily?.override ? "Override" : "Daily pick"}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-[var(--radius-md)] border border-[var(--line)] text-sm">
            <CellCombobox label="today’s quote" value={currentLibraryQuote ? [currentLibraryQuote.id] : []}
              options={quotes.map((quote) => ({ value: quote.id, label: quote.text }))} disabled={busy || !quotes.length}
              displayValue={<span className="flex items-center gap-2">Change quote <ChevronDown size={14} aria-hidden="true" /></span>}
              onValueChange={async ([quoteId]) => { if (quoteId) await updateToday({ type: "set-banner-quote-today", quoteId }); }} />
          </div>
          {settings?.daily?.override && <Button disabled={busy} onClick={() => void updateToday({ type: "reset-banner-quote-today" }).catch(() => {})}>
            <RotateCcw size={14} aria-hidden="true" /> Restore daily pick
          </Button>}
        </div>
      </div>
      {today ? <figure className="m-0 min-w-0" aria-live="polite">
        <blockquote className="m-0 text-lg leading-7 italic [overflow-wrap:anywhere]">“{today.text}”</blockquote>
        <figcaption className="mt-2 text-sm text-[var(--muted)]">— {today.author}</figcaption>
      </figure> : <p className="m-0 text-sm text-[var(--muted)]">Add a quote to display a banner on the Overview page.</p>}
      <p className="m-0 text-xs leading-5 text-[var(--muted)]">One random quote is shared with everyone each day. The day changes at midnight, Johannesburg time. Overrides last for today.</p>
      {error && <p role="alert" className="m-0 text-sm text-[var(--danger-text)]">{error}</p>}
    </section>
    <DataTable.Root columns={columns} data={rows} getRowId={({ quote }) => quote.id} enableRowSelection={!busy}>
      <DataTable.SelectionBar<QuoteRow> disabled={busy}>
        {({ selectedRows, clearSelection }) => <DeleteQuotes count={selectedRows.length} busy={busy} fallbackFocus={newButtonRef} onDelete={async () => {
          await mutate({ type: "delete-banner-quotes", quoteIds: selectedRows.map(({ quote }) => quote.id) }, "delete");
          clearSelection();
        }} />}
      </DataTable.SelectionBar>
      <DataTable.Table className="min-w-[560px]" aria-label="Banner quotes table">
        <DataTable.Caption>Banner quote library. Edit a cell to change its text or attribution.</DataTable.Caption>
        <DataTable.Header />
        <DataTable.Body emptyMessage="No quotes yet. Create a quote to start your library." />
      </DataTable.Table>
    </DataTable.Root>
    {quotes.length > 0 && <p className="m-0 text-xs leading-5 text-[var(--muted)]">Library edits apply to future daily picks. Change today’s quote above to update the current banner.</p>}
    <Modal open={newQuote !== null} title="New quote" initialFocus={textRef} finalFocus={newButtonRef}
      onClose={() => { if (!inFlight.current) setNewQuote(null); }}>
      {newQuote && <form className="flex flex-col gap-5" aria-busy={busy || undefined} onSubmit={(event) => void createQuote(event)}>
        <Field label="Quote"><textarea ref={textRef} className="input min-h-28 resize-y" aria-label="New quote text" required maxLength={BANNER_QUOTE_MAX_LENGTH} disabled={busy}
          value={newQuote.text} onChange={(event) => setNewQuote({ ...newQuote, text: event.target.value })} /></Field>
        <Field label="Attribution"><input className="input" aria-label="New quote attribution" required maxLength={BANNER_QUOTE_AUTHOR_MAX_LENGTH} disabled={busy}
          value={newQuote.author} onChange={(event) => setNewQuote({ ...newQuote, author: event.target.value })} /></Field>
        {formError && <p role="alert" className="m-0 text-sm text-[var(--danger-text)]">{formError}</p>}
        <footer className="flex flex-wrap justify-end gap-2">
          <Button type="button" disabled={busy} onClick={() => setNewQuote(null)}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? "Creating…" : "Create quote"}</Button>
        </footer>
      </form>}
    </Modal>
  </section>;
}
