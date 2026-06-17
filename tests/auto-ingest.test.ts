/**
 * Tests for Auto-Ingest functionality (Phase 2 - Task 7)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ContentAnalyzer } from '../src/wllm/ingest/content-analyzer.js';
import { AutoIngest } from '../src/wllm/ingest/auto-ingest.js';
import { WikiStore } from '../src/wllm/graph/wiki-store.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Auto-Ingest', () => {
  let store: WikiStore;
  let autoIngest: AutoIngest;
  let tempDir: string;

  beforeEach(async () => {
    store = new WikiStore();
    tempDir = join(tmpdir(), `huagent-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    if (autoIngest?.isRunning()) {
      await autoIngest.stop();
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('ContentAnalyzer', () => {
    let analyzer: ContentAnalyzer;

    beforeEach(() => {
      analyzer = new ContentAnalyzer();
    });

    it('should detect TypeScript language', async () => {
      const filePath = join(tempDir, 'test.ts');
      await writeFile(filePath, 'const x: number = 5;');

      const analyzed = await analyzer.analyze(filePath);
      expect(analyzed.language).toBe('typescript');
    });

    it('should detect JavaScript language', async () => {
      const filePath = join(tempDir, 'test.js');
      await writeFile(filePath, 'const x = 5;');

      const analyzed = await analyzer.analyze(filePath);
      expect(analyzed.language).toBe('javascript');
    });

    it('should extract functions', async () => {
      const filePath = join(tempDir, 'test.ts');
      await writeFile(filePath, `
function add(a: number, b: number): number {
  return a + b;
}

function multiply(x: number, y: number): number {
  return x * y;
}
      `);

      const analyzed = await analyzer.analyze(filePath);
      const functions = analyzed.entities.filter(e => e.type === 'function');
      expect(functions.length).toBe(2);
      expect(functions.map(f => f.name)).toContain('add');
      expect(functions.map(f => f.name)).toContain('multiply');
    });

    it('should extract classes', async () => {
      const filePath = join(tempDir, 'test.ts');
      await writeFile(filePath, `
class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }
}

class Logger {
  log(message: string): void {
    console.log(message);
  }
}
      `);

      const analyzed = await analyzer.analyze(filePath);
      const classes = analyzed.entities.filter(e => e.type === 'class');
      expect(classes.length).toBe(2);
      expect(classes.map(c => c.name)).toContain('Calculator');
      expect(classes.map(c => c.name)).toContain('Logger');
    });

    it('should extract interfaces (TypeScript)', async () => {
      const filePath = join(tempDir, 'test.ts');
      await writeFile(filePath, `
interface User {
  id: number;
  name: string;
}

interface Product {
  id: number;
  title: string;
  price: number;
}
      `);

      const analyzed = await analyzer.analyze(filePath);
      const interfaces = analyzed.entities.filter(e => e.type === 'interface');
      expect(interfaces.length).toBe(2);
      expect(interfaces.map(i => i.name)).toContain('User');
      expect(interfaces.map(i => i.name)).toContain('Product');
    });

    it('should extract imports', async () => {
      const filePath = join(tempDir, 'test.ts');
      await writeFile(filePath, `
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import express from 'express';
      `);

      const analyzed = await analyzer.analyze(filePath);
      const modules = analyzed.entities.filter(e => e.type === 'module');
      expect(modules.length).toBe(3);
      expect(modules.map(m => m.name)).toContain('node:fs/promises');
      expect(modules.map(m => m.name)).toContain('node:path');
      expect(modules.map(m => m.name)).toContain('express');
    });

    it('should detect patterns', async () => {
      const filePath = join(tempDir, 'test.ts');
      await writeFile(filePath, `
class CalculatorFactory {
  static createInstance() {
    return new Calculator();
  }
}

class Singleton {
  private static instance: Singleton;
  static getInstance() {
    if (!this.instance) {
      this.instance = new Singleton();
    }
    return this.instance;
  }
}
      `);

      const analyzed = await analyzer.analyze(filePath);
      const patterns = analyzed.concepts.filter(c => c.type === 'pattern');
      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns.map(p => p.name)).toContain('Factory Pattern');
      expect(patterns.map(p => p.name)).toContain('Singleton Pattern');
    });

    it('should detect data structures', async () => {
      const filePath = join(tempDir, 'test.ts');
      await writeFile(filePath, `
const arr: number[] = [1, 2, 3];
const map = new Map<string, number>();
const set = new Set<number>();
      `);

      const analyzed = await analyzer.analyze(filePath);
      const dataStructures = analyzed.concepts.filter(c => c.type === 'data-structure');
      expect(dataStructures.length).toBeGreaterThan(0);
    });

    it('should extract relationships', async () => {
      const filePath = join(tempDir, 'test.ts');
      await writeFile(filePath, `
import { readFile } from 'node:fs/promises';

class Animal {
  name: string;
}

class Dog extends Animal {
  bark(): void {
    console.log('Woof!');
  }
}
      `);

      const analyzed = await analyzer.analyze(filePath);
      expect(analyzed.relationships.length).toBeGreaterThan(0);
      
      const imports = analyzed.relationships.filter(r => r.type === 'imports');
      expect(imports.length).toBe(1);
      expect(imports[0].target).toBe('node:fs/promises');

      const extends_ = analyzed.relationships.filter(r => r.type === 'extends');
      expect(extends_.length).toBe(1);
      expect(extends_[0].target).toBe('Animal');
    });

    it('should calculate complexity', async () => {
      const filePath = join(tempDir, 'test.ts');
      await writeFile(filePath, `
function simple() {
  return 1;
}

function complex() {
  if (true) {
    for (let i = 0; i < 10; i++) {
      if (i > 5) {
        while (true) {
          break;
        }
      }
    }
  }
}
      `);

      const analyzed = await analyzer.analyze(filePath);
      expect(['low', 'medium', 'high']).toContain(analyzed.metadata.complexity);
    });

    it('should detect tests', async () => {
      const filePath = join(tempDir, 'test.spec.ts');
      await writeFile(filePath, `
describe('Calculator', () => {
  it('should add numbers', () => {
    expect(add(1, 2)).toBe(3);
  });
});
      `);

      const analyzed = await analyzer.analyze(filePath);
      expect(analyzed.metadata.hasTests).toBe(true);
    });

    it('should detect comments', async () => {
      const filePath = join(tempDir, 'test.ts');
      await writeFile(filePath, `
// This is a comment
function add(a: number, b: number): number {
  return a + b;
}

/**
 * Multiply two numbers
 */
