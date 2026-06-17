/**
 * Auto-Ingest Service — Watch files and automatically create/update wiki pages.
 *
 * Features:
 * - File watching with chokidar
 * - Automatic entity/concept extraction
 * - Smart page creation (entity, concept, structure pages)
 * - Debouncing to avoid spam
 * - Configurable watch patterns
 */

import * as chokidar from 'chokidar';
import { resolve, isAbsolute, join, basename } from 'node:path';
import { ContentAnalyzer, type AnalyzedContent, type Entity, type Concept } from './content-analyzer.js';
import type { WikiStore } from '../graph/wiki-store.js';
import type { PageType, ConfidenceLevel } from '../types/index.js';

export interface AutoIngestOptions {
  /** File patterns to watch (default: ['**\/*.ts', '**\/*.tsx', '**\/*.js', '**\/*.jsx']) */
  watchPatterns?: string[];
  /** File patterns to ignore (default: ['node_modules/**', 'dist/**', 'build/**']) */
  ignorePatterns?: string[];
  /** Debounce time in ms (default: 1000) */
  debounceMs?: number;
  /** Auto-create pages for entities (default: true) */
  autoCreateEntities?: boolean;
  /** Auto-create pages for concepts (default: true) */
  autoCreateConcepts?: boolean;
  /** Auto-create structure pages (default: true) */
  autoCreateStructure?: boolean;
  /** Callback when file is ingested */
  onIngest?: (path: string, analyzed: AnalyzedContent) => void;
  /** Callback when page is created */
  onPageCreated?: (pageId: string, pageType: PageType) => void;
  /** Callback when page is updated */
  onPageUpdated?: (pageId: string, pageType: PageType) => void;
}

export interface IngestStats {
  filesWatched: number;
  filesIngested: number;
  pagesCreated: number;
  pagesUpdated: number;
  errors: number;
}

/**
 * Compile a list of glob ignore patterns into a single matcher function.
 *
 * Chokidar v5 passes the full absolute path to `ignored`. Its built-in glob
 * handling is anchored at the start of the path, so a pattern like
 * "double-star-slash-*.test.ts" does NOT match "/tmp/foo/test.test.ts"
 * because the leading "double-star-slash" expects at least one path segment
 * before the "*.test.ts" suffix. To make the patterns work as users
 * intuitively expect (regardless of whether they wrote "*.test.ts" or
 * "double-star-slash-*.test.ts"), we test each pattern against three
 * representations of the path:
 *
 *   1. The full absolute path.
 *   2. The basename of the path.
 *   3. The path relative to the watch root.
 *
 * If any representation matches any pattern, the file is ignored.
 *
 * The glob-to-regex conversion handles the patterns huagent actually uses:
 *   - "double-star-slash-*.ext"  → any file with the given extension
 *   - "dir-slash-double-star"    → the directory itself and everything inside
 *   - "*.ext"                    → any file with the given extension (no
 *                                  path separators)
 *   - "name"                     → literal substring match (used for `dist`,
 *                                  `build`, etc.)
 *
 * This is "good enough" — chokidar v5 dropped picomatch as a dep so we can't
 * rely on a fully spec-compliant glob engine.
 *
 * Implementation note: we walk the pattern char-by-char and emit regex
 * tokens into a buffer. This avoids the multi-step replace-corrupts-earlier-
 * replacements bug you get when you try to do this with chained string
 * replacements — e.g. when an intermediate result like "?:DOTSTAR SLASH
 * CLOSE-PAREN QUESTION SINGLE_STAR DOT ts" is fed back through the
 * single-star-to-NOTSLASH-STAR step, the star inside the optional group
 * also gets rewritten, producing a broken regex.
 */
function globToRegex(pattern: string): RegExp {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    const next = pattern[i + 1];

    if (ch === '*' && next === '*') {
      // Globstar. Skip the optional trailing slash.
      i++; // consume second `*`
      if (pattern[i + 1] === '/') i++; // consume trailing `/`
      out += '.*';
      continue;
    }
    if (ch === '*') {
      out += '[^/\\\\]*';
      continue;
    }
    if (ch === '?') {
      out += '[^/\\\\]';
      continue;
    }
    if ('.+^${}()|[]\\'.includes(ch)) {
      out += '\\' + ch;
      continue;
    }
    out += ch;
  }
  return new RegExp('^' + out + '$', 'i');
}

