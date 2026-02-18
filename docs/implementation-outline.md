# Forge — Implementation Outline

> An agent orchestration system for managing AI coding agents through a structured pipeline, from vague requirements to merged PRs.

**Related documents:**
- [[Key Components of Agent Orchestration Systems]]
- [[Forge - Technical Decisions]]
- [[Forge - Data Plane Design]]
- [[Forge - Pipeline Stages]]

---

## Architecture Overview

Forge is a **pipeline-oriented agent orchestrator** built in TypeScript. Unlike Gas Town (which optimizes for raw throughput with 20+ agents), Forge optimizes for **pipeline automation with a few agents** — turning vague requirements into merged PRs with minimal manual intervention.

```
GitHub Issue (vague)
  → PRD Refinement (human + agent dialogue)
    → Spec (how it works in the system)
      → Task Decomposition (forge tasks with dependencies)
        → Parallel Agent Execution (2-5 workers)
          → Merge Queue (single clean PR)
            → CI / Human Review → Merge
```

The system is built in layers, where each layer is independently useful.

---

## Layer 0 — Spec Pipeline (No Orchestration Required)

**Goal:** Get value immediately by improving the planning stages.

**What it does:**
- A prompted Claude Code workflow that helps refine a GitHub Issue into a PRD through structured dialogue
- Outputs a markdown spec committed to `.forge/specs/`
- Optionally decomposes the spec into a markdown task plan
- You then work with a single agent as you do today, just with a better starting point

