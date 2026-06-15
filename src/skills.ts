// Skills System - workflow domain knowledge (inspired by ECC's 262 skills)
// Each skill is a directory with a SKILL.md and optional scripts
// Skills can be auto-discovered, invoked, and learned

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename, dirname, extname } from 'node:path';
import { homedir } from 'node:os';
import { nanoid } from 'nanoid';

export interface Skill {
  id: string;
  name: string;
  description: string;
  origin: string;
  content: string;       // SKILL.md content
  scripts: string[];     // List of script paths
  references: string[];   // List of reference files
  triggers: string[];     // Trigger keywords
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();
  private skillsDirs: string[] = [];

  constructor(dirs?: string[]) {
    this.skillsDirs = dirs || [
      join(homedir(), '.huagent', 'skills'),     // User skills
      join(process.cwd(), '.huagent', 'skills'), // Project skills
      join(process.cwd(), 'skills'),              // Project root
    ];
    this.loadAll();
  }

  // Load all skills from configured directories
  loadAll(): void {
    for (const dir of this.skillsDirs) {
      this.loadFromDir(dir);
    }
  }

  // Load skills from a single directory
  loadFromDir(dir: string): number {
    if (!existsSync(dir)) return 0;
    let count = 0;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillPath = join(dir, entry.name, 'SKILL.md');
          if (existsSync(skillPath)) {
            this.loadSkillFile(skillPath, dir);
            count++;
          }
        } else if (entry.isFile() && entry.name === 'SKILL.md') {
          this.loadSkillFile(join(dir, entry.name), dirname(dir));
          count++;
        }
      }
    } catch (err) {
      console.error(`Failed to load skills from ${dir}:`, err);
    }
    return count;
  }

  // Load a single SKILL.md file
  private loadSkillFile(filePath: string, baseDir: string): void {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const { frontmatter, body } = this.parseFrontmatter(content);
      const skillDir = dirname(filePath);

      const skill: Skill = {
        id: frontmatter.name || basename(skillDir),
        name: frontmatter.name || basename(skillDir),
        description: frontmatter.description || '',
        origin: frontmatter.origin || 'local',
        content: body,
        scripts: this.listDir(skillDir, 'scripts'),
        references: this.listDir(skillDir, 'references'),
        triggers: frontmatter.triggers || [],
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      this.skills.set(skill.id, skill);
    } catch (err) {
      console.error(`Failed to load skill ${filePath}:`, err);
    }
  }

  private listDir(baseDir: string, sub: string): string[] {
    const dir = join(baseDir, sub);
    if (!existsSync(dir)) return [];
    try {
      return readdirSync(dir)
        .filter((f) => statSync(join(dir, f)).isFile())
        .map((f) => join(dir, f));
    } catch {
      return [];
    }
  }

  // Parse YAML frontmatter (simple, no deps)
  private parseFrontmatter(content: string): { frontmatter: Record<string, any>; body: string } {
    const match = content.match(/^---\n([\s\S]+?)\n---\n([\s\S]+)$/);
    if (!match) return { frontmatter: {}, body: content };

    const frontmatter: Record<string, any> = {};
    const lines = match[1].split('\n');
    for (const line of lines) {
      const m = line.match(/^(\w+):\s*(.*)$/);
      if (m) {
        const key = m[1];
        let value: any = m[2];
        if (value.startsWith('[') && value.endsWith(']')) {
          value = value.slice(1, -1).split(',').map((s: string) => s.trim().replace(/^['"]|['"]$/g, ''));
        } else if (value.startsWith('"') || value.startsWith("'")) {
          value = value.slice(1, -1);
        }
        frontmatter[key] = value;
      }
    }
    return { frontmatter, body: match[2] };
  }

  // Register a skill programmatically
  register(skill: Omit<Skill, 'createdAt' | 'updatedAt'>): void {
    const now = Date.now();
    this.skills.set(skill.id, { ...skill, createdAt: now, updatedAt: now });
  }

  get(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  list(): Skill[] {
    return Array.from(this.skills.values());
  }

  // Find skills matching a query
  find(query: string, limit = 5): Skill[] {
    const q = query.toLowerCase();
    return this.list()
      .filter((s) => s.enabled)
      .filter((s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.triggers.some((t) => t.toLowerCase().includes(q))
      )
      .sort((a, b) => {
        // Score by name match first
        const aName = a.name.toLowerCase().includes(q) ? 2 : 0;
        const bName = b.name.toLowerCase().includes(q) ? 2 : 0;
        return bName - aName;
      })
      .slice(0, limit);
  }

  // Enable/disable a skill
  setEnabled(id: string, enabled: boolean): boolean {
    const skill = this.skills.get(id);
    if (skill) {
      skill.enabled = enabled;
      return true;
    }
    return false;
  }

  // Format skills list for display
  formatList(): string {
    const skills = this.list();
    if (skills.length === 0) return '  (no skills loaded)';

    const lines: string[] = [];
    for (const s of skills) {
      const status = s.enabled ? '✓' : '○';
      const scripts = s.scripts.length > 0 ? ` (${s.scripts.length} scripts)` : '';
      const refs = s.references.length > 0 ? ` (${s.references.length} refs)` : '';
      lines.push(`  ${status} ${s.name}${scripts}${refs}`);
      lines.push(`    ${s.description.slice(0, 100)}`);
    }
    return lines.join('\n');
  }
}

let _instance: SkillRegistry | null = null;

export function getSkills(): SkillRegistry {
  if (!_instance) {
    _instance = new SkillRegistry();
  }
  return _instance;
}
