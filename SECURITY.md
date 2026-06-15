# Security policy

## Supported versions

| Version | Supported          |
|---------|--------------------|
| 4.0.x   | ✅ Active          |
| 3.0.x   | ⚠️ Security-only   |
| 2.0.x   | ❌ End of life     |
| 1.0.x   | ❌ End of life     |

## Reporting a vulnerability

**Please don't open a public issue for security bugs.**

Email: `huanime@users.noreply.github.com` (replace with your actual contact)

Or use GitHub's private vulnerability reporting:
https://github.com/d4vdxm/huagent/security/advisories/new

Include:
1. Description of the vulnerability
2. Steps to reproduce
3. Affected versions
4. Your assessment of impact

We aim to respond within **48 hours** and patch critical issues within **7 days**.

## Security model

huagent executes shell commands and reads/writes files in your working directory. **You are responsible for the workspace you point it at.**

The agent has 5 permission modes (see `/permissions`):

- `read-only` — safest, no side effects
- `workspace-write` — recommended, edits stay in your project
- `sandboxed` — edits go to a temp dir
- `danger-full-access` — no confirmations, use with care
- `custom` — your own ruleset

Bash commands are classified by risk:
- **Low** — `ls`, `cat`, `grep`, `pwd`
- **Medium** — `git status`, `npm test`, `mkdir`
- **High** — `rm`, `mv`, `npm install`
- **Critical** — `rm -rf /`, `curl | sh`, `sudo`, `chmod 777`

Critical commands always require explicit confirmation, regardless of permission mode.

## Best practices

1. **Start in `workspace-write`** mode. Switch to `danger-full-access` only when you trust the agent.
2. **Don't run as root** unless you know what you're doing.
3. **Review every write** when in `read-only` mode, then approve.
4. **Use `--scope <file>`** to limit edits to a single file for refactors.
5. **Inspect `/doctor`** output if anything looks off.
6. **Keep your API keys out of git** — use env vars, never hardcode.
7. **Pin versions** in CI: `huagent@4.0.0`, not `huagent@latest`.

## Threat model

huagent does NOT protect against:
- A malicious or compromised LLM (use trusted providers)
- API key leakage via prompts (the agent may see key names, never the values)
- Local privilege escalation (use OS-level sandboxing)
- Network exfiltration (the agent can call any URL via bash)
- Supply-chain attacks on npm dependencies (`npm audit` recommended)

huagent DOES protect against:
- Accidental `rm -rf` (asks confirmation)
- Out-of-workspace writes (workspace-write mode)
- Runaway loops (per-step timeouts)
- Silent failures (Discipline layer forces verification)

## Dependencies

We pin all dependencies in `package-lock.json` and run `npm audit` in CI. See [SECURITY.md](SECURITY.md) for the full audit policy.

---

— © 2026 huanime
