// ✦ Identity Context — Cross-Model Persistence ✦
// The "soul" of the agent that survives model switches
//
// Inpired by Pi's tree-based session + ECC's project context
// Innovation: Persona + principles + project facts always present
// regardless of which LLM is currently active

import { readFileSync, existsSync, statSync, readdirSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, basename, extname, dirname } from 'node:path';
import { createHash } from 'node:crypto';

export interface IdentitySnapshot {
  // === Persona (rarely changes) ===
  persona: {
    name: string;
    style: string;
    emoji: string[];
    language: string;
  };

  // === Principles (rarely changes) ===
  principles: string[];

  // === Project Facts (discovered from project) ===
  project: {
    root: string;
    name: string;
    type: 'typescript' | 'javascript' | 'python' | 'rust' | 'go' | 'ruby' | 'java' | 'unknown';
    framework: string[];
    entryPoints: string[];
    conventions: Record<string, string>;
    fileCount: number;
  };

  // === User Preferences (learned over time) ===
  preferences: {
    language: 'id' | 'en' | 'mixed';
    tone: 'casual' | 'formal' | 'technical';
    terseness: 'terse' | 'balanced' | 'verbose';
  };

  // === Active Context (changes per turn) ===
  context: {
    currentFiles: string[];
    recentTools: string[];
    lastError?: string;
  };

  // === Meta ===
  version: number;
  updatedAt: number;
  hash: string;
}

const DEFAULT_PRINCIPLES = [
  'Always show your work — explain what you did and why',
  'Ship working code, not promises',
  'Never break working code (snapshot before edit)',
  'Be concise — prefer signals over noise',
  'Verify before declaring success',
  'Learn from mistakes — record anti-patterns',
  'Respect the user — honor their preferences',
];

const DEFAULT_PERSONA = {
  name: 'Hua',
  style: 'anime-powered AI coding agent — magical, precise, helpful',
  emoji: ['✦', '✧', '✿', '♡'],
  language: 'id',
};

/**
 * Build identity context for a project.
 * Called at session start + after major changes.
 */
export class IdentityManager {
  private cache: IdentitySnapshot | null = null;
  private cacheFile: string;

  constructor(projectRoot: string, private memory?: any) {
    this.cacheFile = join(projectRoot, '.huagent', 'identity.json');
  }

  /**
   * Get current identity (loads from cache or builds fresh).
   */
  async get(): Promise<IdentitySnapshot> {
    if (this.cache) return this.cache;

    // Try cache first
    if (existsSync(this.cacheFile)) {
      try {
        const cached = JSON.parse(readFileSync(this.cacheFile, 'utf8'));
        // Validate hash matches project state
        const currentHash = await this.computeProjectHash();
        if (cached.hash === currentHash && this.isStillValid(cached)) {
          this.cache = cached;
          return this.cache!;
        }
      } catch {
        // Cache invalid, rebuild
      }
    }

    // Build fresh
    const fresh = await this.build();
    this.cache = fresh;
    this.persist(fresh);
    return fresh;
  }

  /**
   * Force refresh identity (after major project change).
   */
  async refresh(): Promise<IdentitySnapshot> {
    this.cache = null;
    if (existsSync(this.cacheFile)) {
      try {
        unlinkSync(this.cacheFile);
      } catch {}
    }
    return this.get();
  }

  /**
   * Update active context (cheap, called per turn).
   */
  updateContext(updates: Partial<IdentitySnapshot['context']>): void {
    if (this.cache) {
      this.cache.context = { ...this.cache.context, ...updates };
      this.cache.updatedAt = Date.now();
    }
  }

  /**
   * Update preferences (learned from user behavior).
   */
  updatePreferences(updates: Partial<IdentitySnapshot['preferences']>): void {
    if (this.cache) {
      this.cache.preferences = { ...this.cache.preferences, ...updates };
      this.cache.version++;
      this.cache.updatedAt = Date.now();
    }
  }

  /**
   * Render identity for injection into system prompt.
   * This is the CROSS-MODEL PERSISTENCE mechanism.
   */
  render(): string {
    if (!this.cache) return '';

    const { persona, principles, project, preferences, context } = this.cache;

    let out = `# Your Identity (always present, regardless of model)\n\n`;
    out += `## Persona\n`;
    out += `You are ${persona.name}, ${persona.style}.\n`;
    out += `Use sparkle emojis sparingly: ${persona.emoji.join(' ')}\n\n`;

    out += `## Principles (non-negotiable)\n`;
    for (const p of principles) {
      out += `- ${p}\n`;
    }
    out += '\n';

    if (project.name) {
      out += `## Project Context\n`;
      out += `- **Project**: ${project.name}\n`;
      out += `- **Type**: ${project.type}\n`;
      if (project.framework.length > 0) {
        out += `- **Framework**: ${project.framework.join(', ')}\n`;
      }
      if (project.entryPoints.length > 0) {
        out += `- **Entry points**: ${project.entryPoints.slice(0, 3).join(', ')}\n`;
      }
      out += `- **Files**: ~${project.fileCount}\n`;
      out += '\n';
    }

    out += `## User Preferences\n`;
    out += `- Language: ${preferences.language}\n`;
    out += `- Tone: ${preferences.tone}\n`;
    out += `- Terse: ${preferences.terseness}\n\n`;

    if (context.currentFiles.length > 0) {
      out += `## Active Context\n`;
      out += `Working on: ${context.currentFiles.slice(0, 5).join(', ')}\n`;
      if (context.recentTools.length > 0) {
        out += `Recent tools: ${context.recentTools.slice(0, 3).join(', ')}\n`;
      }
      if (context.lastError) {
        out += `Last error: ${context.lastError}\n`;
      }
    }

    return out;
  }

