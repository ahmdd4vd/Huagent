// ✦ Snapshot + Rollback — File Safety ✦
// Inspired by Aider's git-auto-commit pattern
// Innovation: SHA256-based snapshot in memory (no git overhead)

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';

export interface FileSnapshot {
  path: string;
  hash: string;
  content: string;
  existed: boolean;
  timestamp: number;
}

export class SnapshotManager {
  private snapshots = new Map<string, FileSnapshot>();
  private maxSnapshots = 50;

  /**
   * Take a snapshot of a file (or mark as new if doesn't exist).
   */
  snapshot(path: string): FileSnapshot {
    const absPath = path;
    let content = '';
    let existed = false;

    try {
      content = readFileSync(absPath, 'utf8');
      existed = true;
    } catch {
      // File doesn't exist — new file
    }

    const snap: FileSnapshot = {
      path: absPath,
      hash: createHash('sha256').update(content).digest('hex'),
      content,
      existed,
      timestamp: Date.now(),
    };

    this.snapshots.set(path, snap);

    // LRU bound
    if (this.snapshots.size > this.maxSnapshots) {
      const firstKey = this.snapshots.keys().next().value;
      if (firstKey) this.snapshots.delete(firstKey);
    }

    return snap;
  }

  /**
   * Take snapshots of multiple files atomically.
   */
  snapshotAll(paths: string[]): FileSnapshot[] {
    return paths.map((p) => this.snapshot(p));
  }

  /**
   * Roll back a file to its snapshot.
   * Returns true if rolled back, false if no snapshot or unchanged.
   */
  rollback(path: string): boolean {
    const snap = this.snapshots.get(path);
    if (!snap) return false;

    try {
      if (snap.existed) {
        writeFileSync(path, snap.content);
      } else {
        // Original didn't exist — delete if we created it
        try {
          unlinkSync(path);
        } catch {}
      }
      return true;
    } catch (err: any) {
      console.error(`Rollback failed for ${path}: ${err.message}`);
      return false;
    }
  }

  /**
   * Roll back all snapshots.
   */
  rollbackAll(): { path: string; success: boolean }[] {
    const results: { path: string; success: boolean }[] = [];
    for (const [path] of this.snapshots) {
      results.push({ path, success: this.rollback(path) });
    }
    return results;
  }

  /**
   * Verify a file matches its snapshot.
   */
  verify(path: string): boolean {
    const snap = this.snapshots.get(path);
    if (!snap) return false;

    if (!snap.existed) {
      // Should not exist
      return !existsSync(path);
    }

    try {
      const current = readFileSync(path, 'utf8');
      const currentHash = createHash('sha256').update(current).digest('hex');
      return currentHash === snap.hash;
    } catch {
      return false;
    }
  }

  /**
   * Clear snapshots (call after successful operation).
   */
  clear(): void {
    this.snapshots.clear();
  }

  /**
   * Clear snapshots for specific paths.
   */
  clearPaths(paths: string[]): void {
    for (const p of paths) this.snapshots.delete(p);
  }

  /**
   * Get current snapshot for a path.
   */
  get(path: string): FileSnapshot | undefined {
    return this.snapshots.get(path);
  }

  /**
   * Diff between snapshot and current file.
   */
  diff(path: string): { added: number; removed: number; changed: number } {
    const snap = this.snapshots.get(path);
    if (!snap) return { added: 0, removed: 0, changed: 0 };

    let current = '';
    try {
      current = readFileSync(path, 'utf8');
    } catch {
      return snap.existed
        ? { added: 0, removed: snap.content.split('\n').length, changed: 0 }
        : { added: 0, removed: 0, changed: 0 };
    }

    const oldLines = snap.content.split('\n');
    const newLines = current.split('\n');
    const oldSet = new Set(oldLines);
    const newSet = new Set(newLines);

    let added = 0;
    let removed = 0;
    for (const line of newLines) {
      if (!oldSet.has(line)) added++;
    }
    for (const line of oldLines) {
      if (!newSet.has(line)) removed++;
    }

    return { added, removed, changed: added + removed };
  }
}
