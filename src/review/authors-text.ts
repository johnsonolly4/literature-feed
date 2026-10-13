// Authors as a short line for tables and lists: the first few names, then "et al.". Pure. (First and last author would be a better
// display; it is in the backlog.)

/** The first `n` names joined by commas, with "et al." after them when there are more; "" for none. */
export function authorsShort(authors: readonly string[], n = 3): string {
  const names = authors.map((a) => a.trim()).filter((a) => a !== "");
  if (names.length === 0) return "";
  return names.length > n ? `${names.slice(0, n).join(", ")} et al.` : names.join(", ");
}

/** The same for a line already joined with semicolons ("Veldmar KR; Orrinson PT; Halvorn CJ; et al."). */
export function authorsLineShort(line: string, n = 3): string {
  const all = line.split(";").map((a) => a.trim()).filter((a) => a !== "");
  const etAl = all.length > 0 && all[all.length - 1] === "et al.";
  const names = etAl ? all.slice(0, -1) : all;
  const short = authorsShort(names, n);
  return etAl && names.length <= n && short !== "" ? `${short} et al.` : short;
}
