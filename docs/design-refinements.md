# Forge — Design Refinements

> Updates and refinements to the initial design based on further discussion.

**Related documents:**
- [[Forge - Implementation Outline]]
- [[Forge - Technical Decisions]]
- [[Forge - Data Plane Design]]
- [[Forge - Pipeline Stages]]
- [[Key Components of Agent Orchestration Systems]]

---

## 1. Abstract Issue Tracker Provider

Forge should not be coupled to GitHub Issues. The system needs a provider interface so other trackers (Linear, Jira, etc.) can be plugged in.

### Interface

```typescript
interface IssueTrackerProvider {
  name: string;
  getIssue(id: string): Promise<Issue>;
  getIssueComments(id: string): Promise<Comment[]>;
  searchIssues(query: string): Promise<Issue[]>;
  addComment(issueId: string, body: string): Promise<void>;
  linkForgeTask(issueId: string, forgeTaskId: string): Promise<void>;
}

interface Issue {
  id: string;
  title: string;
  body: string;
  labels: string[];
  assignee: string | null;
  status: string;
  url: string;
}
```

### Configuration

```json
// .forge/config.json
{
  "issueTracker": {
    "provider": "github",
    "config": {
      "repo": "owner/repo"
    }
  }
}
```

### Built-in Providers

| Provider | Implementation | Auth |
|----------|---------------|------|
| **GitHub** (default) | Via `gh` CLI | gh auth |
| **Linear** | Via Linear API | API key |
| **Jira** | Via Jira REST API | API token |
| **None** | Manual — user provides context directly | N/A |

The `none` provider is important — it allows Forge to work without any issue tracker integration, for personal projects or when you just want to use the pipeline manually.

---

## 2. Directory Structure Update

Instead of flat `.forge/specs/` and `.forge/prds/`, use per-issue directories to keep all artifacts for a feature together:

```
.forge/
  config.json
  tasks.jsonl
  forge.db              (gitignored)
  issues/
    issue-123/
      prd.md            (from forge refine)
      spec.md           (from forge spec)
      plan.md           (from forge plan --markdown)
    issue-456/
      prd.md
      spec.md
```

**Rationale:** All artifacts for a single feature live together. Easy to find, easy to clean up, scales cleanly. `forge refine 123` creates `.forge/issues/issue-123/prd.md` automatically.

---

## 3. `forge plan` Markdown Flag

`forge plan` generates structured tasks in the task graph by default. Adding `--markdown` outputs a traditional markdown plan instead:

```bash
# Generates tasks in the task graph (Layer 1+)
forge plan .forge/issues/issue-123/spec.md

# Generates a markdown plan file (Layer 0 — works immediately)
forge plan .forge/issues/issue-123/spec.md --markdown
```

The markdown plan goes to `.forge/issues/issue-123/plan.md`. This gives the Layer 0 experience (useful immediately, no data plane needed) with the same command.

---

## 4. Terminology Changes

### `sling` → `dispatch`

```bash
# Before
forge sling fg-a3f8 worker-1

# After
forge dispatch fg-a3f8 worker-1
```

**Rationale:** "Dispatch" is precise, self-descriptive, and a common operations term. Pairs well with status queries: "what's been dispatched?"

### `convoy` → `batch`

```bash
# Before
forge convoy create "Booking calendar feature"
forge convoy status

# After
forge batch create "Booking calendar feature"
forge batch status
forge batch list
```

**Rationale:** Everyone knows what a batch is. No metaphor to learn.

---

## 5. Claude Agent SDK Integration

### Discovery

There are two relevant Anthropic products:

| Product | What it is | Status |
|---------|-----------|--------|
| **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) | TypeScript/Python library for programmatic agent control | **GA / Production** |
| **Agent Teams** | Experimental Claude Code feature for multi-agent collaboration | **Experimental** |

### The Claude Agent SDK

The Agent SDK gives programmatic access to the same agent loop that powers Claude Code. Key capabilities:

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

const q = query({
  prompt: "Implement the date picker component per the spec",
  options: {
    allowedTools: ["Read", "Write", "Edit", "Bash"],
    cwd: "/path/to/worktree",
    permissionMode: "acceptEdits",
    maxBudgetUsd: 2.0,
    maxTurns: 20,
    model: "claude-opus-4-6",
    systemPrompt: "You are a Forge worker agent...",
  }
});

for await (const msg of q) {
  if (msg.type === "result" && msg.subtype === "success") {
    console.log(msg.result);
    console.log(`Cost: $${msg.total_cost_usd}`);
  }
}
```

**Advantages over tmux + CLI:**
- Type-safe TypeScript API with full control over tools, permissions, budget
- Programmatic session management (resume, fork, abort)
- Cost tracking per agent
- Structured error handling (typed error subtypes)
- Subagent support (agents can spawn sub-agents)

### Recommended Approach: Agent Runtime Abstraction

Design Forge with an agent provider interface so we can swap between runtimes:

```typescript
interface AgentRuntime {
  name: string;
  spawn(config: AgentConfig): Promise<AgentSession>;
  attach(sessionId: string): Promise<AgentSession>;
  list(): Promise<AgentSession[]>;
}

