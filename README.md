# Forge

**Pipeline-oriented agent orchestration CLI — from GitHub Issues to merged PRs.**

<!-- badges -->
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)

---

## What is Forge?

Forge is a CLI tool that turns vague GitHub Issues into merged pull requests through a structured pipeline powered by AI agents. Instead of copy-pasting issue descriptions into agent prompts and hoping for the best, Forge walks each feature through a repeatable sequence: requirements refinement, technical specification, task decomposition, parallel agent execution, and automated merge assembly.

The pipeline is the product. Each stage produces a concrete artifact (a PRD, a spec, a task graph, working branches, a clean PR) that feeds the next. Agents work from structured task descriptions with explicit acceptance criteria and dependency ordering. The result is predictable, auditable, and survives crashes, context exhaustion, and git merges.

Forge is built in TypeScript, stores all state in a git-backed SQLite + JSONL data plane, and requires no servers or infrastructure beyond a local machine.

---

## The Pipeline

```
  GitHub Issue (vague requirements)
       |
       v
  +------------------+
  | 1. PRD Refinement |  forge refine <issue>
  +------------------+   Human + agent dialogue -> .forge/issues/issue-<n>/prd.md
       |
       v
  +------------------+
  | 2. Technical Spec |  forge spec <prd>
  +------------------+   Agent-driven with human review -> .forge/issues/issue-<n>/spec.md
       |
       v
  +---------------------+
  | 3. Task Decomposition |  forge plan <spec>
  +---------------------+   Agent creates task graph with dependencies -> .forge/tasks.jsonl
       |
       v
  +----------------------+
  | 4. Parallel Execution |  forge dispatch / forge ready
  +----------------------+   Agents work in isolated worktrees on individual tasks
       |
       v
  +------------------+
  | 5. Merge Queue    |  forge mq process
  +------------------+   Merge Processor assembles branches in dependency order
       |
       v
  +------------------+
  | 6. PR & Review    |  forge pr create <epic>
  +------------------+   Structured PR -> human review -> merge
```

Each stage produces a durable artifact committed to the repository. At any point you can trace back: what was the original intent? (PRD), how was it designed? (spec), what was built? (task graph + branches), what shipped? (PR).

---

## Key Features

- **Structured planning pipeline** -- PRD refinement, technical spec generation, and task decomposition with AI agents that read your codebase, not just the issue title
- **Git-backed task graph** -- SQLite for fast local queries, JSONL for git-portable sync. Hash-based IDs (`fg-a3f8`) prevent merge conflicts across branches
- **Dependency-aware execution** -- Tasks are ordered so foundational changes (schemas, types) complete before consuming code. `forge ready` surfaces only unblocked, unclaimed work
- **Parallel agent workers** -- Each agent works in an isolated git worktree on its own branch, with atomic task claiming to prevent double-assignment
- **AI-powered merge queue** -- A dedicated Merge Processor agent merges completed branches sequentially, understanding code semantics to resolve conflicts intelligently
- **Crash-resilient** -- All state persists in the task graph. Agents restart, read their hook, and pick up exactly where they left off
- **Stealth mode** -- Use Forge on shared repos without committing anything. `.forge/` stays local via `.git/info/exclude`
- **Issue tracker abstraction** -- GitHub Issues by default, pluggable for Linear, Jira, or no tracker at all
- **Agent runtime abstraction** -- Claude Code CLI via tmux today, Claude Agent SDK when API credits are available
- **`--json` everywhere** -- Every command supports `--json` output for agent consumption

---

## Getting Started

### Install

```bash
npm install -g forge-cli
```

### Initialize in a project

```bash
cd ~/projects/my-app
forge init --prefix myp --name "My App"
```

```
[forge] Initialized .forge/ in /Users/you/projects/my-app
[forge] Config: .forge/config.json (prefix: myp)
[forge] Task store: .forge/tasks.jsonl
[forge] SQLite database: .forge/forge.db
[forge] Git hooks installed: pre-commit, post-merge
[forge] Added .forge/forge.db* to .gitignore
```

### Refine a GitHub Issue into a PRD

```bash
forge refine 123
```

```
[forge] Fetching issue #123 from GitHub...
[forge] Issue: "Add multi-currency support to checkout"
[forge] Starting PRD refinement session...

Agent: I've read issue #123 and explored your codebase. I see you have a
       PricingService in apps/backend/src/services/pricing.ts and a
       CheckoutForm component in apps/customer-web/src/components/checkout/.

       Let me ask a few questions to clarify the requirements:

       1. Should currency selection be per-cart or per-item?
       2. I see you're using Stripe — should we use Stripe's multi-currency
          support or handle conversion ourselves?
       ...

[forge] PRD saved to .forge/issues/issue-123/prd.md
[forge] Committed: "forge: add PRD for issue #123"
```

### Generate a technical spec

```bash
forge spec .forge/issues/issue-123/prd.md
```

