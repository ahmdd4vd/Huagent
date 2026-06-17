# Huagent User Guide

**Version:** 4.3.1  
**License:** MIT  
**Providers:** 26 LLM providers (Anthropic, OpenAI, Gemini, Ollama, Groq, DeepSeek, and 20+ more)

---

## Table of Contents

1. [Installation](#installation)
2. [First Run (Onboarding)](#first-run-onboarding)
3. [Basic Usage](#basic-usage)
4. [Slash Commands](#slash-commands)
5. [Keyboard Shortcuts](#keyboard-shortcuts)
6. [Configuration](#configuration)
7. [Engine Workflow](#engine-workflow)
8. [Memory System](#memory-system)
9. [Providers](#providers)
10. [Troubleshooting](#troubleshooting)

---

## Installation

### Option 1: npm (Recommended)

```bash
npm install -g huagent
```

### Option 2: From Source

```bash
git clone https://github.com/huanime/huagent.git
cd huagent
npm install
npm link
```

### Requirements

- Node.js 18+
- npm 8+

---

## First Run (Onboarding)

When you run `huagent` for the first time, an interactive wizard will guide you through setup:

```bash
huagent
```

### Wizard Steps:

**1. Welcome Screen**
```
╔════════════════════════════════════════════════════════╗
║  ✦ huagent v4.3.1                                     ║
║  AI coding agent CLI                                   ║
║  22 providers · 101 models · MIT                       ║
╚════════════════════════════════════════════════════════╝
```

**2. Choose Provider**

Select from 26 LLM providers:
- Anthropic (Claude)
- OpenAI (GPT-4, GPT-5)
- Google Gemini
- Ollama (local models)
- Groq, DeepSeek, Perplexity
- GitHub Copilot, Azure OpenAI
- And 16+ more...

Use arrow keys to navigate, Enter to select.

**3. Enter API Key**

```
API key: ••••••••••••••••••••
```

Your API key is masked for security. It's stored in `~/.huagent/config.json`.

**4. Choose Model**

Select a model based on your provider:
- Anthropic: claude-opus-4.6, claude-sonnet-4.6, claude-haiku-4.5
- OpenAI: gpt-5.5, gpt-5, gpt-4o
- Gemini: gemini-3-pro, gemini-3-flash
- And many more...

**5. Set Effort Level**

Choose how much reasoning the agent should do:
- `low` — Quick answers, minimal planning
- `medium` — Balanced (default)
- `high` — Deep reasoning, thorough planning

### After Onboarding

Once setup is complete, you'll see the TUI (Terminal User Interface):

```
╔════════════════════════════════════════════════════════╗
║  ✦ huagent v4.3.1                                     ║
║  AI coding agent CLI                                   ║
╚════════════════════════════════════════════════════════╝

◆ Connected to 🌸 Anthropic/claude-sonnet-4.6
◆ Memory: 0 memories, 0 skills
◆ Permission: workspace-write

> _
```

You're ready to chat!

---

## Basic Usage

### Chat Mode (Interactive)

```bash
huagent
```

Type your message and press Enter:

```
> fix the login bug in auth.ts

✧ Thinking...
✧ Plan: 3 steps
✓ 1. Read auth.ts (23ms)
✓ 2. Find bug at line 42 (45ms)
✓ 3. Edit auth.ts (12ms)

✨ Score: 4.5/5 (pass)

The bug was in the password validation logic at line 42. 
I've fixed it by adding proper null checks.
```

### One-Shot Mode

For quick questions without entering the TUI:

```bash
huagent "explain what JWT is"
```

Output streams directly to terminal:

```
✧ Streaming response...

JWT (JSON Web Token) is a compact, URL-safe token format 
used for securely transmitting information between parties...

[130 tokens, $0.0002]
```

### Autonomous Mode

Skip confirmations and let the agent work autonomously:

```bash
huagent --autonomous "refactor the database module"
```

⚠️ **Warning:** Autonomous mode executes all commands without asking. Use with caution!

### Scope Mode

Limit the agent to editing a single file:

```bash
huagent --scope=src/auth.ts "fix all bugs in this file"
```

The agent will only edit `src/auth.ts` and recommend changes for other files.

---

## Slash Commands

Type `/` to see available commands:

### Session Management

| Command | Description |
|---------|-------------|
| `/help` | Show all commands |
| `/status` | Show current session status |
| `/cost` | Show token usage and cost |
| `/clear` | Clear conversation history |
| `/compact` | Compress conversation (save memory) |
| `/sessions` | List saved sessions |
| `/resume <id>` | Resume a previous session |
| `/export <file>` | Export chat to markdown |
| `/undo` | Undo last edit |
| `/diff` | Show git diff of changes |

### Model & Provider

| Command | Description |
|---------|-------------|
| `/model` | Switch model |
| `/provider` | Switch provider |
| `/providers` | List all providers |
| `/models` | List models for current provider |

### Modes & Settings

| Command | Description |
|---------|-------------|
| `/autonomous` | Toggle autonomous mode |
| `/scope <file>` | Set file scope |
| `/permissions <mode>` | Change permission mode |
| `/modes` | Show current modes |
| `/effort <level>` | Change effort level |

### Memory & Skills

| Command | Description |
|---------|-------------|
| `/memory` | Show memory stats |
| `/skills` | Show learned skills |
| `/init` | Initialize project memory |

### Other

| Command | Description |
|---------|-------------|
| `/doctor` | Run diagnostics |
| `/theme <name>` | Change theme |
| `/exit` | Exit Huagent |

### Examples

```bash
# Switch to GPT-5
/model gpt-5

# Switch to OpenAI
/provider openai

# Set autonomous mode
/autonomous

# Limit to one file
/scope src/auth.ts

# Show status
/status

# Clear conversation
/clear
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Send message / Execute command |
| `Tab` | Autocomplete slash command |
| `Ctrl+C` | Exit Huagent |
| `Ctrl+P` | Switch provider |
| `Ctrl+T` | Switch model |
| `Ctrl+E` | Set file scope |
| `Ctrl+L` | Toggle activity panel |
| `↑/↓` | Navigate suggestions |
| `Esc` | Close picker/dialog |

---

## Configuration

### Config File Location

```
~/.huagent/config.json
```

### Config Structure

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4.6",
  "apiKey": "sk-ant-...",
  "workdir": "/path/to/project",
  "permissionMode": "workspace-write",
  "onboarded": true,
  "knownProviders": ["anthropic", "openai", ...]
}
```

### Environment Variables

Override config with environment variables:

```bash
export HUAGENT_PROVIDER=anthropic
export HUAGENT_MODEL=claude-sonnet-4.6
export ANTHROPIC_API_KEY=sk-ant-...
export HUAGENT_BASE_URL=https://api.anthropic.com
export HUAGENT_EFFORT=high
```

### Permission Modes

| Mode | Description |
|------|-------------|
| `read-only` | Only read files, no writes |
| `workspace-write` | Read + write in workspace (default) |
| `danger-full-access` | Full access (⚠️ dangerous) |
| `prompt` | Ask before each action |
| `allow` | Allow everything |

Change with:

```bash
huagent --perm=workspace-write
# or
/permissions workspace-write
```

---

## Engine Workflow

Huagent uses a **6-stage workflow** for complex tasks:

```
User Message
    ↓
1. UNDERSTAND 🧠
   - Classify task type (fix, refactor, question, etc.)
   - Detect complexity (trivial, simple, moderate, complex)
   - Recall relevant memories
    ↓
2. PLAN 🗺️
   - Generate step-by-step plan
   - Identify tools needed
   - Set dependencies
    ↓
3. EXECUTE ⚡
   - Run steps sequentially or in parallel
   - Execute tools (read, write, edit, bash)
   - Feed results back to LLM
    ↓
4. VERIFY ✅
   - Critic scores result (1-5 scale)
   - Check correctness, completeness, quality
   - Verdict: pass / refine / fail
    ↓
5. REFINE 🔄
   - If verdict = "refine", re-execute failed steps
   - Max 3 iterations
    ↓
6. REFLECT 💡
   - Extract lessons learned
   - Save patterns to memory
   - Update skills
    ↓
Response
```

### Trivial Tasks

For simple questions (`complexity = trivial`), Huagent skips planning and goes straight to chat:

```
> what is JavaScript?

JavaScript is a programming language...
```

No planning, no verification — just a direct answer.

---

## Memory System

Huagent has **4 types of memory**:

### 1. Episodic Memory 📸

Stores events that happened:
```
"Yesterday, user asked to fix login bug in auth.ts.
 Bug was at line 42. Fixed by adding null check.
 Score: 4.5/5"
```

### 2. Semantic Memory 📚

Stores facts about the world:
```
"JavaScript is a programming language"
"React is a UI framework"
"PostgreSQL is a database"
```

### 3. Procedural Memory 🔧

Stores how to do things:
```
"How to fix login bug:
 1. Read auth file
 2. Find validation logic
 3. Check for null values
 4. Add proper checks
 5. Run tests"
```

### 4. Project Memory 🏠

Stores info about your project:
```
"Project uses TypeScript"
"Database is PostgreSQL"
"Testing with vitest"
```

### Memory Recall

When you ask a question, Huagent searches all 4 memory types and ranks results by:
- **Importance** (60%) — How critical is this memory?
- **Recency** (40%) — How recent? (exponential decay, 24h half-life)

### Memory Commands

```bash
# Show memory stats
/memory

# Initialize project memory
/init

# Compress conversation (save to memory)
/compact
```

---

## Providers

Huagent supports **26 LLM providers**:

### API-Based Providers

| Provider | Models | API Key Env |
|----------|--------|-------------|
| Anthropic | Claude Opus/Sonnet/Haiku | `ANTHROPIC_API_KEY` |
| OpenAI | GPT-5.5, GPT-5, GPT-4o | `OPENAI_API_KEY` |
| Google Gemini | Gemini 3 Pro/Flash | `GEMINI_API_KEY` |
| Mistral | Mistral Large, Codestral | `MISTRAL_API_KEY` |
| Groq | Llama 3.3 70B | `GROQ_API_KEY` |
| DeepSeek | DeepSeek V3, R1 | `DEEPSEEK_API_KEY` |
| Perplexity | Sonar Pro | `PERPLEXITY_API_KEY` |
| xAI (Grok) | Grok 4, Grok 3 | `XAI_API_KEY` |
| MiniMax | MiniMax M3 | `MINIMAX_API_KEY` |
| NVIDIA NIM | Llama 3.1 70B | `NVIDIA_API_KEY` |
| Cerebras | Llama 3.3 70B | `CEREBRAS_API_KEY` |
| OpenRouter | Multi-provider | `OPENROUTER_API_KEY` |
| Together | Llama 3.3 70B | `TOGETHER_API_KEY` |
| Fireworks | Llama 3.3 70B | `FIREWORKS_API_KEY` |
| HuggingFace | Llama 3.3 70B | `HF_TOKEN` |

### Cloud Providers

| Provider | Models | API Key Env |
|----------|--------|-------------|
| GitHub Copilot | GPT-4, Claude, Gemini | `GITHUB_TOKEN` |
| Azure OpenAI | GPT-4, GPT-5 | `AZURE_OPENAI_API_KEY` |
| AWS Bedrock | Claude, Llama | `AWS_BEARER_TOKEN_BEDROCK` |
| Google Vertex | Claude, Gemini | `GOOGLE_API_KEY` |

### Local Providers

| Provider | Models | API Key Env |
|----------|--------|-------------|
| Ollama | Llama, Mistral, DeepSeek | `OLLAMA_API_KEY` (optional) |

### Custom Provider

Use any OpenAI-compatible API:

```bash
export HUAGENT_PROVIDER=custom
export HUAGENT_BASE_URL=https://api.your-provider.com/v1
export TOKENROUTER_API_KEY=your-key
export HUAGENT_MODEL=your-model
```

### Switching Providers

```bash
# Via command
/provider anthropic

# Via keyboard shortcut
Ctrl+P

# Via environment variable
export HUAGENT_PROVIDER=openai
```

---

## Troubleshooting

### Issue: "No API key found"

**Solution:** Set the API key environment variable:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
# or
huagent --api-key=sk-ant-...
```

### Issue: "Provider not responding"

**Solution:** Check your internet connection and API key validity:

```bash
# Test API key
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4.6","messages":[{"role":"user","content":"hi"}]}'
```

### Issue: "Context too long"

**Solution:** Compress the conversation:

```bash
/compact
```

Or clear the conversation:

```bash
/clear
```

### Issue: "Permission denied"

**Solution:** Change permission mode:

```bash
/permissions workspace-write
# or
/permissions danger-full-access  # ⚠️ dangerous
```

### Issue: "Model not found"

**Solution:** List available models:

```bash
/models
```

Then switch to a valid model:

```bash
/model claude-sonnet-4.6
```

### Issue: "Session not saved"

**Solution:** Check disk space and permissions:

```bash
ls -la ~/.huagent/sessions/
```

### Issue: "Memory database corrupted"

**Solution:** Delete and recreate the memory database:

```bash
rm ~/.huagent/memory.db
huagent  # Will create a fresh database
```

### Issue: "TUI not rendering correctly"

**Solution:** Ensure your terminal supports Unicode and colors:

```bash
# Test Unicode
echo "✦ ✧ ✿ ♡"

# Test colors
echo "\033[38;2;255;107;157m✦ huagent\033[0m"
```

### Issue: "Slow response"

**Solution:** 
1. Use a faster model (e.g., `claude-haiku-4.5` instead of `claude-opus-4.6`)
2. Lower effort level: `/effort low`
3. Compress conversation: `/compact`

### Issue: "High cost"

**Solution:**
1. Use a cheaper model: `/model claude-haiku-4.5`
2. Lower effort level: `/effort low`
3. Monitor cost: `/cost`

---

## Advanced Usage

### Custom System Prompt

Create a `.huagent/system.md` file in your project:

```markdown
You are an expert in React and TypeScript.
Always use functional components.
Prefer hooks over classes.
```

Huagent will automatically load and use this prompt.

### Project Memory

Create a `.huagent/memory.md` file:

```markdown
# Project Facts
- Framework: React 18
- Language: TypeScript 5
- Database: PostgreSQL 15
- Testing: Vitest

# Code Style
- Use functional components
- Prefer hooks
- Use TypeScript strict mode
```

Huagent will load these facts into project memory.

### Hooks

Create custom hooks in `.huagent/hooks/`:

```javascript
// .huagent/hooks/pre-commit.js
export default async (ctx) => {
  console.log('Running pre-commit checks...');
  // Run your checks here
};
```

### Custom Tools

Create custom tools in `.huagent/tools/`:

```javascript
// .huagent/tools/my-tool.js
export default {
  name: 'my-tool',
  description: 'My custom tool',
  execute: async (args) => {
    // Tool logic here
    return { success: true };
  },
};
```

---

## Examples

### Example 1: Fix a Bug

```bash
huagent
> fix the login bug in auth.ts

✧ Plan: 3 steps
✓ 1. Read auth.ts
✓ 2. Find bug at line 42
✓ 3. Edit auth.ts

✨ Score: 4.5/5 (pass)

Fixed! The bug was in the password validation...
```

### Example 2: Refactor Code

```bash
huagent
> refactor the database module to use Prisma

✧ Plan: 5 steps
✓ 1. Read current database code
✓ 2. Install Prisma
✓ 3. Create Prisma schema
✓ 4. Migrate database
✓ 5. Update code to use Prisma

✨ Score: 4.2/5 (pass)

Refactored! The database module now uses Prisma...
```

### Example 3: Write Tests

```bash
huagent
> write tests for the auth module

✧ Plan: 4 steps
✓ 1. Read auth module
✓ 2. Identify test cases
✓ 3. Write test file
✓ 4. Run tests

✨ Score: 4.8/5 (pass)

Wrote 15 tests for the auth module. All tests pass!
```

### Example 4: Explain Code

```bash
huagent
> explain what the calculateTotal function does

This function calculates the total price including tax...
```

### Example 5: Research

```bash
huagent
> research the best authentication methods for 2026

✧ Spawning code-explorer subagent...

Based on my research, the best authentication methods for 2026 are:
1. Passkeys (WebAuthn)
2. OAuth 2.0 + PKCE
3. Magic links
...
```

---

## Support

- **GitHub:** https://github.com/huanime/huagent
- **Issues:** https://github.com/huanime/huagent/issues
- **Discussions:** https://github.com/huanime/huagent/discussions
- **Email:** support@huanime.dev

---

## License

MIT License - see [LICENSE](../LICENSE) for details.

---

## Credits

Created by **Huanime** with ❤️

Inspired by:
- Cursor
- Aider
- Claude Code
- Cline

---

**Happy coding! ✦**
