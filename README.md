# agent-kit

Multi-model CLI agent framework. Configure `.agent/config.toml` and go.

## Quick Start

```bash
# Install globally
npm install -g agent-kit

# Or add to your project
npm install agent-kit
```

In your project root, create `.agent/config.toml`:

```toml
defaultModel = "default"

[models.default]
name          = "gpt-4o-mini"
baseUrl       = "https://api.openai.com/v1"
temperature   = 0.7
contextWindow = 128000
```

Set your API key:

```bash
export API_KEY=sk-your-key-here
```

Run:

```bash
# Interactive chat
agent-kit chat

# Single-shot
agent-kit ask "Explain this codebase"

# Or via npx
npx agent-kit chat
```

## Features

- **Multi-model LLM** — OpenAI, Anthropic, custom endpoints; model registry with role-based routing
- **Plugin system** — Tools, loaders, prompt modules, workflows, UI slots
- **Tool system** — Bash, file ops, grep, glob with Zod schema validation
- **Context management** — 3-layer compression, token tracking, cognitive recall
- **Permission engine** — 7-layer decision tree, safety rules, session approval memory
- **Plan system** — LLM-driven step-by-step planning with DAG dependencies
- **Subagent DAG** — Parallel task execution with isolated contexts
- **Sandbox** — OS-native (macOS Seatbelt / Linux bubblewrap) + Docker isolation
- **MCP** — Dynamic tool extension via Model Context Protocol servers
- **Skills** — On-demand SKILL.md instruction loading
- **Scaffold** — Generate agent/workflow/subagent prompt templates
- **UI** — React + Ink terminal interface with slot-based plugin rendering

## Configuration

All configuration lives in `.agent/config.toml`. See the [full guide](docs/guide.md) for details.

```toml
defaultModel = "default"
approval     = "confirm"   # auto | confirm | deny
maxTurns     = 0           # 0 = unlimited

[models.default]
name          = "gpt-4o-mini"
baseUrl       = "https://api.openai.com/v1"
temperature   = 0.7
contextWindow = 128000

[models.claude]
name     = "claude-sonnet-4-20250514"
provider = "anthropic"

[modelBindings]
compaction = "default"
subagent   = "default"

[sandbox]
enabled    = true
permissions = "auto-allow"
```

### Environment Variables

API keys can be set via environment variables (recommended over config file):

| Variable | Description |
|---|---|
| `API_KEY` | Global fallback API key |
| `BASE_URL` | Global fallback base URL |
| `MODEL_<NAME>_API_KEY` | Per-profile API key (e.g. `MODEL_DEFAULT_API_KEY`) |
| `MODEL_<NAME>_BASE_URL` | Per-profile base URL |

## Programmatic Usage

```typescript
import { Agent, LLMClient, ModelRegistry, ToolRegistry, PromptEngine } from "agent-kit";

const registry = new ModelRegistry(models, bindings, "default");
const llm = new LLMClient(registry);
const tools = new ToolRegistry();
const agent = new Agent(config, llm, tools);

for await (const event of agent.run("Hello")) {
  // handle AgentEvent stream
}
```

## Project Structure

```
.agent/
  config.toml          # Agent configuration
  mcp.json             # MCP server definitions
  skills/              # SKILL.md files
  plans/               # Persisted plan state (runtime)
  transcripts/         # Session logs (runtime)
src/
  kernel/              # Agent loop, events, errors
  tool/                # Tool system + builtins
  provider/            # LLM adapters, model registry, cost tracking
  context/             # Message store, compression, recall
  permission/          # Permission engine, safety rules
  prompt/              # Prompt engine + modules
  planner/             # Plan generation + execution
  subagent/            # DAG scheduler, background tasks
  sandbox/             # OS-native + Docker sandbox
  mcp/                 # Model Context Protocol client
  skill/               # Skill loader
  scaffold/            # Template generator
  plugin/              # Plugin system
  loader/              # Resource loaders
  workflow/            # Workflow orchestration
  ui/                  # React + Ink terminal UI
```

## License

MIT