function multiply(a: number, b: number): number {
  return a * b;
}
      `);

      const analyzed = await analyzer.analyze(filePath);
      expect(analyzed.metadata.hasComments).toBe(true);
    });

    it('should extract comments for entities', async () => {
      const filePath = join(tempDir, 'test.ts');
      await writeFile(filePath, `
/**
 * Add two numbers together
 * @param a First number
 * @param b Second number
 */
function add(a: number, b: number): number {
  return a + b;
}
      `);

      const analyzed = await analyzer.analyze(filePath);
      const addFunction = analyzed.entities.find(e => e.name === 'add');
      expect(addFunction).toBeDefined();
      expect(addFunction?.description).toContain('Add two numbers');
    });
  });

  describe('AutoIngest Service', () => {
    beforeEach(() => {
      autoIngest = new AutoIngest(store, {
        debounceMs: 100, // Fast debounce for testing
      });
    });

    it('should start and stop watcher', async () => {
      autoIngest.start(tempDir);
      expect(autoIngest.isRunning()).toBe(true);

      await autoIngest.stop();
      expect(autoIngest.isRunning()).toBe(false);
    });

    it('should ingest file on add', async () => {
      autoIngest.start(tempDir);

      const filePath = join(tempDir, 'test.ts');
      await writeFile(filePath, 'function add(a: number, b: number): number { return a + b; }');

      // Wait for debounce + processing
      await new Promise(resolve => setTimeout(resolve, 500));

      const stats = autoIngest.getStats();
      expect(stats.filesIngested).toBeGreaterThan(0);
      expect(stats.pagesCreated).toBeGreaterThan(0);

      await autoIngest.stop();
    });

    it('should ingest file on change', async () => {
      const filePath = join(tempDir, 'test.ts');
      await writeFile(filePath, 'function add(a: number, b: number): number { return a + b; }');

      autoIngest.start(tempDir);

      // Modify file
      await writeFile(filePath, 'function multiply(a: number, b: number): number { return a * b; }');

      // Wait for debounce + processing
      await new Promise(resolve => setTimeout(resolve, 500));

      const stats = autoIngest.getStats();
      expect(stats.filesIngested).toBeGreaterThan(0);

      await autoIngest.stop();
    });

    it('should create entity pages', async () => {
      autoIngest.start(tempDir);

      const filePath = join(tempDir, 'test.ts');
      await writeFile(filePath, `
function add(a: number, b: number): number {
  return a + b;
}

class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }
}
      `);

      // Wait for debounce + processing
      await new Promise(resolve => setTimeout(resolve, 500));

      const stats = autoIngest.getStats();
      expect(stats.pagesCreated).toBeGreaterThan(0);

      // Check that pages were created in store
      const allPages = await store.listAll();
      expect(allPages.length).toBeGreaterThan(0);

      await autoIngest.stop();
    });

    it('should create concept pages', async () => {
      autoIngest.start(tempDir);

      const filePath = join(tempDir, 'test.ts');
      await writeFile(filePath, `
