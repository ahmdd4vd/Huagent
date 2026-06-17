/**
 * Security regression tests for the critical bug fixes.
 *
 * Each test verifies that a previously-vulnerable code path is now
 * safe, so we don't regress when refactoring.
 */

import { describe, it, expect } from 'vitest';
import { ConversationCache } from '../src/cache.js';
import { resetDialogController, getDialogController } from '../src/tui/dialog-controller.js';
import { validateFetchUrl } from '../src/tools/web.js';

describe('Security — session id path traversal', () => {
  it('SessionManager.getSessionPath rejects path-traversal ids', async () => {
    const { SessionManager } = await import('../src/sessions.js');
    const sm = new SessionManager('/tmp/huagent-test-sessions');
    const maliciousIds = [
      '../../etc/passwd',
      '..\\..\\windows\\system32',
      'foo/../../bar',
      'foo/bar',
      'a:b',
      'a;b',
      'a b',
    ];
    for (const id of maliciousIds) {
      expect(() => (sm as any).getSessionPath(id)).toThrow(/Invalid session id/);
    }
  });

  it('SessionManager.getSessionPath accepts valid ids', async () => {
    const { SessionManager } = await import('../src/sessions.js');
    const sm = new SessionManager('/tmp/huagent-test-sessions');
    const validIds = ['abc123', 'session-1', 'sess_2', 'A-B-C_123'];
    for (const id of validIds) {
      const p = (sm as any).getSessionPath(id);
      expect(p).toContain(id);
      expect(p.endsWith(`${id}.json`)).toBe(true);
    }
  });
});

describe('Security — SSRF protection in web tool', () => {
  it('blocks file:// scheme', () => {
    expect(validateFetchUrl('file:///etc/passwd')).toMatch(/Blocked scheme/);
  });

  it('blocks gopher:// scheme', () => {
    expect(validateFetchUrl('gopher://localhost/')).toMatch(/Blocked scheme/);
  });

  it('blocks localhost hostname', () => {
    expect(validateFetchUrl('http://localhost/')).toMatch(/Blocked internal hostname/);
  });

  it('blocks 127.0.0.1 loopback', () => {
    expect(validateFetchUrl('http://127.0.0.1/')).toMatch(/Blocked loopback/);
  });

  it('blocks 169.254.169.254 cloud metadata', () => {
    expect(validateFetchUrl('http://169.254.169.254/latest/meta-data/')).toMatch(/Blocked link-local/);
  });

  it('blocks 10.x private range', () => {
    expect(validateFetchUrl('http://10.0.0.1/')).toMatch(/Blocked private/);
  });

  it('blocks 192.168.x private range', () => {
    expect(validateFetchUrl('http://192.168.1.1/')).toMatch(/Blocked private/);
  });

  it('blocks 172.16-31 private range', () => {
    expect(validateFetchUrl('http://172.16.0.1/')).toMatch(/Blocked private/);
    expect(validateFetchUrl('http://172.31.255.255/')).toMatch(/Blocked private/);
  });

  it('blocks IPv6 loopback ::1', () => {
    expect(validateFetchUrl('http://[::1]/')).toMatch(/Blocked IPv6 loopback/);
  });

  it('blocks IPv6 link-local fe80::', () => {
    expect(validateFetchUrl('http://[fe80::1]/')).toMatch(/Blocked IPv6 link-local/);
  });

  it('allows valid public HTTPS URLs', () => {
    expect(validateFetchUrl('https://example.com/')).toBeNull();
    expect(validateFetchUrl('https://api.anthropic.com/v1/messages')).toBeNull();
  });

  it('allows valid public HTTP URLs', () => {
    expect(validateFetchUrl('http://example.com/')).toBeNull();
  });

  it('rejects malformed URLs', () => {
    expect(validateFetchUrl('not a url')).toMatch(/Invalid URL/);
    expect(validateFetchUrl('')).toMatch(/Invalid URL/);
  });
});

