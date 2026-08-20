import { describe, expect, it } from "vitest";
import { isSafePathSegment } from "./paths.js";

describe("isSafePathSegment", () => {
  it("accepts ordinary ids and file names", () => {
    expect(isSafePathSegment("a1b2c3d4-uuid")).toBe(true);
    expect(isSafePathSegment("portrait-1.png")).toBe(true);
  });

  it("rejects traversal and separators, including URL-decoded forms actually seen in the wild", () => {
    // These are the exact decoded values Express hands a route handler after
    // a request like GET /media/x/assets/..%2f..%2f..%2fpackage.json —
    // this once let an authenticated user read arbitrary files on disk.
    expect(isSafePathSegment("..")).toBe(false);
    expect(isSafePathSegment(".")).toBe(false);
    expect(isSafePathSegment("../../../package.json")).toBe(false);
    expect(isSafePathSegment("..\\..\\.env")).toBe(false);
    expect(isSafePathSegment("nested/path.png")).toBe(false);
    expect(isSafePathSegment("")).toBe(false);
  });
});
