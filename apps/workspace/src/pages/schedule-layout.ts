// Deadlines occupy a half-hour slot in day/week views. Allocate columns per
// overlapping group, so chained overlaps and identical times cannot collide.
export function layoutDeadlines<T extends { dueAt: string }>(tasks: T[]) {
  const entries = tasks
    .map((task) => {
      const due = new Date(task.dueAt);
      return {
        task,
        minute: due.getHours() * 60 + due.getMinutes(),
        column: 0,
        columns: 1,
      };
    })
    .sort((a, b) => a.minute - b.minute);
  let group: typeof entries = [];
  let columnEnds: number[] = [];
  function finishGroup() {
    for (const entry of group) entry.columns = columnEnds.length;
    group = [];
    columnEnds = [];
  }
  for (const entry of entries) {
    if (columnEnds.length && entry.minute >= Math.max(...columnEnds))
      finishGroup();
    const freeColumn = columnEnds.findIndex((end) => end <= entry.minute);
    entry.column = freeColumn === -1 ? columnEnds.length : freeColumn;
    columnEnds[entry.column] = entry.minute + 30;
    group.push(entry);
  }
  finishGroup();
  return entries;
}