**What to build:**
- [ ] `.forge/` directory structure and `forge init` command
- [ ] `forge refine <github-issue-number>` — pulls issue context from GitHub, starts a PRD refinement conversation, saves output to `.forge/specs/issue-<number>.md`
- [ ] `forge spec <spec-file>` — takes a PRD and produces a technical spec through agent dialogue
- [ ] `forge plan <spec-file>` — decomposes a spec into a markdown task plan
- [ ] Prompt templates for each stage (stored in Forge's own repo)

**Dependencies:** GitHub CLI (`gh`), Claude Code CLI

**Value delivered:** Better specs, faster planning, structured starting point for every feature. Usable by any developer on the team with zero setup beyond installing Forge.

---

## Layer 1 — Data Plane (The Task Graph)

**Goal:** Replace markdown task plans with a structured, queryable, git-backed task graph.

**What it does:**
- SQLite-backed task store with JSONL export for git portability
- Hash-based IDs, dependency tracking, status lifecycle
- Agents can create, claim, update, and close tasks programmatically
- `forge ready` shows unblocked work at a glance

**What to build:**
- [ ] SQLite schema and `better-sqlite3` data access layer
- [ ] JSONL import/export with git hooks for sync
- [ ] Hash-based ID generation (e.g., `fg-a3f8`)
- [ ] Core task CRUD: `forge task create`, `forge task show`, `forge task update`, `forge task close`
- [ ] Dependency management: `forge dep add`, `forge dep tree`
- [ ] `forge ready` — list unblocked, unassigned tasks
- [ ] Epic/parent-child support
- [ ] `forge plan <spec-file>` upgraded to produce tasks instead of markdown
- [ ] Agent-friendly JSON output mode (`--json` flag on all commands)

**Detailed design:** [[Forge - Data Plane Design]]

**Dependencies:** Layer 0 (specs feed into task decomposition)

---

## Layer 2 — Agent Identity and Propulsion

**Goal:** Give agents persistent identities and the ability to self-drive through work.

**What it does:**
- Agents have persistent identities in the task graph (separate from ephemeral Claude Code sessions)
- Each agent has a "hook" — a designated slot where work is assigned
- The propulsion principle: on startup, agents check their hook and begin working immediately
- `forge sling` dispatches work to agents
- `forge handoff` lets agents gracefully restart when context fills up

**What to build:**
- [ ] Agent identity records in the task graph (role, name, hook, status)
- [ ] Hook mechanism — pinned tasks that represent an agent's current assignment
- [ ] `forge sling <task-id> <agent>` — assign work to an agent's hook
- [ ] `forge hook` — agent reads its current assignment
- [ ] `forge handoff` — agent saves state, cleans up, and restarts
- [ ] `forge nudge <agent>` — send a kick to an agent's tmux session
- [ ] CLAUDE.md / system prompt templates for Forge-aware agents
- [ ] Environment variables: `FORGE_ROLE`, `FORGE_AGENT`, `FORGE_RIG`

**Dependencies:** Layer 1 (hooks and identities are tasks in the graph)

---

## Layer 3 — Worker Roles and tmux Integration

**Goal:** Define specialized agent roles and manage them through tmux.

**What it does:**
- Typed worker roles: Coordinator, Workers (ephemeral), Crew (persistent), Merge Processor
- tmux session management — spin up, switch between, monitor agents
- Workers pick up tasks from `forge ready`, execute them, submit results

**What to build:**
- [ ] Role definitions with prompt templates (stored in Forge repo)
- [ ] `forge up` — start the tmux workspace with configured agents
- [ ] `forge spawn <role> [name]` — spin up a new agent in a tmux session
- [ ] `forge attach <agent>` — switch to an agent's tmux session
- [ ] `forge status` — overview of all agents and their current work
- [ ] `forge down` — gracefully shut down all agents
- [ ] tmux session naming, grouping, and status line configuration
- [ ] Worker lifecycle: spawn → work → done → cleanup

**Dependencies:** Layer 2 (agents need identity and propulsion)

---

## Layer 4 — Merge Queue

**Goal:** Reassemble parallel agent work into a single clean PR per feature.

**What it does:**
- A dedicated agent role (Merge Processor) that processes completed work
- Takes branches from finished workers, merges them sequentially onto a feature branch
- Resolves conflicts intelligently (AI-powered merge, not just `git merge`)
- Produces a single PR linked back to the GitHub Issue

**What to build:**
- [ ] Merge queue data structure (ordered list of pending merge requests)
- [ ] `forge mq list` — show pending merges
- [ ] `forge mq process` — Merge Processor works through the queue
- [ ] Conflict resolution strategy (attempt auto-merge, escalate to human if needed)
- [ ] PR creation via `gh pr create` with structured description
- [ ] Convoy/batch tracking — group tasks into a deliverable unit
- [ ] `forge convoy create`, `forge convoy status`, `forge convoy list`

**Dependencies:** Layer 3 (needs workers producing merge requests)

---

## Layer 5 — Supervision and Health Monitoring

**Goal:** Keep the system running without constant human attention.

**What it does:**
- A lightweight patrol loop that checks on worker health
- Detects stalled/zombie agents, nudges or restarts them
- Exponential backoff when no work is available

**What to build:**
- [ ] Witness-equivalent patrol for worker health monitoring
- [ ] Stall/zombie detection (agent hasn't updated task status in N minutes)
- [ ] Auto-nudge for unresponsive agents
- [ ] `forge doctor` — system health check
- [ ] Daemon tick mechanism (lightweight, not a full Deacon hierarchy)
- [ ] Logging and activity feed

**Dependencies:** Layer 4 (full system needs monitoring)

---

## Layer 6 — Workflow Templates (Molecules/Formulas)

**Goal:** Define reusable, composable workflows that agents walk through step by step.

**What it does:**
- TOML or YAML workflow definitions (Forge's equivalent of Gas Town formulas)
- Instantiate workflows into task chains
- Agents navigate workflows step-by-step with `forge step done`
- Workflows survive crashes and context exhaustion

**What to build:**
- [ ] Workflow definition format (YAML probably, since the monorepo already uses it)
- [ ] `forge workflow list`, `forge workflow cook <template>`, `forge workflow pour <template>`
- [ ] Step navigation: `forge step current`, `forge step done <id>`
- [ ] Built-in workflow templates: standard feature, bug fix, release
- [ ] Workflow composition (wrap any workflow with review/test steps)

**Dependencies:** Layer 1 (workflows are chains of tasks)

---

## Implementation Order

```
Week 1-2:  Layer 0 — Spec pipeline (immediate value)
Week 3-5:  Layer 1 — Data plane (foundation)
Week 6-7:  Layer 2 — Identity and propulsion
Week 8-9:  Layer 3 — Roles and tmux
Week 10-11: Layer 4 — Merge queue
Week 12+:  Layer 5-6 — Supervision and workflows
```

Layers 0 and 1 are the critical path. Everything else builds on them. Layer 0 can be used immediately while Layer 1 is being built.

Note: Layers 5 and 6 may be reordered or built incrementally. Workflow templates (Layer 6) could be useful earlier if you find yourself repeating the same task decomposition patterns. Supervision (Layer 5) becomes necessary only when you're regularly running 3+ agents.

---

## Open Questions

- **GitHub Issues sync:** Should Forge pull GitHub Issues into the task graph, or keep them as a separate upstream? Initial recommendation: keep them separate — Forge tasks are agent-scoped decompositions of human-scoped GitHub Issues.
- **Multi-repo support:** Start single-repo. Add rig-like multi-repo support when/if needed.
- **Team rollout:** Forge should work as a standalone CLI that any developer can install. Team-shared state (if needed) can sync through git via the JSONL file.
- **API vs CLI agents:** Start with Claude Code CLI sessions. API-based agents are a future optimization.
