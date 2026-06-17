/**
 * Content Analyzer — Extract entities and concepts from code files.
 * 
 * Analyzes code files and extracts:
 * - Entities (functions, classes, modules)
 * - Concepts (patterns, algorithms, data structures)
 * - Relationships (imports, dependencies)
 * - Metadata (language, size, complexity)
 */

import { readFile } from 'node:fs/promises';
import { extname, basename } from 'node:path';

export interface AnalyzedContent {
  /** File path */
  path: string;
  /** File name */
  name: string;
  /** Language (typescript, javascript, etc.) */
  language: string;
  /** File size in bytes */
  size: number;
  /** Entities found (functions, classes, modules) */
  entities: Entity[];
  /** Concepts found (patterns, algorithms) */
  concepts: Concept[];
  /** Relationships (imports, dependencies) */
  relationships: Relationship[];
  /** Metadata */
  metadata: {
    lines: number;
    complexity: 'low' | 'medium' | 'high';
    hasTests: boolean;
    hasComments: boolean;
  };
}

export interface Entity {
  /** Entity name */
  name: string;
  /** Entity type (function, class, module, etc.) */
  type: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'module';
  /** Entity description (extracted from comments) */
  description?: string;
  /** Line number where entity is defined */
  line?: number;
}

export interface Concept {
  /** Concept name */
  name: string;
  /** Concept type (pattern, algorithm, data-structure) */
  type: 'pattern' | 'algorithm' | 'data-structure' | 'architecture';
  /** Concept description */
  description?: string;
  /** Confidence (0-1) */
  confidence: number;
}

export interface Relationship {
  /** Relationship type */
  type: 'imports' | 'extends' | 'implements' | 'calls' | 'uses';
  /** Target entity */
  target: string;
  /** Source entity */
  source?: string;
}

export class ContentAnalyzer {
  /**
   * Analyze a code file and extract entities/concepts.
   */
  async analyze(filePath: string): Promise<AnalyzedContent> {
    const content = await readFile(filePath, 'utf-8');
    const language = this.detectLanguage(filePath);
    const lines = content.split('\n');

    const entities = this.extractEntities(content, language);
    const concepts = this.extractConcepts(content, language);
    const relationships = this.extractRelationships(content, language);

    return {
      path: filePath,
      name: basename(filePath),
      language,
      size: content.length,
      entities,
      concepts,
      relationships,
      metadata: {
        lines: lines.length,
        complexity: this.calculateComplexity(lines),
        hasTests: this.hasTests(content),
        hasComments: this.hasComments(content),
      },
    };
  }