function compileIgnoreMatcher(
  patterns: string[],
  watchRoot: string,
): (path: string) => boolean {
  const matchers = patterns.map((p) => {
    const re = globToRegex(p);
    const stripped = p.replace(/\*\*/g, '').replace(/\*/g, '');
    return (s: string): boolean => {
      if (re.test(s)) return true;
      // Fallback: substring on stripped pattern (catches `node_modules/**`
      // matching `/foo/node_modules/bar` because the stripped form is
      // `node_modules/` which appears in the path).
      if (stripped.length > 0 && s.includes(stripped)) return true;
      return false;
    };
  });

  return (testPath: string): boolean => {
    if (!testPath) return false;
    const base = basename(testPath);
    let rel = testPath;
    if (testPath.startsWith(watchRoot)) {
      rel = testPath.slice(watchRoot.length).replace(/^[/\\]+/, '');
    }
    for (const m of matchers) {
      if (m(testPath) || m(base) || (rel && m(rel))) return true;
    }
    return false;
  };
}

export class AutoIngest {
  private analyzer: ContentAnalyzer;
  private watcher: chokidar.FSWatcher | null = null;
  private options: Required<AutoIngestOptions>;
  /** The absolute root path the watcher was started on. Used to relativise event paths. */
  private watchRoot: string = '';
  /** Resolves when chokidar's 'ready' event has fired (or 2s safety timeout). */
  private readyPromise: Promise<void> = Promise.resolve();
  /** Safety-net timer that resolves readyPromise after 2s even if 'ready' never fires. Cleared in stop(). */
  private safetyTimer: NodeJS.Timeout | null = null;
  private stats: IngestStats = {
    filesWatched: 0,
    filesIngested: 0,
    pagesCreated: 0,
    pagesUpdated: 0,
    errors: 0,
  };
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private processedFiles = new Set<string>();

  constructor(
    private store: WikiStore,
    options: AutoIngestOptions = {}
  ) {
    this.analyzer = new ContentAnalyzer();
    this.options = {
      watchPatterns: options.watchPatterns ?? ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
      ignorePatterns: options.ignorePatterns ?? ['node_modules/**', 'dist/**', 'build/**', '.git/**'],
      debounceMs: options.debounceMs ?? 1000,
      autoCreateEntities: options.autoCreateEntities ?? true,
      autoCreateConcepts: options.autoCreateConcepts ?? true,
      autoCreateStructure: options.autoCreateStructure ?? true,
      onIngest: options.onIngest ?? (() => {}),
      onPageCreated: options.onPageCreated ?? (() => {}),
      onPageUpdated: options.onPageUpdated ?? (() => {}),
    };
  }

