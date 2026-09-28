# Codex observer provider: design and execution plan

## Goal

Let a user who is signed in to Codex select `codex` as Claude-Mem's observation generator, with `gpt-6-luna` as the default model. Keep capture, prompt construction, parsing, storage, and quota preservation on the existing worker path. Selection must never silently fall back to Claude when Codex is unavailable.

## Design

The worker's existing `OpenAICompatibleProvider` owns the observation lifecycle even though Codex is a CLI, not an HTTP chat-completions endpoint. Rename that shared class only if needed for clarity; avoid copying its loop. A `CodexProvider` supplies a query method that runs `codex exec` directly with JSONL output, feeds the prior bounded conversation as role-tagged stdin, and returns only a completed final agent message and reported usage. Each query is ephemeral, so observer sessions do not appear in the user's Codex history or get recaptured by transcript ingestion. The existing conversation recycle budget bounds replay; a small live fixture must measure its cost before processing a backlog.

Spawn with an argument array, using the repository's existing Codex command resolver for Windows shims and macOS app bundles. Use a Claude-Mem-owned working directory and `--skip-git-repo-check`, `--sandbox read-only`, `--ignore-user-config`, `--ignore-rules`, `--disable hooks`, `--disable plugins`, `--disable shell_tool`, `--disable unified_exec`, `--disable browser_use`, `--disable computer_use`, `--disable view_image`, `--disable multi_agent`, `-c web_search="disabled"`, `-c forced_login_method="chatgpt"`, `-c model_reasoning_effort="low"`, `--ephemeral`, and `--json`. Pass a narrow environment allowlist for CLI discovery, ChatGPT credential storage, and networking; never pass API-key or cloud-identity overrides. It receives JSON-encoded role/content history on stdin, never as shell arguments. Reject and abort any tool event before storing an answer. These controls limit the observer, but Codex CLI has no verified disable-all-tools contract, and a tool may execute before its event is rejected. A live canary can detect tool events and measure usage, but cannot prove that future turns are tool-free. No observer output, transcript, credentials, or raw provider errors go to routine logs.

The provider has no API key. Replace the shared base class's API-key-specific readiness check with a provider readiness method; Gemini and OpenRouter retain their existing checks. Pass the active session's AbortSignal into init, observation, and summary queries, and combine it with the field compressor's deadline signal, so a stopped generator kills its child promptly. Bound wall time and JSONL/stderr bytes. Classify every empty answer, failed turn, nonzero exit, malformed output, missing executable, or quota/auth refusal into a preserving exit before the shared handler sees it; a quota refusal also arms the existing provider-scoped breaker. The optional Telegram wrapup path must obey that same breaker. Use the Codex model for summaries even when the global Claude summary tier is configured. Report input/output usage from Codex rather than the shared 70/30 estimate. Do not switch to Claude automatically.

Expose `codex` in the provider setting and viewer, plus `CLAUDE_MEM_CODEX_MODEL` defaulting to `gpt-6-luna`. This is a worker observer provider only; hosted server generation and installer onboarding are outside the first change.

## Execution plan

1. Refactor the shared observer lifecycle minimally for provider readiness and AbortSignal propagation. Prove Gemini and OpenRouter behavior stays intact with focused tests.
2. Add the Codex CLI adapter and a fake-executable contract test for argv isolation, stdin history, JSONL completion/usage, cancellation, bounded output, and quota/setup failure preservation. Do not invoke paid inference in automated tests.
3. Wire opt-in provider selection, quota breaker identity, worker construction, settings validation/defaults, and viewer selection. Verify selecting Codex never dispatches Claude, including when `codex` is missing.
4. Build and run focused checks, then have an independent reviewer challenge security, data loss, cost, and contribution fit. Repair consequential findings.
5. If quota is clear, run one bounded live observation against an isolated fixture, inspect tool events, usage, and output, and stop before any backlog drain. A failed safety or cost canary leaves the local worker on its current provider. Preserve the committed branch on the `t-anjan` fork whether or not upstream accepts a PR.

## Canary result and activation gate

One isolated `gpt-6-luna` CLI call returned `OK` in 6.8 seconds with 13,687 reported input tokens and 5 output tokens for a tiny user prompt. That total includes an unknown cached share because the first canary did not record the CLI's `cached_input_tokens` field. It does not establish paid cost or quota impact. [Codex issue #46975](https://github.com/openai/codex/issues/46975) also reports possible WebSocket startup token use outside `turn.completed`; that report does not prove account quota charging. Do not switch the running Claude-Mem worker or drain its backlog until measured uncached and cached input, actual quota impact, and tool behavior make this viable for repeated observations.

## Contribution route

Current upstream development guidance accepts fork PRs, while its branch guide says new integrations target `community-edge`. That branch currently trails `main` substantially, so this work starts from current `main`; ask maintainers where they want the focused patch before opening a PR. The existing fork is retained and its `main` history was merged forward without a force push. No CLA or contributor-only PR gate was found in current public guidance; upstream acceptance remains a maintainer decision.
