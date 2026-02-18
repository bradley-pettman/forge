# Forge — Data Plane Design

The persistent, git-backed task graph that serves as Forge's foundation. Inspired by Beads but built in TypeScript with SQLite + JSONL.

Related: [Forge - Implementation Outline](./implementation-outline.md) · [Forge - Technical Decisions](./technical-decisions.md) · [Key Components of Agent Orchestration Systems](./key-components.md)

---

## Overview

The Forge data plane is the single source of truth for all task state in an agent orchestration session. It solves a fundamental problem with agent systems: state is lost when a process dies, and multiple agents writing concurrently will corrupt shared data structures.

Forge's answer is a two-layer store:

- **SQLite** — fast, queryable, local. The working database agents read and write during execution.
- **JSONL** — human-readable, git-friendly, portable. The durable format that travels with the repository.

Every task ever created lives in `.forge/tasks.jsonl`. Git tracks it. The SQLite database is a derived, ephemeral view that can be rebuilt at any time from the JSONL. This means Forge survives crashes, merges cleanly across branches, and never requires a central server.

---

## Directory Structure

```
.forge/
  config.json        — project config (name, ID prefix, settings)
  tasks.jsonl        — git-tracked task data (append-optimized portable format)
  issues/            — per-issue artifacts from the pipeline
    issue-123/
      prd.md         — from forge refine
      spec.md        — from forge spec
      plan.md        — from forge plan --markdown
    issue-456/
      prd.md
      spec.md
  forge.db           — SQLite database (gitignored)
  hooks/             — git hook scripts (symlinked into .git/hooks/)
    post-merge
    pre-commit
```

`.forge/forge.db` is listed in `.gitignore`. The JSONL file is the canonical record.

```
# .gitignore addition (forge init writes this automatically)
.forge/forge.db
.forge/forge.db-shm
.forge/forge.db-wal
```

---

## Task Schema

### TypeScript Types

```typescript
export type TaskStatus = 'open' | 'in_progress' | 'closed';

export type CloseReason = string; // free-form: "done", "cancelled", "duplicate:<id>", etc.

export type TaskType = 'task' | 'bug' | 'feature' | 'epic' | 'message';

export type Priority = 0 | 1 | 2 | 3 | 4;
// 0 = critical, 1 = high, 2 = medium, 3 = low, 4 = backlog

export type DepType = 'blocks' | 'related' | 'discovered-from';

export interface TaskDependency {
  id: string;       // the other task's ID
  type: DepType;
}

export interface Task {
  // Identity
  id: string;                    // e.g. "fg-a3f8" — hash-based, prefix-configurable
  title: string;                 // short summary, one line
  description: string;           // markdown. should include acceptance criteria

  // Classification
  status: TaskStatus;
  close_reason?: CloseReason;    // only present when status === 'closed'
  priority: Priority;
  type: TaskType;

  // Relationships
  assignee: string | null;       // agent identity string, e.g. "worker-1", or null
  parent_id: string | null;      // ID of parent epic, or null
  dependencies: TaskDependency[]; // outbound deps from this task

  // Labels
  labels: string[];

  // External references
  github_issue: number | null;   // GitHub Issue number, if this task was sourced from one

  // Timestamps (ISO 8601)
  created_at: string;
  created_by: string;            // agent or user identity that created the task
  updated_at: string;
  closed_at: string | null;      // only present when status === 'closed'

  // Extensibility
  metadata: Record<string, unknown>; // arbitrary JSON — agents may store anything here
}
```

### Field Notes

