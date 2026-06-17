# Contributing to Huagent

> Contributions welcome! Huagent is built with love and we want to keep it that way.

## Ground rules

- **Quality first.** No half-baked PRs. Take the time to test, document, and polish.
- **Stay focused.** Small, atomic PRs are easier to review than mega-bundles.
- **Run `npm run verify`** before opening a PR. CI will check lint + tests + build.
- **One feature per PR.** If you're fixing two unrelated things, open two PRs.
- **Security first.** If your change touches tools, permissions, or network code, review the [Security policy](../SECURITY.md).

## Development setup

```bash
git clone https://github.com/ahmdd4vd/Huagent.git
cd Huagent
npm install
npm run dev           # watch mode (auto-rebuild on save)
npm test              # full suite (239 tests, runs in ~20s)
npm run verify        # lint + test + build (must pass before PR)
```

### Requirements

- **Node.js >= 18** (tested on 18, 20, 22)
- **npm >= 9**
- **git**
- A terminal that supports raw mode (for TUI testing)

## Code style

- TypeScript everywhere. `strict: true`.
- 2-space indent, single quotes, no semicolons for `{}`-only lines.
- One file per concept. Files under 300 lines if possible.
- Use the existing `src/tui/oc/theme.ts` palette — don't introduce new colors.
- Use `ink-testing-library` for TUI component tests (see `tests/oc-tui-render.test.tsx`).
- Every new module needs tests. Aim for 80%+ coverage.
- No `any` types unless interfacing with external untyped code.

### TUI components

New TUI components go in `src/tui/oc/` and follow the OpenCode-inspired design:
- Use the shared `useSpinnerFrame` hook from `useSpinner.ts`
- Use `LeftBorder` for prompts, `RoundedBorder` for dialogs
- Match the 12-step grayscale palette from `theme.ts`
- Add keyboard handlers via `useInput` (see `Prompt.tsx` for the full pattern)
- Test with `ink-testing-library` — see `tests/oc-keyboard.test.tsx` for patterns

## Slash commands

Adding a new slash command? Update:
1. `src/slash-commands.ts` — add to `SLASH_COMMANDS` + add a `case` in `executeSlashCommand`
2. `tests/cli-commands.test.ts` — add a test in the appropriate section
3. `README.md` — add to the commands table

## Provider / model additions

Adding a new provider? Update:
1. `src/providers/registry.ts` — add to `ProviderId` type + `PROVIDERS` + `detectProviderFromEnv`
2. `src/providers/models.ts` — add to `MODELS` (at least one model)
3. `tests/test-providers.ts` — verify integrity tests cover it
4. `README.md` — add to provider list

## Security-related changes

If your PR touches any of these areas, add a note in the PR description:
- `tools/` — bash, web, grep, edit, write, read (shell injection, SSRF, path traversal)
- `permissions.ts` — permission mode logic (default-deny vs default-allow)
- `sessions.ts` — session id validation (path traversal)
- `hooks.ts` — hook script execution (command injection)
- `providers/` — API key handling, OAuth, proxy configuration

See [SECURITY.md](../SECURITY.md) for the full threat model.

## Commit messages

```
type(scope): short summary

Body explaining the why. Reference issues with #123.
```

Types: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `style`, `perf`.

Examples:
```
feat(tui): add Ctrl+K command palette shortcut
fix(providers): flush OpenAI tool calls on stream end
fix(security): block SSRF via private IP ranges in web tool
docs(readme): update install instructions for npm
```

## Pull request process

1. Open an issue first if the change is non-trivial.
2. Fork + branch from `main`.
3. Run `npm run verify` — must pass (lint + 239 tests + build).
4. Add tests for new functionality.
5. Update CHANGELOG.md under "Unreleased".
6. Open the PR. Reference the issue.
7. Address review feedback promptly.
8. Squash-merge when approved.

## Reporting bugs

Use the [bug report template](.github/ISSUE_TEMPLATE/bug.md). Include:
- huagent version (`huagent --version`)
- Node version (`node -v`)
- OS / terminal
- Repro steps
- Expected vs actual
- Logs (run with `HUAGENT_DEBUG=1` for verbose output)

## Feature requests

Use the [feature request template](.github/ISSUE_TEMPLATE/feature.md). Explain:
- The problem you're solving
- Your proposed solution
- Alternatives considered
- Whether you'd like to implement it yourself

## Code of conduct

Be kind. Assume good faith. No harassment, no personal attacks, no gatekeeping.

This is a small project built with love. Help us keep it that way.

---

— © 2026 huanime
