import { describe, expect, it } from "vitest";
import { latestScanDay, scanDue, syncDue } from "../src/schedule";

// 2026-10-12 is a Monday.
const MONDAY = 1;

describe("latestScanDay", () => {
  it("is today when today is the scan day, and otherwise the last one before it", () => {
    expect(latestScanDay("2026-10-12", MONDAY)).toBe("2026-10-12");
    expect(latestScanDay("2026-10-13", MONDAY)).toBe("2026-10-12");
    expect(latestScanDay("2026-10-18", MONDAY)).toBe("2026-10-12"); // Sunday
    expect(latestScanDay("2026-10-19", MONDAY)).toBe("2026-10-19");
  });

  it("works for every scan day, Sunday to Saturday", () => {
    // Wednesday 2026-10-14
    const expected = ["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-08", "2026-10-09", "2026-10-10"];
    expected.forEach((day, scanDay) => expect(latestScanDay("2026-10-14", scanDay), `scan day ${scanDay}`).toBe(day));
  });

  it("crosses month and year ends", () => {
    expect(latestScanDay("2026-01-01", MONDAY)).toBe("2025-12-29");
    expect(latestScanDay("2026-03-01", 5)).toBe("2026-02-27");
    expect(latestScanDay("2024-03-01", 4)).toBe("2024-02-29");
  });
});

describe("scanDue", () => {
  it("is due when there has never been a scan", () => {
    expect(scanDue("", "2026-10-14", MONDAY)).toBe(true);
  });

  it("is not due again in the same week after a scan on or after the scan day", () => {
    expect(scanDue("2026-10-12", "2026-10-12", MONDAY)).toBe(false); // scanned today, the scan day
    expect(scanDue("2026-10-12", "2026-10-18", MONDAY)).toBe(false); // the rest of the week
    expect(scanDue("2026-10-14", "2026-10-18", MONDAY)).toBe(false); // a scan by hand on Wednesday counts for the week
  });

  it("is due once the next scan day comes", () => {
    expect(scanDue("2026-10-12", "2026-10-19", MONDAY)).toBe(true);
    expect(scanDue("2026-10-14", "2026-10-19", MONDAY)).toBe(true);
  });

  it("is due when the last scan was before this week's scan day, also when Obsidian was closed for weeks", () => {
    expect(scanDue("2026-10-09", "2026-10-12", MONDAY)).toBe(true); // the Friday before
    expect(scanDue("2026-10-11", "2026-10-13", MONDAY)).toBe(true); // Sunday, then Tuesday
    expect(scanDue("2026-09-01", "2026-10-14", MONDAY)).toBe(true);
  });

  it("follows the chosen weekday", () => {
    expect(scanDue("2026-10-12", "2026-10-14", 3)).toBe(true); // Wednesday scan day, last scan Monday
    expect(scanDue("2026-10-14", "2026-10-15", 3)).toBe(false);
    expect(scanDue("2026-10-14", "2026-10-21", 3)).toBe(true);
  });
});

describe("syncDue", () => {
  it("is due when it has not run today", () => {
    expect(syncDue("", "2026-10-14")).toBe(true);
    expect(syncDue("2026-10-13", "2026-10-14")).toBe(true);
    expect(syncDue("2026-10-14", "2026-10-14")).toBe(false);
  });
});