**`id`** — Hash-based, not sequential. See [Hash-Based ID Generation](#hash-based-id-generation). The prefix is configurable per project (`config.json` → `idPrefix`).

**`description`** — Markdown string. Conventions: use a `## Acceptance Criteria` section so agents know when the task is done. The pipeline spec generator populates this field.

**`assignee`** — The string identity of the claiming agent (e.g. `"worker-1"`, `"claude-opus-4-6"`). Null means unclaimed. Agents set this atomically when claiming a task.

**`dependencies`** — Stored on the *dependent* task, not on the blocking task. If task `fg-b2c1` blocks task `fg-a3f8`, then `fg-a3f8.dependencies` contains `{ id: "fg-b2c1", type: "blocks" }`.

**`metadata`** — Used by the pipeline layers to attach intermediate data without schema migrations. Examples: `{ spec_generated_at: "...", plan_approved: true, pr_url: "..." }`.

---

## Hash-Based ID Generation

### Algorithm

```typescript
import { randomBytes } from 'crypto';

/**
 * Generate a short, hash-based task ID.
 *
 * Steps:
 *   1. Generate 4 cryptographically random bytes (32 bits of entropy).
 *   2. Interpret as an unsigned 32-bit integer.
 *   3. Encode in base36 (digits 0-9 and letters a-z, no special characters).
 *   4. Left-pad to 4 characters with '0' for a consistent length.
 *   5. Prepend the project prefix from config.
 *
 * Result examples: "fg-a3f8", "fg-k7m2", "fg-0019"
 */
export function generateTaskId(prefix: string): string {
  const bytes = randomBytes(4);
  const num = bytes.readUInt32BE(0);
  const encoded = num.toString(36).padStart(4, '0').slice(-4);
  return `${prefix}-${encoded}`;
}
```

### Why Base36

- Only alphanumeric characters — safe in URLs, shell arguments, filenames
- 4 characters → 36^4 = 1,679,616 possible IDs per project prefix
- Short enough to type and remember; long enough to avoid collisions in practice
- No hyphens, underscores, or other shell-special characters in the suffix

### Why This Prevents Merge Conflicts

Sequential IDs (`TASK-1`, `TASK-2`, ...) are assigned from a shared counter. Two branches that both create tasks increment the same counter, producing the same ID on both branches. Merging is impossible without manual conflict resolution.

Hash-based IDs have no shared counter. Each agent or user generates an ID locally from random bytes. The probability of a collision between two independently generated 4-byte IDs is approximately 1 in 1.6 million per pair. In practice, projects never accumulate enough tasks for this to matter.

When two branches are merged, `tasks.jsonl` may have new lines appended by either branch. Since JSONL is append-only and each line is an independent JSON object identified by its unique ID, git's line-level merge handles this automatically. There are no conflicts to resolve.

---

## SQLite Schema

```sql
-- Enable WAL mode for concurrent reads during writes
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ─── tasks ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tasks (
  -- Identity
  id            TEXT    PRIMARY KEY NOT NULL,
  title         TEXT    NOT NULL,
  description   TEXT    NOT NULL DEFAULT '',

  -- Classification
  status        TEXT    NOT NULL DEFAULT 'open'
                        CHECK(status IN ('open', 'in_progress', 'closed')),
  close_reason  TEXT,
  priority      INTEGER NOT NULL DEFAULT 2
                        CHECK(priority BETWEEN 0 AND 4),
  type          TEXT    NOT NULL DEFAULT 'task'
                        CHECK(type IN ('task', 'bug', 'feature', 'epic', 'message')),

  -- Relationships
  assignee      TEXT,
  parent_id     TEXT    REFERENCES tasks(id) ON DELETE SET NULL,

  -- Labels stored as JSON array string e.g. '["frontend","auth"]'
  labels        TEXT    NOT NULL DEFAULT '[]',

  -- External references
  github_issue  INTEGER,

  -- Timestamps
  created_at    TEXT    NOT NULL,
  created_by    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,
  closed_at     TEXT,

  -- Extensibility — arbitrary JSON object
  metadata      TEXT    NOT NULL DEFAULT '{}'
);

-- ─── dependencies ────────────────────────────────────────────────────────────
-- Normalized form of Task.dependencies[].
-- from_id "depends on" to_id with dep_type.
-- e.g. fg-a3f8 blocks fg-c9d1 → (from_id='fg-a3f8', to_id='fg-c9d1', dep_type='blocks')

CREATE TABLE IF NOT EXISTS dependencies (
  from_id   TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  to_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  dep_type  TEXT NOT NULL DEFAULT 'blocks'
            CHECK(dep_type IN ('blocks', 'related', 'discovered-from')),
  PRIMARY KEY (from_id, to_id, dep_type)
);

-- ─── indexes ─────────────────────────────────────────────────────────────────

-- Most common filter: status + priority (forge ready, forge search)
CREATE INDEX IF NOT EXISTS idx_tasks_status_priority
  ON tasks(status, priority);

-- Assignee queries: "what is worker-1 working on?"
CREATE INDEX IF NOT EXISTS idx_tasks_assignee
  ON tasks(assignee)
  WHERE assignee IS NOT NULL;

-- Epic/subtask hierarchy
CREATE INDEX IF NOT EXISTS idx_tasks_parent_id
  ON tasks(parent_id)
  WHERE parent_id IS NOT NULL;

-- GitHub Issue reverse lookup
CREATE INDEX IF NOT EXISTS idx_tasks_github_issue
  ON tasks(github_issue)
  WHERE github_issue IS NOT NULL;

-- Dependency graph traversal
CREATE INDEX IF NOT EXISTS idx_deps_to_id
  ON dependencies(to_id);

CREATE INDEX IF NOT EXISTS idx_deps_from_id
  ON dependencies(from_id);
```

### Schema Notes

- `labels` and `metadata` are stored as JSON strings in SQLite (TEXT columns). SQLite's `json_each()` and `json_extract()` functions query into them without a schema change.
- `dependencies` is a separate table rather than a JSON column so that `forge ready` can use a join rather than scanning and deserializing every task's dependency array.
- The `ON DELETE CASCADE` on `dependencies` ensures that when a task is deleted (rare), its dependency records are cleaned up.

---

## JSONL Format

### Structure

`tasks.jsonl` holds the complete, canonical task history. Each line is one self-contained JSON object representing the *current state* of a task (not a change log — full snapshots).

The file is append-optimized: when tasks are updated, the new snapshot is appended and the old line is logically superseded. During import, Forge processes lines in order and the last occurrence of a given `id` wins.

This makes the file grow over time, so `forge gc` rewrites it with one line per task (deduplicated). This is safe to run any time and produces a functionally identical file with fewer lines.

### Fields NOT Exported to JSONL

| Field | Reason |
|---|---|
| SQLite internal `rowid` | SQLite-internal, meaningless outside the DB |
| `content_hash` | Computed field used during sync, not part of task identity |

All other fields from the Task schema are exported verbatim.

### Example Entries

```jsonl
{"id":"fg-a3f8","title":"Scaffold .forge/ directory on init","description":"## Summary\nThe `forge init` command should create the `.forge/` directory structure and write a default `config.json`.\n\n## Acceptance Criteria\n- Running `forge init` in an empty directory creates `.forge/config.json`, `.forge/tasks.jsonl`\n- `.forge/forge.db` is added to `.gitignore`\n- If `.forge/` already exists, the command fails with a clear error message\n- Git hooks are installed into `.git/hooks/`","status":"closed","close_reason":"Implemented in commit 3a9f1c2","priority":1,"type":"feature","assignee":"worker-1","parent_id":null,"dependencies":[],"labels":["core","init"],"github_issue":12,"created_at":"2026-02-10T09:00:00.000Z","created_by":"orchestrator","updated_at":"2026-02-10T14:22:00.000Z","closed_at":"2026-02-10T14:22:00.000Z","metadata":{"pr_url":"https://github.com/org/repo/pull/8"}}
{"id":"fg-b2c1","title":"Implement hash-based ID generation","description":"## Summary\nGenerate task IDs from 4 random bytes encoded in base36, prefixed with the project prefix from config.\n\n## Acceptance Criteria\n- `generateTaskId('fg')` returns strings matching `/^fg-[0-9a-z]{4}$/`\n- Two calls never return the same ID in a test suite of 10,000 iterations\n- Prefix is read from `.forge/config.json` at runtime","status":"closed","close_reason":"Implemented in commit 7b2e9f1","priority":1,"type":"task","assignee":"worker-1","parent_id":"fg-e5a2","dependencies":[],"labels":["core"],"github_issue":null,"created_at":"2026-02-10T09:05:00.000Z","created_by":"orchestrator","updated_at":"2026-02-10T11:30:00.000Z","closed_at":"2026-02-10T11:30:00.000Z","metadata":{}}
{"id":"fg-c9d1","title":"SQLite schema and migration runner","description":"## Summary\nCreate the SQLite schema (tasks + dependencies tables) and a simple migration runner that applies schema changes on startup.\n\n## Acceptance Criteria\n- On first run, creates all tables with correct column types and constraints\n- Subsequent runs are idempotent (uses `CREATE TABLE IF NOT EXISTS`)\n- WAL mode is enabled\n- Foreign keys are enforced","status":"in_progress","priority":0,"type":"task","assignee":"worker-2","parent_id":"fg-e5a2","dependencies":[{"id":"fg-b2c1","type":"blocks"}],"labels":["core","sqlite"],"github_issue":null,"created_at":"2026-02-10T09:10:00.000Z","created_by":"orchestrator","updated_at":"2026-02-11T08:15:00.000Z","closed_at":null,"metadata":{"started_at":"2026-02-11T08:15:00.000Z"}}
{"id":"fg-e5a2","title":"Data plane implementation","description":"## Summary\nEpic: all work required to implement the Forge data plane as specified in the design document.\n\n## Acceptance Criteria\n- All child tasks closed\n- Integration test suite passes\n- `forge init`, `forge task create/show/update/close`, `forge ready`, `forge dep add/tree`, `forge search` all work end-to-end","status":"open","priority":0,"type":"epic","assignee":null,"parent_id":null,"dependencies":[],"labels":["epic","core"],"github_issue":1,"created_at":"2026-02-10T09:00:00.000Z","created_by":"orchestrator","updated_at":"2026-02-10T09:00:00.000Z","closed_at":null,"metadata":{"child_count":12,"closed_child_count":2}}
```

---

## Sync Mechanism

### Write Path (Local → Git)

```
Agent / CLI writes task change
        ↓
SQLite UPDATE/INSERT (immediate, in-process)
        ↓
git commit (user or agent triggers)
        ↓
pre-commit hook fires
        ↓
forge export → rewrites .forge/tasks.jsonl from SQLite
        ↓
git stages .forge/tasks.jsonl automatically
        ↓
commit includes updated JSONL
```

The pre-commit hook ensures the JSONL is always current at commit time. Developers never manually edit `tasks.jsonl`.

### Read Path (Git → Local)

```
git pull / git merge completes
        ↓
post-merge hook fires
        ↓
forge import → reads .forge/tasks.jsonl line by line
        ↓
for each task: UPSERT into SQLite (last-write-wins on updated_at)
        ↓
SQLite is now current with all merged changes
```

### Conflict Handling

| Scenario | Result |
|---|---|
| Two branches create different tasks | No conflict. Different IDs, JSONL lines don't overlap. Git merges trivially. |
| Two branches update the *same* task | JSONL has two lines for the same `id`. Import takes the one with the later `updated_at`. |
| Two branches close the same task with different reasons | Last `updated_at` wins. Acceptable: tasks are usually owned by one agent at a time. |
| Two branches add the same dependency | Dependency table `PRIMARY KEY (from_id, to_id, dep_type)` makes the UPSERT idempotent. |

The system deliberately chooses **last-write-wins** over operational transforms or CRDTs. For a task graph, this is correct: an agent either owns a task or it doesn't. The `assignee` field and the claiming transaction (see [Core Queries](#core-queries)) prevent two agents from simultaneously owning the same task in normal operation.

### Git Hook Scripts

**`.forge/hooks/pre-commit`**

```bash
#!/usr/bin/env bash
# Forge pre-commit hook: export SQLite → JSONL before every commit.
# Installed by `forge init` via symlink: .git/hooks/pre-commit → .forge/hooks/pre-commit

set -euo pipefail

FORGE_DIR="$(git rev-parse --show-toplevel)/.forge"

# Only run if .forge/ exists (not all repos use Forge)
if [ ! -d "$FORGE_DIR" ]; then
  exit 0
fi

echo "[forge] Exporting tasks to JSONL..."

# forge export writes the current SQLite state to .forge/tasks.jsonl
# --gc deduplicates lines (one per task) before writing
npx forge export --gc

# Stage the updated JSONL file
git add "$FORGE_DIR/tasks.jsonl"

echo "[forge] tasks.jsonl updated and staged."
```

**`.forge/hooks/post-merge`**

```bash
#!/usr/bin/env bash
# Forge post-merge hook: import JSONL → SQLite after every merge/pull.
# Installed by `forge init` via symlink: .git/hooks/post-merge → .forge/hooks/post-merge

set -euo pipefail

FORGE_DIR="$(git rev-parse --show-toplevel)/.forge"

if [ ! -d "$FORGE_DIR" ]; then
  exit 0
fi

# Check if tasks.jsonl was modified by the merge
CHANGED=$(git diff-tree -r --name-only --no-commit-id ORIG_HEAD HEAD -- .forge/tasks.jsonl || true)

if [ -z "$CHANGED" ]; then
  exit 0
fi

echo "[forge] Detected changes in tasks.jsonl, importing to SQLite..."

npx forge import

echo "[forge] SQLite updated from merged JSONL."
```

**Installing hooks (done by `forge init`):**

```bash
#!/usr/bin/env bash
# Part of forge init logic
REPO_ROOT=$(git rev-parse --show-toplevel)
HOOKS_DIR="$REPO_ROOT/.git/hooks"

ln -sf "../../.forge/hooks/pre-commit" "$HOOKS_DIR/pre-commit"
ln -sf "../../.forge/hooks/post-merge" "$HOOKS_DIR/post-merge"

chmod +x "$REPO_ROOT/.forge/hooks/pre-commit"
chmod +x "$REPO_ROOT/.forge/hooks/post-merge"
```

---

## Core Queries

### `forge ready` — All Actionable Tasks

Returns all open, unassigned tasks with no unresolved blocking dependencies, ordered by priority then creation date.

```sql
-- "forge ready": tasks that are open, unclaimed, and unblocked
SELECT t.*
FROM tasks t
WHERE t.status = 'open'
  AND t.assignee IS NULL
  -- Exclude tasks that have at least one unresolved blocking dependency
  AND t.id NOT IN (
    SELECT d.from_id
    FROM dependencies d
    JOIN tasks blocker ON blocker.id = d.to_id
    WHERE d.dep_type = 'blocks'
      AND blocker.status != 'closed'
  )
ORDER BY t.priority ASC, t.created_at ASC;
```

### `forge task show <id>` — Full Task with Dependency Tree

```sql
-- Step 1: fetch the task itself
SELECT * FROM tasks WHERE id = ?;

-- Step 2: fetch outbound dependencies (tasks this task depends on)
SELECT
  d.dep_type,
  d.to_id,
  t.title,
  t.status,
  t.priority,
  t.assignee
FROM dependencies d
JOIN tasks t ON t.id = d.to_id
WHERE d.from_id = ?;

-- Step 3: fetch inbound dependencies (tasks that depend on this task)
SELECT
  d.dep_type,
  d.from_id,
  t.title,
  t.status,
  t.priority,
  t.assignee
FROM dependencies d
JOIN tasks t ON t.id = d.from_id
WHERE d.to_id = ?;

-- Step 4: fetch subtasks if this is an epic
SELECT id, title, status, priority, assignee
FROM tasks
WHERE parent_id = ?
ORDER BY priority ASC, created_at ASC;
```

### Claiming a Task Atomically

An agent calls this when picking up a task. The transaction ensures no two agents can claim the same task even under concurrent access (SQLite's serialized write lock enforces this).

```sql
-- Atomic claim: only succeeds if task is still open and unassigned
BEGIN IMMEDIATE;

UPDATE tasks
SET
  status    = 'in_progress',
  assignee  = ?,           -- agent identity, e.g. 'worker-1'
  updated_at = ?           -- current ISO timestamp
WHERE id = ?
  AND status = 'open'
  AND assignee IS NULL;

-- Check rows affected. If 0, another agent claimed it first.
-- Application code checks changes() and rolls back / retries if 0.

COMMIT;
```

In TypeScript using `better-sqlite3`:

```typescript
export function claimTask(
  db: Database,
  taskId: string,
  agentId: string,
): boolean {
  const now = new Date().toISOString();

  const result = db
    .prepare(
      `UPDATE tasks
       SET status = 'in_progress', assignee = ?, updated_at = ?
       WHERE id = ? AND status = 'open' AND assignee IS NULL`,
    )
    .run(agentId, now, taskId);

  return result.changes === 1; // false → someone else got it first
}
```

### All Tasks for a GitHub Issue

```sql
SELECT
  id,
  title,
  status,
  priority,
  type,
  assignee,
  created_at,
  updated_at
FROM tasks
WHERE github_issue = ?
ORDER BY priority ASC, created_at ASC;
```

### Dependency Tree (Recursive CTE)

Used by `forge dep tree <id>` to show the full transitive closure of dependencies.

```sql
-- Full dependency tree rooted at a given task ID
WITH RECURSIVE dep_tree(task_id, depth, path) AS (
  -- Anchor: the task itself
  SELECT ?, 0, ?

  UNION ALL

  -- Recursive step: follow 'blocks' edges outward
  SELECT
    d.to_id,
    dt.depth + 1,
    dt.path || ' → ' || d.to_id
  FROM dep_tree dt
  JOIN dependencies d ON d.from_id = dt.task_id
  WHERE d.dep_type = 'blocks'
    AND dt.depth < 10  -- cycle guard
)
SELECT
  dt.depth,
  dt.path,
  t.id,
  t.title,
  t.status,
  t.priority
FROM dep_tree dt
JOIN tasks t ON t.id = dt.task_id
ORDER BY dt.depth ASC, t.priority ASC;
```

---

## CLI Commands

All commands are invoked as `forge <command>` (the binary is the `forge` executable installed by the package). Every command that returns data supports `--json` for machine-readable output.

### `forge init`

Initialize a `.forge/` directory in the current git repository.

```bash
forge init [--prefix <prefix>] [--name <project-name>] [--stealth] [--branch <branch-name>]

# Examples
forge init
forge init --prefix myp --name "My Project"

# Stealth — fully local, invisible to teammates
forge init --stealth

# Branch — uses a separate git branch for forge data
forge init --branch forge-data
```

Actions:
1. Creates `.forge/config.json`, `.forge/tasks.jsonl`, `.forge/issues/`
2. Creates and makes executable `.forge/hooks/pre-commit` and `.forge/hooks/post-merge`
3. Symlinks hooks into `.git/hooks/`
4. Appends `.forge/forge.db*` to `.gitignore`
5. Runs the SQLite schema migration

**Stealth mode** (`--stealth`):
1. Creates `.forge/` directory as normal
2. Adds `.forge/` to `.git/info/exclude` (repo-local gitignore — not committed, not in `.gitignore`)
3. Does NOT install git hooks (no JSONL sync since nothing is committed)
4. SQLite works normally for local queries
5. JSONL is written but stays local (useful for backup/export)
6. All Forge commands work identically — agents cannot tell the difference

What you lose in stealth: no git-based sync or history for task data, no collaboration with other Forge users on the same repo, task data only exists on your machine.

What you keep: full task graph, all queries, all CLI commands, agent execution, dispatch, batches — everything works. Specs and PRDs in `.forge/issues/` are also gitignored (stealth is all-or-nothing).

**Upgrade path:**
```bash
# Switch from stealth to standard
forge init --upgrade
# This: removes .forge/ from .git/info/exclude,
# adds .forge/ tracking to git, installs hooks, commits
```

**Branch mode** (`--branch`) is a middle ground — your Forge data is in git (versioned, backed up) but on a separate branch that does not pollute `main`. Useful for teams where some people use Forge and others do not.

```json
// .forge/config.json (written by forge init)
{
  "name": "My Project",
  "idPrefix": "myp",
  "version": 1,
  "created_at": "2026-02-18T00:00:00.000Z"
}
```

---

### `forge task create`

```bash
forge task create "<title>" \
  [--type task|bug|feature|epic|message] \
  [--priority 0-4] \
  [--parent <id>] \
  [--assignee <identity>] \
  [--label <label>]... \
  [--github-issue <number>] \
  [--description "<markdown>"] \
  [--json]

# Examples
forge task create "Add user authentication" --type feature --priority 1
forge task create "Fix null pointer in parser" --type bug --priority 0 --label "crash" --github-issue 47
forge task create "Research rate limiting approaches" --type task --parent fg-e5a2
forge task create "Implement JWT middleware" --type task --priority 1 \
  --description "$(cat specs/jwt.md)" --json
```

Output (default):
```
Created task fg-a3f8: Add user authentication
```

Output (`--json`):
```json
{
  "id": "fg-a3f8",
  "title": "Add user authentication",
  "status": "open",
  "priority": 1,
  "type": "feature",
  "created_at": "2026-02-18T00:00:00.000Z"
}
```

---

### `forge task show`

```bash
forge task show <id> [--json]

# Examples
forge task show fg-a3f8
forge task show fg-a3f8 --json
```

Output (default): human-readable summary with dependency tree, subtasks, and metadata.

Output (`--json`): full Task object including resolved dependency objects and subtask list.

```json
{
  "id": "fg-a3f8",
  "title": "Add user authentication",
  "description": "## Summary\n...\n## Acceptance Criteria\n- ...",
  "status": "in_progress",
  "priority": 1,
  "type": "feature",
  "assignee": "worker-1",
  "parent_id": null,
  "dependencies": [
    {
      "id": "fg-b2c1",
      "type": "blocks",
      "resolved": {
        "title": "Implement hash-based ID generation",
        "status": "closed"
      }
    }
  ],
  "subtasks": [],
  "labels": ["auth"],
  "github_issue": null,
  "created_at": "2026-02-18T00:00:00.000Z",
  "created_by": "orchestrator",
  "updated_at": "2026-02-18T01:00:00.000Z",
  "closed_at": null,
  "metadata": {}
}
```

---

### `forge task update`

```bash
forge task update <id> \
  [--title "<title>"] \
  [--description "<markdown>"] \
  [--status open|in_progress|closed] \
  [--priority 0-4] \
  [--assignee <identity>|none] \
  [--label-add <label>] \
  [--label-remove <label>] \
  [--parent <id>|none] \
  [--github-issue <number>|none] \
  [--meta-set <key>=<value>] \
  [--json]

# Examples
forge task update fg-a3f8 --status in_progress --assignee worker-1
forge task update fg-a3f8 --priority 0 --label-add "urgent"
forge task update fg-a3f8 --assignee none           # release claim
forge task update fg-a3f8 --meta-set pr_url=https://github.com/org/repo/pull/9
```

---

### `forge task close`

```bash
forge task close <id> \
  [--reason "<reason>"] \
  [--json]

# Examples
forge task close fg-a3f8 --reason "Implemented in commit abc123"
forge task close fg-a3f8 --reason "cancelled: superseded by fg-d4e5"
forge task close fg-a3f8 --reason "duplicate:fg-c9d1"
```

Equivalent to `forge task update <id> --status closed` but enforces that `--reason` is provided (or prompts for it interactively). Sets `closed_at` to now.

---

### `forge ready`

```bash
forge ready [--assignee <identity>] [--type <type>] [--json]

# Examples
forge ready                          # all unblocked, unclaimed tasks
forge ready --json                   # JSON array, for agent consumption
forge ready --type feature           # only feature tasks
```

Output (`--json`): JSON array of Task objects, ordered by priority then `created_at`.

```json
[
  {
    "id": "fg-c9d1",
    "title": "SQLite schema and migration runner",
    "priority": 0,
    "type": "task",
    "labels": ["core", "sqlite"]
  }
]
```

---

### `forge dep add`

```bash
forge dep add <from-id> <to-id> [--type blocks|related|discovered-from] [--json]

# Examples
forge dep add fg-c9d1 fg-b2c1 --type blocks
# fg-c9d1 depends on fg-b2c1 (fg-b2c1 blocks fg-c9d1)

forge dep add fg-a3f8 fg-e5a2 --type related
forge dep add fg-f6g7 fg-a3f8 --type discovered-from
```

Adds a row to the `dependencies` table and updates `tasks.dependencies` JSON on the `from_id` task.

---

### `forge dep tree`

```bash
forge dep tree <id> [--depth <n>] [--json]

# Examples
forge dep tree fg-c9d1
forge dep tree fg-e5a2 --depth 5 --json
```

Output (default):
```
fg-c9d1  SQLite schema and migration runner  [in_progress]
  └─ blocks fg-b2c1  Implement hash-based ID generation  [closed]
```

Output (`--json`): recursive tree of `{ id, title, status, dep_type, children: [...] }`.

---

### `forge search`

```bash
forge search \
  [--status open|in_progress|closed] \
  [--type task|bug|feature|epic|message] \
  [--priority <n>] \
  [--assignee <identity>|none] \
  [--label <label>] \
  [--parent <id>] \
  [--github-issue <number>] \
  [--query "<text>"]  \
  [--json]

# Examples
forge search --status open --label "frontend"
forge search --status open --assignee none --priority 0   # unowned critical tasks
forge search --github-issue 47
forge search --query "authentication" --status open --json
forge search --assignee worker-1 --status in_progress     # what is worker-1 doing?
```

Text `--query` performs a case-insensitive `LIKE` match against `title` and `description`.

Output (`--json`): JSON array of matching Task objects.

---

### `forge export` and `forge import`

These are typically called only by git hooks, but are available directly:

```bash
forge export [--gc]     # SQLite → .forge/tasks.jsonl
forge import            # .forge/tasks.jsonl → SQLite (upsert, last-write-wins)
```

`--gc` on export deduplicates the JSONL file (one line per task) before writing. Safe to run at any time. Produces a smaller file with identical semantics.

---

## Agent Integration

### Contract

Agents interact with Forge exclusively through the CLI with `--json` flags. They never read `forge.db` directly and never write `tasks.jsonl` directly. This ensures the data plane is the same whether the consumer is a human or an automated agent.

### Lifecycle Pattern

A typical agent session follows this loop:

```typescript
// Pseudocode: agent main loop
async function agentLoop(agentId: string) {
  while (true) {
    // 1. Find something to work on
    const tasks = await forge('ready --json');
    if (tasks.length === 0) {
      console.log('No ready tasks. Waiting...');
      await sleep(30_000);
      continue;
    }

    const task = tasks[0];

    // 2. Claim it atomically
    await forge(`task update ${task.id} --status in_progress --assignee ${agentId} --json`);

    // 3. Verify we got it (another agent might have claimed it first)
    const claimed = await forge(`task show ${task.id} --json`);
    if (claimed.assignee !== agentId) {
      continue; // lost the race, try next
    }

    // 4. Do the work
    try {
      await doWork(task);
      await forge(`task close ${task.id} --reason "Completed by ${agentId}"`);
    } catch (err) {
      // 5. On failure: release the task so another agent can try
      await forge(`task update ${task.id} --status open --assignee none`);
      await forge(`task update ${task.id} --meta-set last_error="${err.message}"`);
    }
  }
}
```

### Shared Memory Between Sessions

The task graph is the persistent memory of the system. When an orchestrator agent creates tasks for a work session, those tasks survive:
- Process restarts
- Git merges from other branches
- Agent crashes
- Developer machine reboots

This is the core property that makes Forge useful: you can shut everything down, come back a week later, run `forge ready --json`, and the agent picks up exactly where it left off with full context in `description` and `metadata`.

### Discovered Work

When an agent discovers that completing its task requires additional work not yet in the graph, it creates new tasks before closing its own:

```bash
# Agent working on fg-a3f8 discovers it needs a new subtask
forge task create "Write unit tests for JWT middleware" \
  --type task \
  --priority 1 \
  --parent fg-a3f8 \
  --description "Discovered during implementation of fg-a3f8." \
  --json

# Link as discovered-from so the dependency is recorded
forge dep add fg-new1 fg-a3f8 --type discovered-from
```

### Metadata as Agent Scratchpad

The `metadata` field is the agent's scratchpad. It is a free-form JSON object that persists with the task. Agents use it to record intermediate results without needing schema changes:

```bash
forge task update fg-a3f8 \
  --meta-set spec_generated_at="2026-02-18T10:00:00.000Z" \
  --meta-set spec_path=".forge/issues/issue-12/spec.md" \
  --meta-set plan_approved=true \
  --meta-set pr_url="https://github.com/org/repo/pull/9"
```

---

## Config Schema

```typescript
export interface ForgeConfig {
  name: string;       // human-readable project name
  idPrefix: string;   // 2-4 lowercase alphanumeric chars, e.g. "fg"
  version: number;    // schema version, currently 1
  created_at: string; // ISO timestamp of forge init
  initMode?: 'standard' | 'stealth' | 'branch'; // default: 'standard'
  branchName?: string; // only used when initMode === 'branch'
  issueTracker?: {
    provider: 'github' | 'linear' | 'jira' | 'none'; // default: 'github'
    config: Record<string, unknown>; // provider-specific config
  };
  settings?: {
    gcOnExport?: boolean;        // default: true — deduplicate JSONL on export
    defaultPriority?: Priority;  // default: 2 (medium)
    defaultType?: TaskType;      // default: "task"
  };
}
```

---

## Multi-Repo Support

Forge supports orchestrating work across multiple repositories through a global home directory that sits above individual projects.

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

### Key Design Elements

1. **Forge home directory** (`~/.forge/`) — sits above individual projects, holds global config, agent identities, and cross-project batch tracking
2. **Project registration:** `forge project add <name> <path>` registers a repo
3. **ID prefix routing:** Each project gets a unique prefix (e.g., `pa-` for polaris-adventures, `fg-` for forge). Task IDs route to the correct project's database.
4. **Cross-project batches:** A batch can track tasks across multiple projects
5. **Agent mobility:** Agents can create worktrees in any registered project via `forge worktree <project>`

### Design-Now, Build-Later

The ID prefix system should be designed into Layer 1 from the start (the `config.json` `idPrefix` field). Everything else can be added later without breaking changes. Start single-repo; the prefix is just a nice namespace even for one project.

---

## Implementation Notes

**Library choices:**
- `better-sqlite3` — synchronous SQLite bindings for Node.js. Synchronous is correct here: the CLI is not a server, and synchronous SQLite is simpler and faster than async for this use case.
- No ORM. Raw SQL is the right choice for a system this close to the database.
- `commander` or `yargs` for CLI argument parsing.

**Error handling:**
- If `.forge/` does not exist, all commands fail with: `Not a Forge project. Run 'forge init' first.`
- If SQLite is locked (another process writing), `better-sqlite3` will retry for up to 5 seconds (configurable via `db.pragma('busy_timeout = 5000')`).
- If `tasks.jsonl` is malformed (invalid JSON on a line), `forge import` skips the line and logs a warning. It does not fail.

**Atomicity guarantee:**
- `forge task update` and `forge task close` run inside a SQLite transaction.
- The claim operation (`status = open AND assignee IS NULL`) is atomic at the SQLite level — SQLite's writer lock ensures no TOCTOU race even with multiple CLI processes.

**Rebuilding from scratch:**
- Delete `forge.db`. Run `forge import`. The database is fully reconstructed from `tasks.jsonl`. This is the recovery procedure for a corrupted database.

---

*See also: [Forge - Implementation Outline](./implementation-outline.md) for the overall system architecture, [Forge - Technical Decisions](./technical-decisions.md) for rationale on technology choices, and [Key Components of Agent Orchestration Systems](./key-components.md) for the conceptual background.*
