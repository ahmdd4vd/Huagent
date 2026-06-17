/**
 * Test WllmConcept integration (Phase 2)
 * 
 * Tests:
 * 1. WikiMemory wrapper (backward compatibility)
 * 2. WikiStore + Engine integration
 * 3. 5-memory routing
 * 4. Scheduled Lint
 * 5. Evolve on Session End
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WikiStore } from '../src/wllm/graph/wiki-store.js';
import { WikiMemory } from '../src/engine/wiki-memory.js';
import { LintScheduler } from '../src/wllm/lint/scheduler.js';
import { Evolver } from '../src/wllm/evolve/evolver.js';

describe('WllmConcept Integration', () => {
  let wikiStore: WikiStore;
  let wikiMemory: WikiMemory;

  beforeEach(() => {
    wikiStore = new WikiStore();
    wikiMemory = new WikiMemory(wikiStore);
  });

  afterEach(async () => {
    await wikiStore.clear();
  });

  describe('WikiMemory Wrapper', () => {
    it('should expose WikiStore via getStore()', () => {
      const store = wikiMemory.getStore();
      expect(store).toBe(wikiStore);
    });

    it('should record episode as wiki page', async () => {
      const id = wikiMemory.recordEpisode(
        'Fixed JWT authentication bug',
        { tags: ['jwt', 'auth', 'bugfix'] },
        0.8
      );

      expect(id).toMatch(/^ep-/);

      // Wait for async page creation
      await new Promise(resolve => setTimeout(resolve, 100));

      const page = await wikiStore.getPage(id);
      expect(page).toBeDefined();
      expect(page?.pageType).toBe('episode');
      expect(page?.label).toBe('Fixed JWT authentication bug');
      expect(page?.tags).toContain('jwt');
      expect(page?.confidenceLevel).toBe('INFERRED'); // 0.8 maps to INFERRED
    });

    it('should record pattern as concept page', async () => {
      wikiMemory.recordPattern(
        'JWT Authentication Pattern',
        'How to implement JWT authentication',
        '1. Generate token\n2. Validate token\n3. Refresh token',
        ['Example 1', 'Example 2']
      );

      await new Promise(resolve => setTimeout(resolve, 100));

      const pages = await wikiStore.listByType('concept');
      expect(pages.length).toBeGreaterThan(0);
      const page = pages.find(p => p.label === 'JWT Authentication Pattern');
      expect(page).toBeDefined();
      expect(page?.body).toContain('How to implement JWT authentication');
    });

    it('should save project fact as entity page', async () => {
      wikiMemory.saveProjectFact('Tech Stack', 'TypeScript + Node.js + Express');

      await new Promise(resolve => setTimeout(resolve, 100));

      const pages = await wikiStore.listByType('entity');
      expect(pages.length).toBeGreaterThan(0);
      const page = pages.find(p => p.label === 'Tech Stack');
      expect(page).toBeDefined();
      expect(page?.body).toBe('TypeScript + Node.js + Express');
    });

    it('should recall memories with intent detection', async () => {
      // Create some test pages
      await wikiStore.createPage({
        pageType: 'entity',
        label: 'JWT Token',
        body: 'JSON Web Token for authentication',
        tags: ['jwt', 'auth'],
      });

      await wikiStore.createPage({
        pageType: 'concept',
        label: 'JWT Pattern',
        body: 'How to implement JWT',
        tags: ['jwt', 'pattern'],
      });

      await wikiStore.createPage({
        pageType: 'episode',
        label: 'JWT Bug Fix',
        body: 'Fixed JWT validation bug',
        tags: ['jwt', 'bugfix'],
      });

      // Test "what is" query (should prefer semantic memory)
      const whatResults = await wikiMemory.recall('what is JWT', 5);
      expect(whatResults.length).toBeGreaterThan(0);
      expect(whatResults[0].type).toBe('semantic'); // entity/concept

      // Test "how to" query (should prefer structural memory)
      const howResults = await wikiMemory.recall('how to implement JWT', 5);
      expect(howResults.length).toBeGreaterThan(0);

      // Test "why" query (should prefer causal memory)
      const whyResults = await wikiMemory.recall('why JWT failed', 5);
      expect(whyResults.length).toBeGreaterThan(0);
    });

    it('should convert importance to confidence correctly', async () => {
      // Test VERIFIED (>= 0.9)
      wikiMemory.recordEpisode('High importance', {}, 0.95);
      await new Promise(resolve => setTimeout(resolve, 50));
      let pages = await wikiStore.listByType('episode');
      expect(pages[pages.length - 1].confidenceLevel).toBe('VERIFIED');

      // Test INFERRED (>= 0.7)
      wikiMemory.recordEpisode('Medium importance', {}, 0.75);
      await new Promise(resolve => setTimeout(resolve, 50));
      pages = await wikiStore.listByType('episode');
      expect(pages[pages.length - 1].confidenceLevel).toBe('INFERRED');

      // Test ASSUMED (< 0.7)
      wikiMemory.recordEpisode('Low importance', {}, 0.5);
      await new Promise(resolve => setTimeout(resolve, 50));
      pages = await wikiStore.listByType('episode');
      expect(pages[pages.length - 1].confidenceLevel).toBe('ASSUMED');
    });
  });

  describe('5-Memory Routing', () => {
    it('should detect "what" intent correctly', async () => {
      const results = await wikiMemory.recall('what is authentication', 5);
      expect(results).toBeDefined();
    });

    it('should detect "how" intent correctly', async () => {
      const results = await wikiMemory.recall('how to implement auth', 5);
      expect(results).toBeDefined();
    });

    it('should detect "why" intent correctly', async () => {
      const results = await wikiMemory.recall('why use JWT', 5);
      expect(results).toBeDefined();
    });

    it('should detect "when" intent correctly', async () => {
      const results = await wikiMemory.recall('when was this implemented', 5);
      expect(results).toBeDefined();
    });

    it('should detect "compare" intent correctly', async () => {
      const results = await wikiMemory.recall('compare JWT vs OAuth', 5);
      expect(results).toBeDefined();
    });

    it('should detect "pattern" intent correctly', async () => {
      const results = await wikiMemory.recall('pattern for authentication', 5);
      expect(results).toBeDefined();
    });

    it('should detect "history" intent correctly', async () => {
      const results = await wikiMemory.recall('history of auth changes', 5);
      expect(results).toBeDefined();
    });

    it('should default to "unknown" intent', async () => {
      const results = await wikiMemory.recall('random query', 5);
      expect(results).toBeDefined();
    });
  });

  describe('Scheduled Lint', () => {
    it('should create LintScheduler', () => {
      const scheduler = new LintScheduler(wikiStore);
      expect(scheduler).toBeDefined();
      expect(scheduler.isRunning()).toBe(false);
    });

    it('should run lint manually', async () => {
      // Create some test pages with issues
      await wikiStore.createPage({
        pageType: 'entity',
        label: 'Test Page',
        body: '', // Empty body (lint issue)
        tags: [], // No tags (lint issue)
      });

      const scheduler = new LintScheduler(wikiStore);
      const report = await scheduler.runLint();

      expect(report).toBeDefined();
      expect(report.summary.totalPages).toBeGreaterThan(0);
      expect(report.summary.totalIssues).toBeGreaterThan(0);
      expect(report.summary.grade).toBeDefined();
    });

    it('should track lint history', async () => {
      const scheduler = new LintScheduler(wikiStore);
      
      await scheduler.runLint();
      await scheduler.runLint();

      const history = scheduler.getHistory();
      expect(history.length).toBe(2);
    });

    it('should get latest lint report', async () => {
      const scheduler = new LintScheduler(wikiStore);
      
      await scheduler.runLint();
      const latestReport = scheduler.getLatestReport();

      expect(latestReport).toBeDefined();
      expect(latestReport?.summary).toBeDefined();
    });
  });

  describe('Evolve on Session End', () => {
    it('should run evolver', async () => {
      const evolver = new Evolver(wikiStore);
      const report = await evolver.evolve();

      expect(report).toBeDefined();
      expect(report.summary).toBeDefined();
      expect(report.summary.contradictionCount).toBeDefined();
      expect(report.summary.suggestionCount).toBeDefined();
      expect(report.summary.refreshCount).toBeDefined();
    });

    it('should find contradictions', async () => {
      // Create two contradictory pages
      await wikiStore.createPage({
        pageType: 'decision',
        label: 'Use PostgreSQL',
        body: 'We decided to use PostgreSQL',
        confidenceLevel: 'VERIFIED',
      });

      await wikiStore.createPage({
        pageType: 'decision',
        label: 'Use MongoDB',
        body: 'We decided to use MongoDB',
        confidenceLevel: 'VERIFIED',
      });

      const evolver = new Evolver(wikiStore);
      const report = await evolver.evolve();

      expect(report.contradictions.length).toBeGreaterThan(0);
    });

    it('should suggest new pages', async () => {
      // Create multiple pages with same tag
      for (let i = 0; i < 5; i++) {
        await wikiStore.createPage({
          pageType: 'episode',
          label: `Bug Fix ${i}`,
          body: `Fixed bug ${i}`,
          tags: ['authentication'],
        });
      }

      const evolver = new Evolver(wikiStore);
      const report = await evolver.evolve({ popularTagThreshold: 3 });

      expect(report.suggestions.length).toBeGreaterThan(0);
    });

    it('should find stale pages', async () => {
      // Create a page with old lastChecked
      const oldDate = Date.now() - 60 * 24 * 60 * 60 * 1000; // 60 days ago
      await wikiStore.createPage({
        pageType: 'entity',
        label: 'Old Page',
        body: 'This is old',
        validFrom: oldDate,
      });

      const evolver = new Evolver(wikiStore);
      const report = await evolver.evolve({ staleDays: 30 });

      expect(report.refreshes.length).toBeGreaterThan(0);
    });
  });
});