class Singleton {
  private static instance: Singleton;
  static getInstance() {
    if (!this.instance) {
      this.instance = new Singleton();
    }
    return this.instance;
  }
}
      `);

      // Wait for debounce + processing
      await new Promise(resolve => setTimeout(resolve, 500));

      const allPages = await store.listAll();
      const conceptPages = allPages.filter(p => p.pageType === 'concept');
      expect(conceptPages.length).toBeGreaterThan(0);

      await autoIngest.stop();
    });

    it('should create structure pages', async () => {
      autoIngest.start(tempDir);

      const filePath = join(tempDir, 'test.ts');
      await writeFile(filePath, `
function add(a: number, b: number): number {
  return a + b;
}
      `);

      // Wait for debounce + processing
      await new Promise(resolve => setTimeout(resolve, 500));

      const allPages = await store.listAll();
      const structurePages = allPages.filter(p => p.pageType === 'structure');
      expect(structurePages.length).toBeGreaterThan(0);

      await autoIngest.stop();
    });

    it('should track processed files', async () => {
      autoIngest.start(tempDir);

      const filePath1 = join(tempDir, 'test1.ts');
      const filePath2 = join(tempDir, 'test2.ts');

      await writeFile(filePath1, 'const x = 1;');
      await writeFile(filePath2, 'const y = 2;');

      // Wait for debounce + processing
      await new Promise(resolve => setTimeout(resolve, 500));

      const processedFiles = autoIngest.getProcessedFiles();
      expect(processedFiles.length).toBe(2);

      await autoIngest.stop();
    });

    it('should call onIngest callback', async () => {
      let ingestedPath: string | null = null;

      autoIngest = new AutoIngest(store, {
        debounceMs: 100,
        onIngest: (path) => {
          ingestedPath = path;
        },
      });

      autoIngest.start(tempDir);

      const filePath = join(tempDir, 'test.ts');
      await writeFile(filePath, 'const x = 1;');

      // Wait for debounce + processing
      await new Promise(resolve => setTimeout(resolve, 500));

      expect(ingestedPath).toBe(filePath);

      await autoIngest.stop();
    });

    it('should call onPageCreated callback', async () => {
      let createdPageId: string | null = null;

      autoIngest = new AutoIngest(store, {
        debounceMs: 100,
        onPageCreated: (pageId) => {
          createdPageId = pageId;
        },
      });

      autoIngest.start(tempDir);

      const filePath = join(tempDir, 'test.ts');
      await writeFile(filePath, 'function add(a: number, b: number): number { return a + b; }');

      // Wait for debounce + processing
      await new Promise(resolve => setTimeout(resolve, 500));

      expect(createdPageId).toBeDefined();

      await autoIngest.stop();
    });

    it('should debounce rapid file changes', async () => {
      autoIngest.start(tempDir);

      const filePath = join(tempDir, 'test.ts');

      // Rapid changes
      await writeFile(filePath, 'const x = 1;');
      await writeFile(filePath, 'const x = 2;');
      await writeFile(filePath, 'const x = 3;');

      // Wait for debounce + processing
      await new Promise(resolve => setTimeout(resolve, 500));

      const stats = autoIngest.getStats();
      // Should only ingest once due to debouncing
      expect(stats.filesIngested).toBe(1);

      await autoIngest.stop();
    });

    it('should ignore files matching ignore patterns', async () => {
      autoIngest = new AutoIngest(store, {
        debounceMs: 100,
        ignorePatterns: ['**/*.test.ts', 'dist/**'],
      });

      autoIngest.start(tempDir);

      const testFile = join(tempDir, 'test.test.ts');
      const normalFile = join(tempDir, 'test.ts');

      await writeFile(testFile, 'describe("test", () => {});');
      await writeFile(normalFile, 'const x = 1;');

      // Wait for debounce + processing
      await new Promise(resolve => setTimeout(resolve, 500));

      const processedFiles = autoIngest.getProcessedFiles();
      expect(processedFiles).toContain(normalFile);
      expect(processedFiles).not.toContain(testFile);

      await autoIngest.stop();
    });

    it('should handle errors gracefully', async () => {
      autoIngest.start(tempDir);

      // Try to ingest non-existent file (will be caught by watcher)
      const filePath = join(tempDir, 'nonexistent.ts');

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 200));

      const stats = autoIngest.getStats();
      // Should not crash
      expect(stats.errors).toBeGreaterThanOrEqual(0);

      await autoIngest.stop();
    });
  });
});
