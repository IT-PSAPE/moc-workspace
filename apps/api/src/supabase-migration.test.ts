import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Supabase installation schema", () => {
  it("keeps the existing provider-neutral schema intact and adds private API-only permissions", async () => {
    const core = new URL("../migrations/", import.meta.url);
    const files = (await readdir(core)).filter((name) => name.endsWith(".sql")).sort();
    const expected = (await Promise.all(files.map((name) => readFile(new URL(name, core), "utf8")))).join("\n\n");
    const directory = new URL("../../../supabase/migrations/", import.meta.url);
    const baseline = await readFile(new URL((await readdir(directory)).find((name) => name.endsWith(".sql"))!, directory), "utf8");
    expect(baseline.startsWith(expected)).toBe(true);
    expect(baseline).toContain("ENABLE ROW LEVEL SECURITY");
    expect(baseline).not.toContain("CREATE POLICY"); // No browser Data API access.
  });
});
