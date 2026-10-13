import { describe, expect, it } from "vitest";
import { chipCounts, nextSort, normaliseView, rowsToCsv, viewRows, type TableModel } from "../src/ui/table-model";

interface R { name: string; n: number; tag: string }
const rows: R[] = [{ name: "Ada", n: 3, tag: "a" }, { name: "Bo, Jr", n: 1, tag: "b" }, { name: "Cy", n: 2, tag: "a" }];
const model: TableModel<R> = {
  columns: [
    { key: "name", label: "Name", sortable: true, compare: (a, b) => a.name.localeCompare(b.name), csv: (r) => r.name },
    { key: "n", label: "N", sortable: true, compare: (a, b) => a.n - b.n, csv: (r) => r.n },
  ],
  chips: [{ key: "all", label: "All", test: () => true }, { key: "a", label: "A", test: (r) => r.tag === "a" }],
  searchText: (r) => `${r.name} ${r.tag}`,
};
const view = { chip: "all", query: "", sort: { by: "n", desc: false } };

describe("table model", () => {
  it("sorts, reverses and filters by chip", () => {
    expect(viewRows(rows, model, view).map((r) => r.name)).toEqual(["Bo, Jr", "Cy", "Ada"]);
    expect(viewRows(rows, model, { ...view, sort: { by: "n", desc: true } }).map((r) => r.name)).toEqual(["Ada", "Cy", "Bo, Jr"]);
    expect(viewRows(rows, model, { ...view, chip: "a" }).map((r) => r.name)).toEqual(["Cy", "Ada"]);
  });

  it("searches every word, and chip counts follow the search", () => {
    expect(viewRows(rows, model, { ...view, query: "a ad" }).map((r) => r.name)).toEqual(["Ada"]);
    expect(chipCounts(rows, model, "cy").get("a")).toBe(1);
    expect(chipCounts(rows, model, "").get("all")).toBe(3);
  });

  it("flips the sort on the same column and starts ascending on a new one", () => {
    expect(nextSort({ by: "n", desc: false }, "n")).toEqual({ by: "n", desc: true });
    expect(nextSort({ by: "n", desc: true }, "name")).toEqual({ by: "name", desc: false });
  });

  it("writes CSV with quoting", () => {
    expect(rowsToCsv(rows.slice(0, 2), model.columns)).toBe('Name,N\nAda,3\n"Bo, Jr",1');
  });

  it("repairs a stored view", () => {
    const d = { chip: "all", query: "", sort: { by: "n", desc: true } };
    expect(normaliseView({ chip: "zzz", sort: { by: "nope" } }, model, d)).toEqual({ chip: "all", query: "", sort: { by: "n", desc: true } });
    expect(normaliseView(null, model, d)).toEqual(d);
    expect(normaliseView({ chip: "a", query: "x", sort: { by: "name", desc: true } }, model, d)).toEqual({ chip: "a", query: "x", sort: { by: "name", desc: true } });
  });
});