  /**
   * Detect programming language from file extension.
   */
  private detectLanguage(filePath: string): string {
    const ext = extname(filePath).toLowerCase();
    const languageMap: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescript-react',
      '.js': 'javascript',
      '.jsx': 'javascript-react',
      '.py': 'python',
      '.rs': 'rust',
      '.go': 'go',
      '.java': 'java',
      '.rb': 'ruby',
      '.php': 'php',
      '.cs': 'csharp',
      '.cpp': 'cpp',
      '.c': 'c',
      '.swift': 'swift',
      '.kt': 'kotlin',
    };
    return languageMap[ext] || 'unknown';
  }

  /**
   * Extract entities (functions, classes, etc.) from code.
   */
  private extractEntities(content: string, language: string): Entity[] {
    const entities: Entity[] = [];
    const lines = content.split('\n');

    // Extract functions
    const functionPatterns = [
      /function\s+(\w+)/g,
      /const\s+(\w+)\s*=\s*(?:async\s*)?\(/g,
      /export\s+(?:async\s+)?function\s+(\w+)/g,
    ];

    for (const pattern of functionPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const name = match[1];
        const line = content.substring(0, match.index).split('\n').length;
        entities.push({
          name,
          type: 'function',
          line,
          description: this.extractComment(lines, line - 1),
        });
      }
    }

    // Extract classes
    const classPattern = /class\s+(\w+)/g;
    let match;
    while ((match = classPattern.exec(content)) !== null) {
      const name = match[1];
      const line = content.substring(0, match.index).split('\n').length;
      entities.push({
        name,
        type: 'class',
        line,
        description: this.extractComment(lines, line - 1),
      });
    }

    // Extract interfaces (TypeScript)
    if (language.includes('typescript')) {
      const interfacePattern = /interface\s+(\w+)/g;
      while ((match = interfacePattern.exec(content)) !== null) {
        const name = match[1];
        const line = content.substring(0, match.index).split('\n').length;
        entities.push({
          name,
          type: 'interface',
          line,
          description: this.extractComment(lines, line - 1),
        });
      }

      // Extract types
      const typePattern = /type\s+(\w+)\s*=/g;
      while ((match = typePattern.exec(content)) !== null) {
        const name = match[1];
        const line = content.substring(0, match.index).split('\n').length;
        entities.push({
          name,
          type: 'type',
          line,
          description: this.extractComment(lines, line - 1),
        });
      }
    }

    // Extract modules (imports)
    const importPattern = /import\s+.*?from\s+['"](.+?)['"]/g;
    while ((match = importPattern.exec(content)) !== null) {
      const modulePath = match[1];
      entities.push({
        name: modulePath,
        type: 'module',
      });
    }

    return entities;
  }

  /**
   * Extract concepts (patterns, algorithms) from code.
   */
  private extractConcepts(content: string, language: string): Concept[] {
    const concepts: Concept[] = [];
    const contentLower = content.toLowerCase();

    // Detect common patterns
    const patterns = [
      { name: 'Factory Pattern', pattern: /factory|create\w+Instance/g, type: 'pattern' as const },
      { name: 'Singleton Pattern', pattern: /singleton|getinstance/g, type: 'pattern' as const },
      { name: 'Observer Pattern', pattern: /observer|subscribe|emit/g, type: 'pattern' as const },
      { name: 'Strategy Pattern', pattern: /strategy|policy/g, type: 'pattern' as const },
      { name: 'Decorator Pattern', pattern: /decorator|@\w+/g, type: 'pattern' as const },
      { name: 'MVC Pattern', pattern: /model|view|controller/g, type: 'pattern' as const },
      { name: 'Repository Pattern', pattern: /repository|dao/g, type: 'pattern' as const },
      { name: 'Middleware Pattern', pattern: /middleware|use\(/g, type: 'pattern' as const },
    ];

    for (const { name, pattern, type } of patterns) {
      if (pattern.test(contentLower)) {
        concepts.push({
          name,
          type,
          confidence: 0.7,
        });
      }
    }

    // Detect algorithms
    const algorithms = [
      { name: 'Binary Search', pattern: /binary\s*search|binarysearch/g, type: 'algorithm' as const },
      { name: 'Quick Sort', pattern: /quick\s*sort|quicksort/g, type: 'algorithm' as const },
      { name: 'Merge Sort', pattern: /merge\s*sort|mergesort/g, type: 'algorithm' as const },
      { name: 'Dynamic Programming', pattern: /dp|dynamic\s*programming|memoiz/g, type: 'algorithm' as const },
      { name: 'BFS', pattern: /bfs|breadth[\s-]*first/g, type: 'algorithm' as const },
      { name: 'DFS', pattern: /dfs|depth[\s-]*first/g, type: 'algorithm' as const },
    ];

    for (const { name, pattern, type } of algorithms) {
      if (pattern.test(contentLower)) {
        concepts.push({
          name,
          type,
          confidence: 0.8,
        });
      }
    }

    // Detect data structures
    const dataStructures = [
      { name: 'Array', pattern: /\[\]|array|list/g, type: 'data-structure' as const },
      { name: 'Map', pattern: /map|dictionary|hash/g, type: 'data-structure' as const },
      { name: 'Set', pattern: /\bset\b/g, type: 'data-structure' as const },
      { name: 'Tree', pattern: /tree|node|binary/g, type: 'data-structure' as const },
      { name: 'Graph', pattern: /graph|edge|vertex/g, type: 'data-structure' as const },
      { name: 'Queue', pattern: /queue|fifo/g, type: 'data-structure' as const },
      { name: 'Stack', pattern: /stack|lifo/g, type: 'data-structure' as const },
    ];

    for (const { name, pattern, type } of dataStructures) {
      if (pattern.test(contentLower)) {
        concepts.push({
          name,
          type,
          confidence: 0.6,
        });
      }
    }

    return concepts;
  }

  /**
   * Extract relationships (imports, dependencies) from code.
   */
  private extractRelationships(content: string, language: string): Relationship[] {
    const relationships: Relationship[] = [];

    // Extract imports
    const importPatterns = [
      /import\s+.*?from\s+['"](.+?)['"]/g,
      /require\(['"](.+?)['"]\)/g,
    ];

    for (const pattern of importPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        relationships.push({
          type: 'imports',
          target: match[1],
        });
      }
    }

    // Extract extends (classes)
    const extendsPattern = /class\s+\w+\s+extends\s+(\w+)/g;
    let match;
    while ((match = extendsPattern.exec(content)) !== null) {
      relationships.push({
        type: 'extends',
        target: match[1],
      });
    }

    // Extract implements (interfaces)
    if (language.includes('typescript')) {
      const implementsPattern = /class\s+\w+.*?implements\s+([\w\s,]+)/g;
      while ((match = implementsPattern.exec(content)) !== null) {
        const interfaces = match[1].split(',').map(s => s.trim());
        for (const iface of interfaces) {
          relationships.push({
            type: 'implements',
            target: iface,
          });
        }
      }
    }

    return relationships;
  }

  /**
   * Extract comment above a line.
   */
  private extractComment(lines: string[], lineIndex: number): string | undefined {
    if (lineIndex < 0) return undefined;

    const commentLines: string[] = [];
    let i = lineIndex - 1;

    // Look for JSDoc comments (/** ... */)
    while (i >= 0) {
      const line = lines[i].trim();
      if (line.startsWith('/**') || line.startsWith('*') || line.startsWith('//')) {
        commentLines.unshift(line.replace(/^\/\*+\s?|\*\/\s?$|^\*+\s?|^\/\/\s?/g, ''));
        i--;
      } else if (line === '') {
        i--;
      } else {
        break;
      }
    }

    return commentLines.length > 0 ? commentLines.join(' ').trim() : undefined;
  }

  /**
   * Calculate code complexity (low/medium/high).
   */
  private calculateComplexity(lines: string[]): 'low' | 'medium' | 'high' {
    let complexity = 0;

    for (const line of lines) {
      // Count control flow statements
      if (/\b(if|else|for|while|switch|case)\b/.test(line)) {
        complexity++;
      }
      // Count nested functions
      if (/\b(function|=>)\b/.test(line) && /\b(function|=>)\b/.test(line.split('//')[0])) {
        complexity++;
      }
    }

    if (complexity < 10) return 'low';
    if (complexity < 30) return 'medium';
    return 'high';
  }

  /**
   * Check if file has tests.
   */
  private hasTests(content: string): boolean {
    const testPatterns = [
      /describe\s*\(/,
      /it\s*\(/,
      /test\s*\(/,
      /expect\s*\(/,
      /assert\s*\(/,
    ];

    return testPatterns.some(pattern => pattern.test(content));
  }

  /**
   * Check if file has comments.
   */
  private hasComments(content: string): boolean {
    return /\/\*[\s\S]*?\*\/|\/\//.test(content);
  }
}