  /**
   * Start watching files.
   *
   * Returns a Promise that resolves once chokidar has finished its initial
   * scan and is ready to detect file changes. Callers that immediately write
   * files after `start()` should `await` this Promise to avoid a race where
   * the write happens before the watcher's `fs.watch` listener is attached.
   */
  start(watchPath?: string): Promise<void> {
    if (this.watcher) {
      console.warn('[AutoIngest] Already watching');
      return Promise.resolve();
    }

    const pathToWatch = watchPath ? resolve(watchPath) : process.cwd();
    this.watchRoot = pathToWatch;
    console.log(`[AutoIngest] Starting file watcher on ${pathToWatch}`);

    // Compile ignore patterns into a matcher that handles absolute paths.
    // Chokidar v5's string/array ignored doesn't always match absolute paths
    // the way users expect, so we wrap it in a function.
    const ignoreMatcher = compileIgnoreMatcher(this.options.ignorePatterns, pathToWatch);

    // Build a watch filter that combines the ignore matcher with the
    // watchPatterns (which specify which file extensions to ingest).
    // We watch the directory itself (chokidar v5 dropped glob-pattern
    // support, so passing globs silently fails to emit events) and filter
    // events down to the file types we care about.
    const watchExtRegex = this.buildWatchExtensionRegex();

    const watchFilter = (testPath: string): boolean => {
      if (!testPath) return false;
      // Always allow directories (chokidar passes them to `ignored` too).
      // We can't tell directories from files here without `stats`, so we
      // let chokidar's own.isDirectory check handle that — only apply our
      // file-extension filter when the path looks like a file.
      if (ignoreMatcher(testPath)) return true;
      // If watchPatterns is restrictive (e.g. only `*.ts`), filter out
      // files that don't match. We do this by checking the basename
      // against the extension regex.
      if (watchExtRegex && testPath.includes('.')) {
        return !watchExtRegex.test(testPath);
      }
      return false;
    };

    this.watcher = chokidar.watch(pathToWatch, {
      ignored: watchFilter,
      persistent: true,
      ignoreInitial: true,
      // Keep the awaitWriteFinish threshold low so tests don't have to wait
      // 500ms+ for a file to be considered "stable". 50ms is enough to coalesce
      // rapid fsync bursts while still being responsive.
      awaitWriteFinish: {
        stabilityThreshold: 50,
        pollInterval: 20,
      },
    });

    // Resolve the ready promise on the 'ready' event. We also resolve on
    // 'error' to avoid hanging tests if chokidar fails to initialize.
    this.readyPromise = new Promise<void>((resolve) => {
      let resolved = false;
      const finish = () => {
        if (resolved) return;
        resolved = true;
        // CRITICAL: clear the safety-net timer so it doesn't keep the
        // event loop alive (and don't leave a dangling reference that
        // prevents clean shutdown on `stop()`).
        if (safetyTimer) clearTimeout(safetyTimer);
        resolve();
      };
      const onReady = () => {
        console.log('[AutoIngest] Watcher ready');
        finish();
      };
      this.watcher!.once('ready', onReady);
      this.watcher!.once('error', finish);
      // Safety net: if 'ready' never fires (e.g. on some networked
      // filesystems), resolve after 2 seconds so callers don't hang.
      const safetyTimer: NodeJS.Timeout = setTimeout(finish, 2000);
      this.safetyTimer = safetyTimer;
    });

    this.watcher
      .on('add', (path) => this.handleFileChange(path, 'add'))
      .on('change', (path) => this.handleFileChange(path, 'change'))
      .on('unlink', (path) => this.handleFileDelete(path))
      .on('error', (error) => {
        console.error('[AutoIngest] Watcher error:', error);
        this.stats.errors++;
      });

    return this.readyPromise;
  }

