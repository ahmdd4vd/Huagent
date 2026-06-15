// ✦ Cold-Start Scanner — Stage 0 ✦
// First-run project context builder
//
// Inspired by ECC's project detection + Aider's RepoMap (lite version)

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';

export interface ColdStartResult {
  root: string;
  projectName: string;
  language: string;
  framework: string[];
  fileCount: number;
  keyFiles: KeyFile[];
  conventions: Record<string, string>;
  agentsRules: string;       // contents of CLAUDE.md / AGENTS.md if present
  readmeExcerpt: string;     // first 500 chars of README
  hasGit: boolean;
  isMonorepo: boolean;
  buildCommand?: string;
  testCommand?: string;
}

export interface KeyFile {
  path: string;
  role: string;
  importance: number; // 0-1
  size: number;
}

/**
 * Cold-Start Scanner
 * Analyzes the project structure to provide context for the first run.
 * Lightweight: doesn't read file contents (just stats).
 */
export class ColdStartScanner {
  private cache = new Map<string, ColdStartResult>();

  constructor(private root: string) {}

  /**
   * Scan project (cached per-session).
   */
  scan(): ColdStartResult {
    if (this.cache.has(this.root)) {
      return this.cache.get(this.root)!;
    }

    const result = this.doScan();
    this.cache.set(this.root, result);
    return result;
  }

  /**
   * Force re-scan (after major project change).
   */
  invalidate(): void {
    this.cache.delete(this.root);
  }

  private doScan(): ColdStartResult {
    const root = this.root;
    const projectName = basename(root);

    // Detect language + framework
    const { language, framework } = this.detectStack(root);

    // Has git?
    const hasGit = existsSync(join(root, '.git'));

    // Monorepo?
    const isMonorepo = this.detectMonorepo(root);

    // Build + test commands
    const { buildCommand, testCommand } = this.detectCommands(root);

    // Read agents rules
    const agentsRules = this.readAgentsRules(root);

    // Read README excerpt
    const readmeExcerpt = this.readReadme(root);

    // Find key files
    const keyFiles = this.findKeyFiles(root);

    // Count files
    const fileCount = this.countFiles(root);

    // Conventions
    const conventions = this.detectConventions(root);

    return {
      root,
      projectName,
      language,
      framework,
      fileCount,
      keyFiles,
      conventions,
      agentsRules,
      readmeExcerpt,
      hasGit,
      isMonorepo,
      buildCommand,
      testCommand,
    };
  }

  private detectStack(root: string): { language: string; framework: string[] } {
    const framework: string[] = [];
    let language = 'unknown';

    if (existsSync(join(root, 'package.json'))) {
      try {
        const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
        language = pkg.devDependencies?.typescript || pkg.dependencies?.typescript
          ? 'typescript'
          : 'javascript';

        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        for (const fw of ['react', 'next', 'vue', 'svelte', 'express', 'fastify', 'hono', 'ink', 'electron']) {
          if (deps[fw]) framework.push(fw);
        }
      } catch {}
    } else if (existsSync(join(root, 'Cargo.toml'))) {
      language = 'rust';
    } else if (existsSync(join(root, 'pyproject.toml')) || existsSync(join(root, 'requirements.txt'))) {
      language = 'python';
    } else if (existsSync(join(root, 'go.mod'))) {
      language = 'go';
    } else if (existsSync(join(root, 'Gemfile'))) {
      language = 'ruby';
    } else if (existsSync(join(root, 'pom.xml')) || existsSync(join(root, 'build.gradle'))) {
      language = 'java';
    }

    return { language, framework };
  }

  private detectMonorepo(root: string): boolean {
    const indicators = [
      'lerna.json',
      'pnpm-workspace.yaml',
      'yarn.lock',
      'nx.json',
      'turbo.json',
      'packages',
      'apps',
      'libs',
    ];
    for (const i of indicators) {
      if (existsSync(join(root, i))) return true;
    }
    return false;
  }

  private detectCommands(root: string): { buildCommand?: string; testCommand?: string } {
    const result: { buildCommand?: string; testCommand?: string } = {};

    if (existsSync(join(root, 'package.json'))) {
      try {
        const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
        if (pkg.scripts?.build) result.buildCommand = `npm run build`;
        if (pkg.scripts?.test) result.testCommand = `npm test`;
      } catch {}
    } else if (existsSync(join(root, 'Cargo.toml'))) {
      result.buildCommand = 'cargo build';
      result.testCommand = 'cargo test';
    } else if (existsSync(join(root, 'pyproject.toml'))) {
      result.buildCommand = 'python -m build';
      result.testCommand = 'pytest';
    } else if (existsSync(join(root, 'go.mod'))) {
      result.buildCommand = 'go build';
      result.testCommand = 'go test';
    }

    return result;
  }

  private readAgentsRules(root: string): string {
    for (const filename of ['CLAUDE.md', 'AGENTS.md', '.cursorrules']) {
      const p = join(root, filename);
      if (existsSync(p)) {
        try {
          return readFileSync(p, 'utf8').slice(0, 3000);
        } catch {}
      }
    }
    return '';
  }