  // ═══════════════════════════════════════════════════
  // Private
  // ═══════════════════════════════════════════════════

  private async build(): Promise<IdentitySnapshot> {
    const root = this.cacheFile.replace('/.huagent/identity.json', '');
    const project = await this.scanProject(root);

    // Load user prefs from memory if available
    const preferences = await this.loadPreferences();

    return {
      persona: DEFAULT_PERSONA,
      principles: DEFAULT_PRINCIPLES,
      project,
      preferences,
      context: {
        currentFiles: [],
        recentTools: [],
      },
      version: 1,
      updatedAt: Date.now(),
      hash: await this.computeProjectHash(),
    };
  }

  private async scanProject(root: string): Promise<IdentitySnapshot['project']> {
    const name = basename(root);

    // Detect language
    const pkgJsonPath = join(root, 'package.json');
    const cargoPath = join(root, 'Cargo.toml');
    const pyprojectPath = join(root, 'pyproject.toml');
    const goModPath = join(root, 'go.mod');

    let type: IdentitySnapshot['project']['type'] = 'unknown';
    let framework: string[] = [];
    let entryPoints: string[] = [];
    let conventions: Record<string, string> = {};
    let fileCount = 0;

    if (existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
        type = pkg.devDependencies?.typescript ? 'typescript' : 'javascript';

        // Detect frameworks
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps.react) framework.push('react');
        if (deps.next) framework.push('next');
        if (deps.express) framework.push('express');
        if (deps.fastify) framework.push('fastify');
        if (deps.ink) framework.push('ink');
        if (deps['@anthropic-ai/sdk']) framework.push('anthropic-sdk');
        if (deps.openai) framework.push('openai-sdk');

        // Detect entry points
        if (pkg.main) entryPoints.push(pkg.main);
        if (pkg.bin) {
          for (const [, path] of Object.entries(pkg.bin || {})) {
            entryPoints.push(path as string);
          }
        }
        if (pkg.scripts?.start) entryPoints.push('npm start');

        // Conventions
        if (pkg.type === 'module') conventions.moduleSystem = 'ESM';
        if (pkg.scripts?.test) conventions.testCommand = pkg.scripts.test;
        if (pkg.scripts?.build) conventions.buildCommand = pkg.scripts.build;
      } catch {}
    } else if (existsSync(cargoPath)) {
      type = 'rust';
    } else if (existsSync(pyprojectPath)) {
      type = 'python';
    } else if (existsSync(goModPath)) {
      type = 'go';
    }

    // Scan files
    try {
      fileCount = this.countFiles(root, 3);
    } catch {}

    return {
      root,
      name,
      type,
      framework,
      entryPoints,
      conventions,
      fileCount,
    };
  }

  private countFiles(dir: string, depth: number): number {
    if (depth <= 0) return 0;
    let count = 0;
    const skipDirs = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.huagent']);

    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (skipDirs.has(entry.name)) continue;
          count += this.countFiles(join(dir, entry.name), depth - 1);
        } else if (entry.isFile()) {
          count++;
        }
      }
    } catch {}

    return count;
  }

  private async loadPreferences(): Promise<IdentitySnapshot['preferences']> {
    if (!this.memory) {
      return { language: 'id', tone: 'casual', terseness: 'balanced' };
    }

    // Try to recall from memory
    const prefs = this.memory.recall('user preferences tone language', 5);
    const langPref = prefs.find((p: any) => p.metadata?.kind === 'preference-language');
    const tonePref = prefs.find((p: any) => p.metadata?.kind === 'preference-tone');

    return {
      language: langPref?.metadata?.value || 'id',
      tone: tonePref?.metadata?.value || 'casual',
      terseness: 'balanced',
    };
  }

  private isStillValid(cached: IdentitySnapshot): boolean {
    // Cache valid for 1 hour
    return Date.now() - cached.updatedAt < 3600 * 1000;
  }

  private async computeProjectHash(): Promise<string> {
    // Hash key project files
    const root = this.cacheFile.replace('/.huagent/identity.json', '');
    const keyFiles = ['package.json', 'Cargo.toml', 'pyproject.toml', 'go.mod', 'README.md'];
    const hash = createHash('sha256');

    for (const f of keyFiles) {
      const p = join(root, f);
      if (existsSync(p)) {
        try {
          const stat = statSync(p);
          hash.update(`${f}:${stat.mtimeMs}:`);
        } catch {}
      }
    }
    return hash.digest('hex').slice(0, 16);
  }

  private persist(identity: IdentitySnapshot): void {
    try {
      const dir = dirname(this.cacheFile);
      mkdirSync(dir, { recursive: true });
      writeFileSync(this.cacheFile, JSON.stringify(identity, null, 2));
    } catch {}
  }
}
