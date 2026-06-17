// Path utilities - lexical path normalization (no filesystem access)
// Inspired by claw-code's is_within_workspace

import { sep, isAbsolute } from 'node:path';

/**
 * Lexically normalize a path (no symlink resolution).
 *
 * BUGFIXES:
 *   1. `..` at root previously popped an empty result, silently dropping
 *      the `..` — so `../foo` became `foo`, masking path-escape attempts.
 *      We now preserve leading `..` for relative paths (so callers can
 *      detect escape) and ignore `..` that would go above root for
 *      absolute paths.
 *   2. Use `isAbsolute()` from node:path instead of `startsWith('/')`
 *      so Windows drive paths (`C:\foo`) are recognized as absolute.
 */
export function lexicallyNormalize(p: string): string {
  if (!p) return '';

  // Detect Windows drive letter (e.g. C:\ or C:/)
  const driveMatch = p.match(/^([a-zA-Z]:)[\\/]/);
  const drivePrefix = driveMatch ? driveMatch[1] : '';

  const isAbs = isAbsolute(p) || !!driveMatch;
  const parts = p.split(/[\\/]/).filter(Boolean);
  const result: string[] = [];

  for (const part of parts) {
    if (part === '.') continue;
    // Skip the drive letter as a part (e.g. "C:")
    if (drivePrefix && part === drivePrefix) continue;
    if (part === '..') {
      if (result.length > 0) {
        // Pop the last segment if there is one.
        result.pop();
      } else if (!isAbs) {
        // Relative path with `..` that would go above the start —
        // PRESERVE it so callers can detect escape attempts. The
        // previous code silently dropped this, turning `../foo` into
        // `foo` and masking path-traversal.
        result.push('..');
      }
      // For absolute paths, `..` at root is a no-op (can't go above root).
      continue;
    }
    result.push(part);
  }

  const normalized = result.join(sep);
  if (drivePrefix) {
    return drivePrefix + sep + normalized;
  }
  return isAbs ? sep + normalized : normalized;
}

/**
 * Check whether `path` is inside `workspaceRoot`.
 *
 * BUGFIX: Use `isAbsolute()` from node:path instead of `startsWith('/')`
 * so Windows drive paths (`C:\foo`) are recognized as absolute. The
 * previous code treated `C:\foo` as relative, then joined it with the
 * workspace root (e.g. `/workspace/C:\foo`), producing a nonsensical
 * path that always failed the within-workspace check.
 */
export function isWithinWorkspace(path: string, workspaceRoot: string): boolean {
  const combined = isAbsolute(path) || /^[a-zA-Z]:[\\/]/.test(path)
    ? path
    : `${workspaceRoot}/${path}`;
  const normalized = lexicallyNormalize(combined);
  const root = lexicallyNormalize(workspaceRoot);
  const rootWithSep = root.endsWith(sep) ? root : root + sep;

  return normalized === root || normalized.startsWith(rootWithSep);
}