interface AgentSession {
  id: string;
  role: string;
  status: "running" | "idle" | "completed" | "failed";
  send(message: string): Promise<void>;
  interrupt(): Promise<void>;
  onMessage(handler: (msg: AgentMessage) => void): void;
  cost?: number;
}

interface AgentConfig {
  prompt: string;
  role: string;
  cwd: string;
  tools: string[];
  systemPrompt: string;
  maxBudget?: number;
}
```

**Built-in runtimes:**

| Runtime | When to use | Billing |
|---------|------------|---------|
| `claude-cli` | Works with Claude Teams plan subscriptions | Subscription |
| `claude-sdk` | Full programmatic control, cost tracking | API credits |

**Start with `claude-cli` (tmux)** since it works with the existing Teams plan. The `claude-sdk` runtime becomes available when API credits are an option, and provides a significantly better developer experience for orchestration.

---

## 6. Multi-Repo Support Design

### Architecture

```
~/.forge/                          (forge home — global config)
  config.json                      (registered projects, global settings)
  agents.jsonl                     (global agent identities)
  batches.jsonl                    (cross-project batch tracking)

~/code/project-a/.forge/           (per-project)
  config.json
  tasks.jsonl
  forge.db

~/code/project-b/.forge/           (per-project)
  config.json
  tasks.jsonl
  forge.db
```

### What's Required

1. **Forge home directory** (`~/.forge/`) — sits above individual projects, holds global config, agent identities, and cross-project batch tracking
2. **Project registration:** `forge project add <name> <path>` registers a repo
3. **ID prefix routing:** Each project gets a unique prefix (e.g., `pa-` for polaris-adventures, `fg-` for forge). Task IDs route to the correct project's database.
4. **Cross-project batches:** A batch can track tasks across multiple projects
5. **Agent mobility:** Agents can create worktrees in any registered project via `forge worktree <project>`

### Design-Now, Build-Later

The ID prefix system should be designed into Layer 1 from the start (the `config.json` `prefix` field). Everything else can be added later without breaking changes. Start single-repo; the prefix is just a nice namespace even for one project.

---

## 7. Stealth Mode

### How Beads Does It

Beads offers three initialization modes:
- **Standard** (`bd init`) — commits `.beads/` to the repo, installs git hooks
- **Stealth** (`bd init --stealth`) — uses `.git/info/exclude` to hide `.beads/`, no git hooks, fully local
- **Contributor** (`bd init --contributor`) — routes planning data to `~/.beads-planning` (separate from repo)
- **Branch** (`bd init --branch forge-data`) — commits to a separate branch that never merges to main

### Forge Stealth Mode Design

```bash
# Standard — commits .forge/ to repo, installs git hooks for JSONL sync
forge init

# Stealth — fully local, invisible to teammates
forge init --stealth

# Branch — uses a separate git branch for forge data
forge init --branch forge-data
```

**Stealth mode implementation:**

1. Creates `.forge/` directory as normal
2. Adds `.forge/` to `.git/info/exclude` (repo-local gitignore — not committed, not in `.gitignore`)
3. Does NOT install git hooks (no JSONL sync since nothing is committed)
4. SQLite works normally for local queries
5. JSONL is written but stays local (useful for backup/export)
6. All Forge commands work identically — agents can't tell the difference

**What you lose in stealth:**
- No git-based sync or history for task data
- No collaboration with other Forge users on the same repo
- Task data only exists on your machine

**What you keep:**
- Full task graph, all queries, all CLI commands
- Agent execution, dispatch, batches — everything works
- Specs and PRDs in `.forge/issues/` are also gitignored (stealth is all-or-nothing)

**Upgrade path:**
```bash
# Switch from stealth to standard
forge init --upgrade

# This: removes .forge/ from .git/info/exclude,
# adds .forge/ tracking to git, installs hooks, commits
```

**Branch mode** is a middle ground — your Forge data is in git (versioned, backed up) but on a separate branch that doesn't pollute `main`. Useful for teams where some people use Forge and others don't.

---

## 8. API-Based Agents (Future)

Confirmed as a future optimization, not a launch requirement. The agent runtime abstraction (section 5) ensures this is a clean swap when the time comes. No additional design needed now.

---

## Updated Technical Decision Record

These refinements add three new decisions to [[Forge - Technical Decisions]]:

9. **Issue Tracker: Provider abstraction with GitHub as default** — Forge is not coupled to GitHub Issues. A provider interface allows Linear, Jira, or no tracker at all.

10. **Agent Runtime: Abstraction with CLI-first, SDK-later** — Start with Claude Code CLI via tmux (works with Teams plan). Claude Agent SDK becomes the preferred runtime when API credits are available.

11. **Initialization Modes: Standard, Stealth, Branch** — Stealth mode uses `.git/info/exclude` for fully local operation on shared repos. Branch mode commits to a separate git branch.