  /**
   * Build a regex that matches file extensions explicitly listed in
   * `watchPatterns`. Returns null if watchPatterns is "star-star-slash-star"
   * (i.e. match everything).
   */
  private buildWatchExtensionRegex(): RegExp | null {
    // Extract file extensions from patterns like `**/*.ts` or `*.tsx`.
    const exts: string[] = [];
    for (const p of this.options.watchPatterns) {
      const m = p.match(/\*\.([a-zA-Z0-9]+)$/);
      if (m) exts.push(m[1]);
    }
    if (exts.length === 0) return null;
    return new RegExp('\\.(' + exts.map(e => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')$', 'i');
  }

  /**
   * Stop watching files.
   */
  async stop(): Promise<void> {
    if (this.watcher) {
      console.log('[AutoIngest] Stopping file watcher');
      await this.watcher.close();
      this.watcher = null;
    }

    // Clear the safety-net timer so it doesn't keep the event loop alive
    // after stop() is called.
    if (this.safetyTimer) {
      clearTimeout(this.safetyTimer);
      this.safetyTimer = null;
    }

    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  /**
   * Normalize an event path to an absolute path.
   * Chokidar emits absolute paths when given absolute watch patterns, but we
   * keep this fallback for safety in case the watcher is configured with `cwd`.
   */
  private toAbsolutePath(path: string): string {
    if (isAbsolute(path)) return path;
    return join(this.watchRoot, path);
  }

  /**
   * Handle file change (add or change).
   */
  private handleFileChange(path: string, event: 'add' | 'change'): void {
    const absPath = this.toAbsolutePath(path);

    // Debounce to avoid spam
    const existingTimer = this.debounceTimers.get(absPath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(async () => {
      try {
        await this.ingestFile(absPath, event);
      } catch (error) {
        console.error(`[AutoIngest] Failed to ingest ${absPath}:`, error);
        this.stats.errors++;
      } finally {
        this.debounceTimers.delete(absPath);
      }
    }, this.options.debounceMs);

    this.debounceTimers.set(absPath, timer);
  }

  /**
   * Handle file delete.
   */
  private async handleFileDelete(path: string): Promise<void> {
    const absPath = this.toAbsolutePath(path);
    console.log(`[AutoIngest] File deleted: ${absPath}`);
    // TODO: Mark related pages as stale or delete them
    this.processedFiles.delete(absPath);
  }

  /**
   * Ingest a single file.
   */
  private async ingestFile(path: string, event: 'add' | 'change'): Promise<void> {
    console.log(`[AutoIngest] Ingesting ${path} (${event})`);
    this.stats.filesWatched++;

    const analyzed = await this.analyzer.analyze(path);
    this.stats.filesIngested++;

    // Call callback
    this.options.onIngest(path, analyzed);

    // Create/update pages based on analysis
    if (this.options.autoCreateEntities) {
      await this.createEntityPages(analyzed, event);
    }

    if (this.options.autoCreateConcepts) {
      await this.createConceptPages(analyzed, event);
    }

    if (this.options.autoCreateStructure) {
      await this.createStructurePages(analyzed, event);
    }

    this.processedFiles.add(path);
  }

  /**
   * Create entity pages for functions, classes, etc.
   */
  private async createEntityPages(analyzed: AnalyzedContent, event: 'add' | 'change'): Promise<void> {
    for (const entity of analyzed.entities) {
      if (entity.type === 'module') continue; // Skip modules for now

      const pageLabel = `${entity.name} (${entity.type})`;
      const existingPage = await this.store.getPageByLabel(pageLabel);

      if (existingPage) {
        // Update existing page
        await this.store.updatePage(existingPage.id, {
          body: this.generateEntityBody(entity, analyzed),
          markChecked: true,
        });
        this.stats.pagesUpdated++;
        this.options.onPageUpdated(existingPage.id, 'entity');
      } else {
        // Create new page
        const page = await this.store.createPage({
          pageType: 'entity',
          label: pageLabel,
          body: this.generateEntityBody(entity, analyzed),
          tags: [entity.type, analyzed.language, analyzed.name],
          sources: [analyzed.path],
          confidenceLevel: 'INFERRED',
        });
        this.stats.pagesCreated++;
        this.options.onPageCreated(page.id, 'entity');
      }
    }
  }

  /**
   * Create concept pages for patterns, algorithms, etc.
   */
  private async createConceptPages(analyzed: AnalyzedContent, event: 'add' | 'change'): Promise<void> {
    for (const concept of analyzed.concepts) {
      if (concept.confidence < 0.6) continue; // Skip low-confidence concepts

      const pageLabel = concept.name;
      const existingPage = await this.store.getPageByLabel(pageLabel);

      if (existingPage) {
        // Update existing page
        await this.store.updatePage(existingPage.id, {
          body: this.generateConceptBody(concept, analyzed),
          markChecked: true,
        });
        this.stats.pagesUpdated++;
        this.options.onPageUpdated(existingPage.id, 'concept');
      } else {
        // Create new page
        const page = await this.store.createPage({
          pageType: 'concept',
          label: pageLabel,
          body: this.generateConceptBody(concept, analyzed),
          tags: [concept.type, analyzed.language],
          sources: [analyzed.path],
          confidenceLevel: this.confidenceToLevel(concept.confidence),
        });
        this.stats.pagesCreated++;
        this.options.onPageCreated(page.id, 'concept');
      }
    }
  }

  /**
   * Create structure pages for file architecture.
   */
  private async createStructurePages(analyzed: AnalyzedContent, event: 'add' | 'change'): Promise<void> {
    const pageLabel = `File: ${analyzed.name}`;
    const existingPage = await this.store.getPageByLabel(pageLabel);

    const body = this.generateStructureBody(analyzed);

    if (existingPage) {
      // Update existing page
      await this.store.updatePage(existingPage.id, {
        body,
        markChecked: true,
      });
      this.stats.pagesUpdated++;
      this.options.onPageUpdated(existingPage.id, 'structure');
    } else {
      // Create new page
      const page = await this.store.createPage({
        pageType: 'structure',
        label: pageLabel,
        body,
        tags: ['structure', analyzed.language],
        sources: [analyzed.path],
        confidenceLevel: 'VERIFIED',
        subtype: 'architecture',
      });
      this.stats.pagesCreated++;
      this.options.onPageCreated(page.id, 'structure');
    }
  }

  /**
   * Generate body for entity page.
   */
  private generateEntityBody(entity: Entity, analyzed: AnalyzedContent): string {
    let body = `# ${entity.name}\n\n`;
    body += `**Type:** ${entity.type}\n`;
    body += `**File:** ${analyzed.path}\n`;
    body += `**Language:** ${analyzed.language}\n`;

    if (entity.line) {
      body += `**Line:** ${entity.line}\n`;
    }

    if (entity.description) {
      body += `\n## Description\n\n${entity.description}\n`;
    }

    body += `\n## Relationships\n\n`;
    const relationships = analyzed.relationships.filter(r => r.source === entity.name || r.target === entity.name);
    if (relationships.length > 0) {
      for (const rel of relationships) {
        body += `- ${rel.type}: ${rel.target}\n`;
      }
    } else {
      body += `_No relationships found._\n`;
    }

    return body;
  }

  /**
   * Generate body for concept page.
   */
  private generateConceptBody(concept: Concept, analyzed: AnalyzedContent): string {
    let body = `# ${concept.name}\n\n`;
    body += `**Type:** ${concept.type}\n`;
    body += `**Confidence:** ${(concept.confidence * 100).toFixed(0)}%\n`;
    body += `**Detected in:** ${analyzed.path}\n`;

    if (concept.description) {
      body += `\n## Description\n\n${concept.description}\n`;
    }

    body += `\n## Usage\n\n`;
    body += `This ${concept.type} was detected in \`${analyzed.name}\`.\n`;

    return body;
  }

  /**
   * Generate body for structure page.
   */
  private generateStructureBody(analyzed: AnalyzedContent): string {
    let body = `# File Structure: ${analyzed.name}\n\n`;
    body += `**Path:** ${analyzed.path}\n`;
    body += `**Language:** ${analyzed.language}\n`;
    body += `**Size:** ${analyzed.size} bytes\n`;
    body += `**Lines:** ${analyzed.metadata.lines}\n`;
    body += `**Complexity:** ${analyzed.metadata.complexity}\n`;
    body += `**Has Tests:** ${analyzed.metadata.hasTests ? 'Yes' : 'No'}\n`;
    body += `**Has Comments:** ${analyzed.metadata.hasComments ? 'Yes' : 'No'}\n`;

    body += `\n## Entities (${analyzed.entities.length})\n\n`;
    if (analyzed.entities.length > 0) {
      for (const entity of analyzed.entities.slice(0, 20)) {
        body += `- **${entity.name}** (${entity.type})${entity.line ? ` (line ${entity.line})` : ''}\n`;
      }
      if (analyzed.entities.length > 20) {
        body += `\n_...and ${analyzed.entities.length - 20} more entities._\n`;
      }
    } else {
      body += `_No entities found._\n`;
    }

    body += `\n## Concepts (${analyzed.concepts.length})\n\n`;
    if (analyzed.concepts.length > 0) {
      for (const concept of analyzed.concepts.slice(0, 10)) {
        body += `- **${concept.name}** (${concept.type}, ${(concept.confidence * 100).toFixed(0)}% confidence)\n`;
      }
      if (analyzed.concepts.length > 10) {
        body += `\n_...and ${analyzed.concepts.length - 10} more concepts._\n`;
      }
    } else {
      body += `_No concepts detected._\n`;
    }

    body += `\n## Relationships (${analyzed.relationships.length})\n\n`;
    if (analyzed.relationships.length > 0) {
      for (const rel of analyzed.relationships.slice(0, 10)) {
        body += `- ${rel.type}: ${rel.target}\n`;
      }
      if (analyzed.relationships.length > 10) {
        body += `\n_...and ${analyzed.relationships.length - 10} more relationships._\n`;
      }
    } else {
      body += `_No relationships found._\n`;
    }

    return body;
  }

  /**
   * Convert confidence (0-1) to ConfidenceLevel.
   */
  private confidenceToLevel(confidence: number): ConfidenceLevel {
    if (confidence >= 0.9) return 'VERIFIED';
    if (confidence >= 0.7) return 'INFERRED';
    return 'ASSUMED';
  }

  /**
   * Get ingest statistics.
   */
  getStats(): IngestStats {
    return { ...this.stats };
  }

  /**
   * Check if watcher is running.
   */
  isRunning(): boolean {
    return this.watcher !== null;
  }

  /**
   * Get list of processed files.
   */
  getProcessedFiles(): string[] {
    return Array.from(this.processedFiles);
  }
}