describe('Security — /export path traversal', () => {
  it('rejects filenames with path separators', async () => {
    const { executeSlashCommand } = await import('../src/slash-commands.js');
    const ctx: any = {
      messages: [],
      llm: {},
      memory: {},
      tools: {},
      sessions: {},
      workdir: '/tmp',
      config: {},
    };
    const result = await executeSlashCommand('export', ['../../etc/passwd'], ctx);
    expect(result.handled).toBe(true);
    expect(result.message).toMatch(/Invalid filename|path separator/);
  });

  it('rejects filenames with ".." parent references', async () => {
    const { executeSlashCommand } = await import('../src/slash-commands.js');
    const ctx: any = {
      messages: [],
      llm: {},
      memory: {},
      tools: {},
      sessions: {},
      workdir: '/tmp',
      config: {},
    };
    const result = await executeSlashCommand('export', ['..\\..\\windows\\system32'], ctx);
    expect(result.handled).toBe(true);
    expect(result.message).toMatch(/Invalid filename|path separator/);
  });

  it('accepts plain filenames without path separators', async () => {
    const { executeSlashCommand } = await import('../src/slash-commands.js');
    const ctx: any = {
      messages: [],
      llm: {},
      memory: {},
      tools: {},
      sessions: {},
      workdir: '/tmp',
      config: {},
    };
    // Use a filename that won't actually be written (no messages = empty file).
    // We just verify the validation passes — the write succeeds.
    const result = await executeSlashCommand('export', ['huagent-test-export.md'], ctx);
    expect(result.handled).toBe(true);
    // Should NOT contain the validation error.
    expect(result.message).not.toMatch(/Invalid filename|Refusing to write/);
    // Should contain "Exported to".
    expect(result.message).toMatch(/Exported to/);
    // Cleanup.
    const { unlink } = await import('node:fs/promises');
    try { await unlink('/tmp/huagent-test-export.md'); } catch {}
  });
});

describe('Correctness — ConversationCache LRU', () => {
  it('updates LRU position on overwrite (was broken before fix)', () => {
    const cache = new ConversationCache<string>({ maxSize: 2, ttlMs: 60_000 });
    cache.set('a', '1');
    cache.set('b', '2');
    // Touch 'a' again — should move it to most-recently-used.
    cache.set('a', '1-updated');
    // Add 'c' — should evict 'b' (LRU), NOT 'a'.
    cache.set('c', '3');
    expect(cache.has('a')).toBe(true);  // 'a' should survive (was just updated)
    expect(cache.has('b')).toBe(false); // 'b' should be evicted
    expect(cache.has('c')).toBe(true);
  });

  it('has() does not update hit/miss stats', () => {
    const cache = new ConversationCache<string>({ maxSize: 10, ttlMs: 60_000 });
    cache.set('x', '1');
    // Call has() multiple times — should not increment hits.
    cache.has('x');
    cache.has('x');
    cache.has('x');
    const stats = cache.stats();
    expect(stats.hits).toBe(0);  // has() doesn't count as a hit
  });

  it('has() returns false for expired entries without throwing', () => {
    const cache = new ConversationCache<string>({ maxSize: 10, ttlMs: 1 });
    cache.set('x', '1', 1);  // 1ms TTL
    // Wait for expiry.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(cache.has('x')).toBe(false);
        resolve();
      }, 10);
    });
  });
});

describe('Correctness — dialog controller rejects pending on reset', () => {
  it('pending question is resolved with [] when reset', async () => {
    const dc = getDialogController();
    const promise = dc.askUser({ questions: [{ question: 'q?', header: 'h', options: [] }] });
    // Reset should reject the pending promise with [].
    resetDialogController();
    const answer = await promise;
    expect(answer).toEqual([]);
  });

  it('pending permission is resolved with deny when reset', async () => {
    const dc = getDialogController();
    const promise = dc.requestPermission({ tool: 'bash', args: { command: 'ls' }, preview: '', reason: '' });
    resetDialogController();
    const decision = await promise;
    expect(decision).toBe('deny');
  });

  it('pending plan is resolved with reject when reset', async () => {
    const dc = getDialogController();
    const promise = dc.reviewPlan({ goal: 'g', steps: [], taskType: 'unknown', complexity: 'trivial', refinements: 0 } as any);
    resetDialogController();
    const verdict = await promise;
    expect(verdict).toBe('reject');
  });
});

describe('Correctness — memory store limit:0 respected', () => {
  it('search with limit:0 returns 0 results (was returning 10 before fix)', async () => {
    const { MemoryStore } = await import('../src/memory/store.js');
    const store = new MemoryStore('/tmp/huagent-test-memory-limit0.db');
    store.save({ type: 'episodic', content: 'hello world', importance: 0.5, metadata: {} });
    store.save({ type: 'episodic', content: 'another memory', importance: 0.5, metadata: {} });
    const results = store.search('hello', { limit: 0 });
    expect(results.length).toBe(0);
    store.close();
    const { unlink } = await import('node:fs/promises');
    try { await unlink('/tmp/huagent-test-memory-limit0.db'); } catch {}
  });
});