```
[forge] Reading PRD for issue #123...
[forge] Agent exploring codebase for implementation context...
[forge] Drafting technical spec...

[forge] Spec saved to .forge/issues/issue-123/spec.md
[forge] Affected packages:
        - packages/shared-types (CurrencyCode enum, PriceSchema)
        - apps/backend (PricingService, checkout handler)
        - apps/customer-web (CheckoutForm, CurrencySelector)
[forge] Open for review in $EDITOR. Iterate with the agent or approve to continue.
```

### Decompose into tasks

```bash
forge plan .forge/issues/issue-123/spec.md
```

```
[forge] Reading spec for issue #123...
[forge] Decomposing into tasks...

Created epic myp-e7k1: "Add multi-currency support to checkout" (#123)
  myp-a2f9  [ready]                Add CurrencyCode enum to shared-types        P1
  myp-b4c3  [ready]                Add PriceSchema with currency field           P1
  myp-d8e1  [blocked: myp-b4c3]   Update PricingService for multi-currency      P1
  myp-f5g2  [blocked: myp-d8e1]   Update checkout handler to accept currency    P2
  myp-h1j7  [blocked: myp-f5g2]   Add CurrencySelector component               P2
  myp-k3m6  [blocked: myp-h1j7]   Integrate CurrencySelector into CheckoutForm P2
  myp-n9p4  [blocked: myp-d8e1]   Write unit tests for PricingService           P2

[forge] 7 tasks created. 2 ready, 5 blocked.
[forge] Run `forge plan --approve myp-e7k1` to release tasks for execution.
```

### View ready work

```bash
forge ready
```

```
READY TASKS (unblocked, unassigned)

ID        PRI  TYPE     TITLE
myp-a2f9  P1   task     Add CurrencyCode enum to shared-types
myp-b4c3  P1   task     Add PriceSchema with currency field

2 tasks ready
```

### Dispatch to agents

```bash
forge dispatch myp-a2f9 worker-1
forge dispatch myp-b4c3 worker-2
```

```
[forge] Dispatched myp-a2f9 to worker-1
[forge] worker-1 hook set: "Add CurrencyCode enum to shared-types"

[forge] Dispatched myp-b4c3 to worker-2
[forge] worker-2 hook set: "Add PriceSchema with currency field"
```

### Monitor progress

```bash
forge status
```

```
FORGE STATUS

AGENTS
  worker-1   working   myp-a2f9  "Add CurrencyCode enum to shared-types"     3m elapsed
  worker-2   working   myp-b4c3  "Add PriceSchema with currency field"       2m elapsed

EPIC myp-e7k1 — "Add multi-currency support to checkout" (#123)
  [##--------] 0/7 closed  |  2 in progress  |  5 blocked

MERGE QUEUE
  (empty)
```

### Track a batch

```bash
forge batch list
```

```
BATCHES

ID          EPIC       STATUS   TASKS    PROGRESS
batch-001   myp-e7k1   open     7        2/7 in progress

1 active batch
```

As workers complete tasks, their branches are submitted to the merge queue. The Merge Processor assembles them in dependency order onto a feature branch, runs tests after each merge, and creates a PR when the queue is clear.

```bash
forge pr create myp-e7k1
```

```
[forge] Creating PR from forge/epic-myp-e7k1 -> main
[forge] Running pre-review checks...
[forge]   TypeScript: pass
[forge]   Tests: pass (47 passed, 0 failed)
[forge]   Lint: pass
[forge] PR created: https://github.com/you/my-app/pull/42
[forge] Closes #123 | 7 tasks | 3 packages modified
```

---

## Stealth Mode

Use Forge on a shared repo without anyone knowing. Stealth mode keeps all Forge data local to your machine -- nothing is committed, nothing appears in `.gitignore`, and teammates see no trace of it.

```bash
forge init --stealth
```

Under the hood, stealth mode adds `.forge/` to `.git/info/exclude` (a repo-local gitignore that is not committed). Git hooks are not installed since nothing is committed. SQLite, the task graph, specs, and all CLI commands work identically.

You lose git-based sync and history for task data. You keep everything else: the full pipeline, all queries, agent execution, dispatch, batches.

To upgrade from stealth to standard later:

```bash
forge init --upgrade
```

---

## Architecture

Forge is built in layers, each independently useful:

| Layer | Name | What it does |
|-------|------|-------------|
| 0 | Spec Pipeline | PRD refinement, spec generation, markdown task plans |
| 1 | Data Plane | SQLite + JSONL task graph with hash IDs and dependency tracking |
| 2 | Agent Identity | Persistent agent identities, hooks, dispatch, handoff |
| 3 | Worker Roles | Coordinator, Workers, Merge Processor, tmux integration |
| 4 | Merge Queue | Sequential branch merging, batch tracking, PR generation |
| 5 | Supervision | Health monitoring, stall detection, auto-nudge |

