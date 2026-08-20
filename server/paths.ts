import path from "node:path";

// A route param used to build a filesystem path (project id, asset file name)
// must be exactly one literal path segment. Anything else — "..", "/", an
// encoded "../" — resolves outside the directory it was meant to stay inside.
// Confirmed exploitable before this existed: /media/:id/assets/:file could
// read arbitrary files on disk, package.json included, by request.
export function isSafePathSegment(value: string): boolean {
  if (!value || value === "." || value === "..") return false;
  // Reject both separators explicitly rather than relying only on path.basename:
  // that check alone is platform-dependent (node:path's default is OS-native,
  // so a "\" traversal segment is only caught by basename() on Windows).
  if (value.includes("/") || value.includes("\\")) return false;
  return path.basename(value) === value;
}
