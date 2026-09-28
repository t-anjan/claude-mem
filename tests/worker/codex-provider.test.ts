import { afterEach, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexObserverEnv, runCodexQuery } from '../../src/services/worker/CodexProvider.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fakeCodex(mode: string) {
  const cwd = mkdtempSync(join(tmpdir(), 'claude-mem-codex-test-'));
  directories.push(cwd);
  const executable = join(cwd, 'codex');
  const capture = join(cwd, 'capture.json');
  writeFileSync(executable, `#!/usr/bin/env node
const fs = require('node:fs');
let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  fs.writeFileSync(process.env.CAPTURE_PATH, JSON.stringify({ args: process.argv.slice(2), input, env: process.env }));
  if (process.env.MODE === 'quota') {
    console.log(JSON.stringify({ type: 'turn.failed', error: { message: 'You have hit your usage limit' } }));
    process.exit(1);
  }
  if (process.env.MODE === 'quota-prose') {
    console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: "You've hit your usage limit" } }));
    console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 12, output_tokens: 4 } }));
    return;
  }
  if (process.env.MODE === 'tool') {
    console.log(JSON.stringify({ type: 'item.started', item: { type: 'command_execution' } }));
    setTimeout(() => {}, 10000);
    return;
  }
  if (process.env.MODE === 'hang') {
    setTimeout(() => {}, 10000);
    return;
  }
  console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '<observation>ok</observation>' } }));
  console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 12, cached_input_tokens: 8, output_tokens: 4 } }));
});
`, { mode: 0o755 });
  return {
    executable,
    cwd,
    capture,
    env: { PATH: process.env.PATH, CAPTURE_PATH: capture, MODE: mode },
  };
}

it('runs an ephemeral, isolated Codex turn with role-tagged stdin and actual usage', async () => {
  const options = fakeCodex('success');
  const result = await runCodexQuery(
    [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'prior' }],
    'gpt-6-luna', undefined, options,
  );
  const captured = JSON.parse(readFileSync(options.capture, 'utf8'));
  expect(result).toMatchObject({
    content: '<observation>ok</observation>',
    inputTokens: 12,
    cachedInputTokens: 8,
    outputTokens: 4,
    tokensUsed: 16,
    servedModel: 'gpt-6-luna',
  });
  expect(captured.args).toContain('--ephemeral');
  expect(captured.args).toContain('--json');
  expect(captured.args).toContain('read-only');
  expect(captured.args).toContain('gpt-6-luna');
  expect(captured.args).toContain('forced_login_method="chatgpt"');
  expect(captured.input).toContain('"role":"assistant","content":"prior"');
  expect(captured.args.join(' ')).not.toContain('hello');
});

it('does not inherit provider or cloud credentials', () => {
  const env = codexObserverEnv({
    PATH: '/usr/bin', HOME: '/tmp/example', OPENAI_API_KEY: 'secret',
    CODEX_ACCESS_TOKEN: 'secret', AWS_ACCESS_KEY_ID: 'secret',
  });
  expect(env).toMatchObject({ PATH: '/usr/bin', HOME: '/tmp/example', CLAUDE_MEM_INTERNAL: '1' });
  expect(env.OPENAI_API_KEY).toBeUndefined();
  expect(env.CODEX_ACCESS_TOKEN).toBeUndefined();
  expect(env.AWS_ACCESS_KEY_ID).toBeUndefined();
});

it('preserves a quota refusal and rejects a tool event', async () => {
  const quota = fakeCodex('quota');
  await expect(runCodexQuery([{ role: 'user', content: 'x' }], 'gpt-6-luna', undefined, quota))
    .rejects.toMatchObject({ kind: 'quota_exhausted' });
  const quotaProse = fakeCodex('quota-prose');
  await expect(runCodexQuery([{ role: 'user', content: 'x' }], 'gpt-6-luna', undefined, quotaProse))
    .rejects.toMatchObject({ kind: 'quota_exhausted' });
  const tool = fakeCodex('tool');
  await expect(runCodexQuery([{ role: 'user', content: 'x' }], 'gpt-6-luna', undefined, tool))
    .rejects.toMatchObject({ kind: 'transient' });
});

it('kills a cancelled turn and classifies a missing CLI as setup required', async () => {
  const hanging = fakeCodex('hang');
  const controller = new AbortController();
  const pending = runCodexQuery([{ role: 'user', content: 'x' }], 'gpt-6-luna', controller.signal, hanging);
  setTimeout(() => controller.abort(), 100);
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await expect(runCodexQuery([{ role: 'user', content: 'x' }], 'gpt-6-luna', undefined, {
    executable: join(hanging.cwd, 'missing-codex'), cwd: hanging.cwd,
  })).rejects.toMatchObject({ kind: 'setup_required' });
});