The data plane uses a two-layer store: **SQLite** for fast local queries and **JSONL** for git-portable sync. Git hooks bridge the two -- `pre-commit` exports SQLite to JSONL, `post-merge` imports JSONL back to SQLite. Hash-based task IDs (4 random bytes, base36 encoded) prevent merge conflicts when agents create tasks on different branches.

For full details, see the [design docs](#design-docs).

---

## CLI Reference

### Spec Pipeline (Layer 0)

| Command | Description |
|---------|-------------|
| `forge init [--stealth] [--branch <name>]` | Initialize `.forge/` in the current repository |
| `forge refine <issue-number>` | Refine a GitHub Issue into a PRD via interactive dialogue |
| `forge spec <prd-file>` | Generate a technical spec from a PRD |
| `forge plan <spec-file> [--markdown]` | Decompose a spec into tasks (or a markdown plan with `--markdown`) |

### Task Management (Layer 1)

| Command | Description |
|---------|-------------|
| `forge task create "<title>" [options]` | Create a new task |
| `forge task show <id>` | Show full task details with dependency tree |
| `forge task update <id> [options]` | Update task fields |
| `forge task close <id> --reason "<reason>"` | Close a task |
| `forge ready [--type <type>]` | List unblocked, unassigned tasks |
| `forge search [--status <s>] [--query "<text>"]` | Search tasks with filters |
| `forge dep add <from> <to> [--type blocks]` | Add a dependency between tasks |
| `forge dep tree <id>` | Show the dependency tree for a task |

### Agent Orchestration (Layers 2-3)

| Command | Description |
|---------|-------------|
| `forge dispatch <task-id> <agent>` | Assign a task to an agent's hook |
| `forge hook` | Read the current agent's assignment |
| `forge handoff` | Save state and restart the current agent session |
| `forge nudge <agent>` | Send a kick to an agent's tmux session |
| `forge status` | Overview of all agents and their current work |
| `forge up` | Start the tmux workspace with configured agents |
| `forge spawn <role> [name]` | Spin up a new agent in a tmux session |
| `forge attach <agent>` | Switch to an agent's tmux session |
| `forge down` | Gracefully shut down all agents |

### Merge & Delivery (Layers 4-5)

| Command | Description |
|---------|-------------|
| `forge mq list` | Show pending merges |
| `forge mq process <epic-id>` | Process the merge queue for an epic |
| `forge batch create` | Create a batch to track a set of tasks |
| `forge batch list` | List active batches |
| `forge batch status <batch-id>` | Show batch progress |
| `forge pr create <epic-id>` | Create a PR from the merged feature branch |
| `forge doctor` | System health check |

### Data Plane

| Command | Description |
|---------|-------------|
| `forge export [--gc]` | Export SQLite to JSONL (with optional deduplication) |
| `forge import` | Import JSONL to SQLite |

All commands support `--json` for machine-readable output.

---

## Configuration

Forge stores its configuration in `.forge/config.json`:

```json
{
  "name": "My Project",
  "idPrefix": "myp",
  "version": 1,
  "created_at": "2026-02-18T00:00:00.000Z",
  "initMode": "standard",
  "issueTracker": {
    "provider": "github",
    "config": {
      "repo": "owner/repo"
    }
  },
  "settings": {
    "gcOnExport": true,
    "defaultPriority": 2,
    "defaultType": "task"
  }
}
```

| Field | Description |
|-------|-------------|
| `name` | Human-readable project name |
| `idPrefix` | 2-4 character prefix for task IDs (e.g., `fg` produces `fg-a3f8`) |
| `version` | Config schema version |
| `initMode` | `standard`, `stealth`, or `branch` |
| `issueTracker.provider` | `github` (default), `linear`, `jira`, or `none` |
| `settings.gcOnExport` | Deduplicate JSONL on export (default: `true`) |
| `settings.defaultPriority` | Default priority for new tasks, 0-4 (default: `2`) |
| `settings.defaultType` | Default task type (default: `task`) |

---

## Design Docs

Detailed design documentation lives in the `docs/` directory:

| Document | Description |
|----------|-------------|
| [Pipeline Stages](docs/pipeline-stages.md) | Detailed walkthrough of all 6 pipeline stages, artifacts, and transitions |
| [Data Plane Design](docs/data-plane-design.md) | SQLite + JSONL architecture, task schema, sync mechanism, core queries |
| [Implementation Outline](docs/implementation-outline.md) | Layer-by-layer build plan from spec pipeline to supervision |
| [Technical Decisions](docs/technical-decisions.md) | Key architectural decisions and their rationale |
| [Key Components](docs/key-components.md) | Conceptual background on agent orchestration system design |

---

## Contributing

Forge is in active development. Contributions are welcome.

```bash
git clone https://github.com/yourusername/forge.git
cd forge
pnpm install
pnpm build
pnpm test
```

The project uses TypeScript (strict mode), ESM throughout, vitest for testing, and tsup for builds.

---

## License

MIT
