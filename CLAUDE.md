# Forge

Agent orchestration CLI — from requirements to merged PRs.

## Project Overview

Forge is a pipeline-oriented agent orchestrator built in TypeScript. It transforms vague requirements (GitHub Issues, etc.) into merged PRs through a structured pipeline: PRD refinement → technical spec → task decomposition → parallel agent execution → merge queue → PR.

## Architecture

- **Data plane:** SQLite (via `better-sqlite3`) for fast local queries, JSONL for git-portable sync
- **CLI framework:** Commander.js
- **Build:** tsup (ESM)
- **Test:** vitest
- **Package manager:** pnpm

## Key Design Decisions

- Hash-based task IDs (e.g., `fg-a3f8`) to prevent merge conflicts
- Issue tracker abstraction (GitHub default, but pluggable for Linear/Jira)
- Agent runtime abstraction (Claude Code CLI via tmux now, Agent SDK later)
- Stealth mode (`forge init --stealth`) for local-only usage on shared repos
- `dispatch` not "sling", `batch` not "convoy"

## Directory Structure

```
src/
  cli.ts          — CLI entry point (Commander)
  commands/       — Command implementations
  db/             — SQLite schema, queries, JSONL sync
  providers/      — Issue tracker and agent runtime providers
  types/          — Shared TypeScript types
```

## Implementation Layers

Build in this order — each layer is independently useful:

1. **Layer 0:** Spec pipeline (refine, spec, plan --markdown)
2. **Layer 1:** Data plane (SQLite + JSONL task graph)
3. **Layer 2:** Agent identity and propulsion (hooks, dispatch, handoff)
4. **Layer 3:** Worker roles and tmux integration
5. **Layer 4:** Merge queue and batch tracking
6. **Layer 5:** Supervision and health monitoring

## Conventions

- All CLI commands support `--json` flag for agent consumption
- Task IDs use the project prefix from `.forge/config.json` (default: `fg-`)
- ESM throughout (`"type": "module"` in package.json)
- Strict TypeScript
