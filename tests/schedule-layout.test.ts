import { expect, it } from "vitest";
import { layoutDeadlines } from "../apps/workspace/src/pages/schedule-layout";

it("keeps simultaneous and chained deadline overlaps in separate columns and lets later events use the full width", () => {
  const at = (time: string) => ({ dueAt: `2026-10-20T${time}:00` });
  const layout = layoutDeadlines([
    at("15:00"),
    at("13:30"),
    at("13:00"),
    at("13:15"),
    at("13:15"),
  ]);
  expect(
    layout.map(({ minute, column, columns }) => ({ minute, column, columns })),
  ).toEqual([
    { minute: 780, column: 0, columns: 3 },
    { minute: 795, column: 1, columns: 3 },
    { minute: 795, column: 2, columns: 3 },
    { minute: 810, column: 0, columns: 3 },
    { minute: 900, column: 0, columns: 1 },
  ]);
  for (const left of layout)
    for (const right of layout) {
      if (left !== right && Math.abs(left.minute - right.minute) < 30)
        expect(left.column).not.toBe(right.column);
    }
  expect(layoutDeadlines([])).toEqual([]);
});
