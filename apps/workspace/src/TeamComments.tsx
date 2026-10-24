import { useState } from "react";
import { LockKeyhole, MessageSquare, Send } from "lucide-react";
import { Button } from "@moc/ui";
import { useWorkspace } from "@moc/client";
import type { Task } from "@moc/shared";
import "./task-details.css";

export default function TeamComments({
  notes,
  target,
  audience,
  hidden = false,
  readOnly = false,
}: {
  notes: Task["privateNotes"];
  target: { kind: "task" | "request"; id: string };
  audience: string;
  hidden?: boolean;
  readOnly?: boolean;
}) {
  const { act } = useWorkspace();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  async function submitComment(event: React.FormEvent) {
    event.preventDefault();
    if (readOnly || !comment.trim() || busy) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await act(
        target.kind === "task"
          ? { type: "add-note", taskId: target.id, text: comment.trim() }
          : {
              type: "add-request-note",
              requestId: target.id,
              text: comment.trim(),
            },
      );
      setComment("");
      setSaved(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Your comment could not be posted. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="task-details-section task-comments"
      aria-label="Team comments"
      hidden={hidden}
    >
      <div className="task-details-section-heading">
        <h3>
          <MessageSquare size={15} />
          Comments <span>{notes.length}</span>
        </h3>
        <LockKeyhole size={14} aria-hidden="true" />
      </div>
      <p className="task-comments-hint">{audience}</p>
      {notes.length ? (
        <ol className="task-comment-list">
          {notes.map((note) => (
            <li key={note.id}>
              <div className="task-comment-avatar" aria-hidden="true">
                {note.author
                  .split(" ")
                  .map((part) => part[0])
                  .slice(0, 2)
                  .join("")}
              </div>
              <div>
                <div className="task-comment-byline">
                  <strong>{note.author}</strong>
                  <time dateTime={note.createdAt}>
                    {new Intl.DateTimeFormat("en-ZA", {
                      dateStyle: "medium",
                      timeZone: "Africa/Johannesburg",
                      timeStyle: "short",
                    }).format(new Date(note.createdAt))}
                  </time>
                </div>
                <p>{note.text}</p>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="task-comments-empty">
          {readOnly ? "No comments yet." : "No comments yet. Share an update or ask a question."}
        </p>
      )}
      {!readOnly && <form onSubmit={submitComment} className="task-comment-form">
        <label htmlFor={`comment-${target.id}`}>Add a comment</label>
        <textarea
          id={`comment-${target.id}`}
          rows={3}
          placeholder="Share an update with your team…"
          value={comment}
          disabled={busy}
          onChange={(event) => {
            setComment(event.target.value);
            setSaved(false);
          }}
        />
        <div>
          <span role="status">
            {saved ? "Comment posted" : "Visible to your team only"}
          </span>
          <Button
            variant="primary"
            type="submit"
            disabled={busy || !comment.trim()}
          >
            <Send size={14} />
            {busy ? "Posting…" : "Post comment"}
          </Button>
        </div>
        {error && (
          <p className="workflow-alert" role="alert">
            {error}
          </p>
        )}
      </form>}
    </section>
  );
}
