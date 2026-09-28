import { afterEach, expect, it } from 'bun:test';
import { SessionRoutes } from '../../src/services/worker/http/routes/SessionRoutes.js';
import { ClassifiedProviderError } from '../../src/services/worker/provider-errors.js';
import { clearDependencyStatus, getDependencyStatus } from '../../src/shared/dependency-health.js';
import type { ActiveSession } from '../../src/services/worker-types.js';

const originalProvider = process.env.CLAUDE_MEM_PROVIDER;

afterEach(() => {
  if (originalProvider === undefined) delete process.env.CLAUDE_MEM_PROVIDER;
  else process.env.CLAUDE_MEM_PROVIDER = originalProvider;
  clearDependencyStatus('codex_cli');
});

it('withholds repeat Codex starts after a missing CLI without falling back to Claude', async () => {
  process.env.CLAUDE_MEM_PROVIDER = 'codex';
  const session = {
    sessionDbId: 42,
    abortController: new AbortController(),
    generatorPromise: null,
    conversationHistory: [],
    currentProvider: null,
    lastGeneratorActivity: Date.now(),
  } as unknown as ActiveSession;
  let codexStarts = 0;
  let claudeStarts = 0;
  const manager = {
    getSession: () => session,
    getMessageBuffer: () => ({ getPendingCount: () => 1, peekTypes: () => [] }),
  };
  const routes = new SessionRoutes(
    manager as never,
    {} as never,
    { startSession: async () => { claudeStarts++; } } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { startSession: async () => {
      codexStarts++;
      session.abortReason = 'auth:setup_required';
      session.abortController.abort();
      throw new ClassifiedProviderError('Codex CLI not found', {
        kind: 'setup_required',
        cause: new Error('ENOENT'),
      });
    } } as never,
  );

  await routes.ensureGeneratorRunning(42, 'observation');
  await session.generatorPromise;
  expect(getDependencyStatus('codex_cli')?.kind).toBe('setup_required');
  expect(session.abortReason).toBeNull();

  await routes.ensureGeneratorRunning(42, 'observation');
  expect(codexStarts).toBe(1);
  expect(claudeStarts).toBe(0);
});
