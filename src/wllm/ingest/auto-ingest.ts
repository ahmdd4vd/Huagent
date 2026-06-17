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

export class AutoIngest {
  private analyzer: ContentAnalyzer;
  private watcher: chokidar.FSWatcher | null = null;
  private options: Required<AutoIngestOptions>;
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
   */
  start(watchPath?: string): void {
    if (this.watcher) {
      console.warn('[AutoIngest] Already watching');
      return;
    }

    const pathToWatch = watchPath || process.cwd();
    console.log(`[AutoIngest] Starting file watcher on ${pathToWatch}`);

    this.watcher = chokidar.watch(this.options.watchPatterns, {
      cwd: pathToWatch,
      ignored: this.options.ignorePatterns,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    });

    this.watcher
      .on('add', (path) => this.handleFileChange(path, 'add'))
      .on('change', (path) => this.handleFileChange(path, 'change'))
      .on('unlink', (path) => this.handleFileDelete(path))
      .on('error', (error) => {
        console.error('[AutoIngest] Watcher error:', error);
        this.stats.errors++;
      })
      .on('ready', () => {
        console.log('[AutoIngest] Watcher ready');
      });
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

    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  /**
   * Handle file change (add or change).
   */
  private handleFileChange(path: string, event: 'add' | 'change'): void {
    // Debounce to avoid spam
    const existingTimer = this.debounceTimers.get(path);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(async () => {
      try {
        await this.ingestFile(path, event);
      } catch (error) {
        console.error(`[AutoIngest] Failed to ingest ${path}:`, error);
        this.stats.errors++;
      } finally {
        this.debounceTimers.delete(path);
      }
    }, this.options.debounceMs);

    this.debounceTimers.set(path, timer);
  }

  /**
   * Handle file delete.
   */
  private async handleFileDelete(path: string): Promise<void> {
    console.log(`[AutoIngest] File deleted: ${path}`);
    // TODO: Mark related pages as stale or delete them
    this.processedFiles.delete(path);
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
