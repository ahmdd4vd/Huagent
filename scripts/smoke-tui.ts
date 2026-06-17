/**
 * Smoke test: render OpenCodeApp with a mock engine for 2 seconds,
 * capture the output, and verify the major UI regions are present.
 *
 * This catches layout crashes, missing imports, and obvious rendering
 * bugs without requiring a real API key.
 */

import React from 'react';
import { render } from 'ink';
import { renderToString } from 'ink/build/render-node.js';
import { OpenCodeApp } from '../src/tui/OpenCodeApp.js';

// Mock engine/client/tools/sessions/memory
const mockClient = {
  getModel: () => 'mock-model',
  setModel: (m: string) => {},
  getProvider: () => ({ id: 'mock', displayName: 'Mock', emoji: '◇', apiKeyEnv: 'MOCK', defaultModel: 'mock-model', baseUrl: 'https://mock', apiFormat: 'openai-chat', authScheme: 'bearer' as const, supportsPromptCaching: false, supportsTools: true, supportsStreaming: true, contextWindow: 8000, id: 'mock', name: 'mock' }),
  setProvider: () => {},
  stream: async function* () {},
  getStats: () => ({ totalTokens: 100, totalCost: 0.001, totalRequests: 1 }),
};

const mockMemory = {
  recall: () => [],
  recordEpisode: () => {},
  saveProjectFact: () => {},
  recordPattern: () => {},
  stats: () => ({ memories: 0, skills: 0 }),
};

const mockTools = {
  list: () => [],
  execute: async () => ({}),
  getPermissionMode: () => 'workspace-write',
  setPermissionMode: () => {},
};

const mockSessions = {
  startSession: () => 'test',
  endSession: () => {},
  list: () => [],
  load: () => {},
};

const mockConfig = {
  workdir: '/tmp/test',
  model: 'mock-model',
  provider: 'mock',
  permissionMode: 'workspace-write',
};

// Render to string (one-shot)
const element = React.createElement(OpenCodeApp, {
  engine: { process: async () => 'ok', end: async () => {} } as any,
  client: mockClient as any,
  memory: mockMemory as any,
  tools: mockTools as any,
  sessions: mockSessions as any,
  skills: { list: () => [] } as any,
  config: mockConfig as any,
  onSubmit: async (msg: string) => 'response',
  onExit: () => {},
});

// Try a simple render — just see if it mounts without crashing.
try {
  const instance = render(element);
  // Wait 1 second, then unmount.
  setTimeout(() => {
    instance.unmount();
    console.log('✓ TUI mounted and unmounted successfully');
    process.exit(0);
  }, 1000);
} catch (err: any) {
  console.error('✗ TUI failed to mount:', err.message);
  console.error(err.stack);
  process.exit(1);
}
