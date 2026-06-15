# Contributing to huagent

> ✦ Made with ♡ by huanime ✧  Contributions welcome!

## Ground rules

- **Quality first.** No half-baked PRs. Take the time to test, document, and polish.
- **Stay focused.** Small, atomic PRs are easier to review than mega-bundles.
- **Run `npm run verify`** before opening a PR. CI will check lint + tests + build.
- **One feature per PR.** If you're fixing two unrelated things, open two PRs.

## Development setup

```bash
git clone https://github.com/d4vdxm/huagent.git
cd huagent
npm install
npm run dev           # watch mode
npm test              # full suite (~870 tests, runs in ~12s)
npm run verify        # lint + test + build
```

## Code style

- TypeScript everywhere. `strict: true`.
- 2-space indent, single quotes, no semicolons for `{}`-only lines.
- One file per concept. Files under 300 lines if possible.
- Use the existing `theme.ts` palette — don't introduce new colors.
- Use the existing test harness (`tests/_harness.ts`) for new tests.
- Every new module needs tests. Aim for 80%+ coverage.

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

## Commit messages

```
type(scope): short summary

Body explaining the why. Reference issues with #123.
```

Types: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `style`, `perf`.

## Pull request process

1. Open an issue first if the change is non-trivial.
2. Fork + branch from `main`.
3. Run `npm run verify` — must pass.
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
- Logs (`huagent` with `--debug`)

## Feature requests

Use the [feature request template](.github/ISSUE_TEMPLATE/feature.md). Explain:
- The problem you're solving
- Your proposed solution
- Alternatives considered
- Whether you'd like to implement it yourself

## Code of conduct

Be kind. Assume good faith. No harassment, no personal attacks, no gatekeeping.

This is a small project built with love. Help us keep it that way. ✧

---

✧･ﾟ: *✧･ﾟ:*  Made with ♡ by huanime  *:･ﾟ✧*:･ﾟ✧