  private readReadme(root: string): string {
    for (const name of ['README.md', 'readme.md', 'README.rst', 'README']) {
      const p = join(root, name);
      if (existsSync(p)) {
        try {
          return readFileSync(p, 'utf8').slice(0, 500);
        } catch {}
      }
    }
    return '';
  }

  /**
   * Find key files (entry points, configs, important source files).
   * Lightweight: just stat, don't read content.
   */
  private findKeyFiles(root: string): KeyFile[] {
    const keyFiles: KeyFile[] = [];
    const skipDirs = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'target', '__pycache__']);

    const importantNames: Record<string, { role: string; importance: number }> = {
      'package.json': { role: 'package config', importance: 0.95 },
      'tsconfig.json': { role: 'typescript config', importance: 0.85 },
      'README.md': { role: 'documentation', importance: 0.7 },
      'index.ts': { role: 'entry point', importance: 0.9 },
      'index.js': { role: 'entry point', importance: 0.9 },
      'main.ts': { role: 'entry point', importance: 0.9 },
      'main.py': { role: 'entry point', importance: 0.9 },
      'app.ts': { role: 'application root', importance: 0.85 },
      'cli.tsx': { role: 'CLI entry', importance: 0.9 },
      'cli.ts': { role: 'CLI entry', importance: 0.9 },
      'server.ts': { role: 'server entry', importance: 0.85 },
      'routes.ts': { role: 'routes', importance: 0.8 },
      'models.py': { role: 'data models', importance: 0.8 },
    };

    const walk = (dir: string, depth: number) => {
      if (depth <= 0) return;
      let entries: any[];
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (skipDirs.has(entry.name)) continue;
          walk(join(dir, entry.name), depth - 1);
        } else if (entry.isFile()) {
          const meta = importantNames[entry.name];
          if (meta) {
            const path = relative(root, join(dir, entry.name));
            try {
              const stat = statSync(join(dir, entry.name));
              keyFiles.push({
                path,
                role: meta.role,
                importance: meta.importance,
                size: stat.size,
              });
            } catch {}
          }
        }
      }
    };

    walk(root, 3); // shallow scan

    return keyFiles
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 20);
  }

  private countFiles(root: string): number {
    const skipDirs = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'target', '__pycache__']);
    let count = 0;
    const walk = (dir: string, depth: number) => {
      if (depth <= 0) return;
      let entries: any[];
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (skipDirs.has(entry.name)) continue;
          walk(join(dir, entry.name), depth - 1);
        } else {
          count++;
        }
      }
    };
    walk(root, 5);
    return count;
  }

  private detectConventions(root: string): Record<string, string> {
    const conv: Record<string, string> = {};

    if (existsSync(join(root, '.eslintrc.json')) || existsSync(join(root, '.eslintrc.js'))) {
      conv.linter = 'eslint';
    }
    if (existsSync(join(root, '.prettierrc'))) {
      conv.formatter = 'prettier';
    }
    if (existsSync(join(root, 'tsconfig.json'))) {
      try {
        const ts = JSON.parse(readFileSync(join(root, 'tsconfig.json'), 'utf8'));
        if (ts.compilerOptions?.strict) conv.typescript = 'strict';
      } catch {}
    }
    if (existsSync(join(root, 'jest.config.js')) || existsSync(join(root, 'jest.config.ts'))) {
      conv.testFramework = 'jest';
    } else if (existsSync(join(root, 'vitest.config.ts'))) {
      conv.testFramework = 'vitest';
    } else if (existsSync(join(root, 'pytest.ini')) || existsSync(join(root, 'pyproject.toml'))) {
      try {
        if (existsSync(join(root, 'pytest.ini'))) {
          conv.testFramework = 'pytest';
        }
      } catch {}
    }

    return conv;
  }

  /**
   * Render as context for system prompt.
   */
  render(): string {
    const r = this.scan();
    let out = `# Cold-Start Project Context\n\n`;
    out += `- **Project**: ${r.projectName}\n`;
    out += `- **Language**: ${r.language}\n`;
    if (r.framework.length > 0) {
      out += `- **Framework**: ${r.framework.join(', ')}\n`;
    }
    out += `- **Files**: ~${r.fileCount}\n`;
    if (r.isMonorepo) out += `- **Monorepo**: yes\n`;
    if (r.hasGit) out += `- **Git**: yes\n`;
    if (r.buildCommand) out += `- **Build**: \`${r.buildCommand}\`\n`;
    if (r.testCommand) out += `- **Test**: \`${r.testCommand}\`\n`;

    if (r.keyFiles.length > 0) {
      out += `\n## Key Files (top ${Math.min(r.keyFiles.length, 5)})\n`;
      for (const f of r.keyFiles.slice(0, 5)) {
        out += `- \`${f.path}\` — ${f.role} (${f.size}b)\n`;
      }
    }

    if (Object.keys(r.conventions).length > 0) {
      out += `\n## Conventions\n`;
      for (const [k, v] of Object.entries(r.conventions)) {
        out += `- ${k}: ${v}\n`;
      }
    }

    if (r.agentsRules) {
      out += `\n## Project Rules (from CLAUDE.md / AGENTS.md)\n${r.agentsRules}\n`;
    }

    if (r.readmeExcerpt) {
      out += `\n## README Excerpt\n${r.readmeExcerpt}\n`;
    }

    return out;
  }
}
