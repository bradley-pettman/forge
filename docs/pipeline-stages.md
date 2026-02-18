# Forge — Pipeline Stages

> The structured pipeline that transforms vague requirements into merged PRs.

Related: [[Forge - Implementation Outline]] | [[Forge - Technical Decisions]] | [[Forge - Data Plane Design]]

---

## Overview

Forge's pipeline has 6 stages. The first 3 are collaborative (human + agent), the last 3 are increasingly automated. Each stage produces a concrete artifact that feeds the next.

```
GitHub Issue (vague)
  Stage 1 → PRD (.forge/specs/issue-<n>-prd.md)
  Stage 2 → Technical Spec (.forge/specs/issue-<n>-spec.md)
  Stage 3 → Task Graph (forge tasks with dependencies)
  Stage 4 → Completed Branches (parallel agent work)
  Stage 5 → Feature Branch (merge queue output)
  Stage 6 → Merged PR
```

The first three stages are the planning pipeline — they map to Layers 0 and 1 in [[Forge - Implementation Outline]] and can deliver value immediately even before the execution machinery (Layers 2–4) exists. The final three stages are the execution pipeline, where agents work autonomously with minimal developer involvement.

Each stage transition is explicit: the developer runs a command to advance to the next stage, or automation handles it when a stage completes. There are no hidden state machines.

---

## Stage 1: PRD Refinement

**Input:** A GitHub Issue (often vague or incomplete)
**Output:** A PRD document at `.forge/specs/issue-<number>-prd.md`
**Mode:** Interactive dialogue between human and agent
**CLI entry point:** `forge refine <github-issue-number>`

### How It Works

The developer invokes `forge refine` with a GitHub Issue number. Forge uses `gh issue view <number> --json title,body,labels,comments` to pull the full issue context, then launches a Claude Code agent session pre-loaded with:

1. The raw issue content
2. A read of the relevant parts of the codebase (determined by the agent via grep/glob)
3. A structured interview prompt that guides the agent to ask the right questions

The agent conducts a conversational interview — not a rigid form, but a dialogue that adapts based on the developer's answers. The goal is to surface everything that matters before a single line of code is written.

```bash
forge refine 847
# Pulls issue #847 from GitHub
# Reads the codebase for relevant context
# Starts an interactive dialogue session
# Saves output to .forge/specs/issue-847-prd.md
# Commits the file with: git commit -m "forge: add PRD for issue #847"
```

### What the Agent Asks

The agent is prompted to cover these areas, but in a natural conversational order:

- **Problem restatement** — "Let me make sure I understand what you're trying to solve..." (catches misunderstandings early)
- **User stories** — who does this, in what context, what do they need
- **Acceptance criteria** — what does done look like, what are the edge cases
- **Scope clarification** — what is explicitly out of scope for this issue
- **Existing code relevance** — "I see you have a `useDateRange` hook in `packages/polaris-adventures-js` — should this feature use that?"
- **Dependencies** — does this block or get blocked by other work
- **Open questions** — things that need a decision before coding starts

The agent has codebase access via its standard tool suite — it should grep for related components, read existing similar features, and ask informed questions based on what it finds. A generic interview that ignores the codebase is not acceptable output.

### PRD Output Format

The PRD is a markdown file with consistent section structure so Stage 2 can parse it programmatically:

```markdown
# PRD: <Issue Title>

**Issue:** #<number> — <link>
**Date:** <ISO date>
**Status:** draft | approved

---

## Problem Statement

<2–3 paragraphs describing the problem being solved and why it matters>

---

## User Stories

- As a <role>, I want to <action> so that <outcome>
- As a <role>, I want to <action> so that <outcome>

---

## Acceptance Criteria

- [ ] <specific, testable criterion>
- [ ] <specific, testable criterion>
- [ ] <specific, testable criterion>

---

## Out of Scope

- <thing that could be confused as in scope but is not>
- <future enhancement to acknowledge but defer>

---

## Existing Code Context

<Notes on relevant existing code the agent identified — components, hooks, schemas, patterns that this feature should interact with or follow>

---

## Open Questions

- [ ] <question that needs a decision> — **Decision:** <filled in during review>
- [ ] <question that needs a decision> — **Decision:** <filled in during review>

---

## Notes from Refinement Session

<Anything else captured during the dialogue that doesn't fit the above sections>
```

The `---` section delimiters and consistent heading names are important for Stage 2 parsing. Do not vary these.

### Key Design Details

- The agent must have codebase access. A PRD written without knowing what already exists produces bad specs.
- The interview should be conversational. The agent should react to answers, not just proceed through a checklist.
- Open Questions should be resolved before moving to Stage 2. If they can't be, they should be documented with a clear owner.
- The PRD is committed to git. This makes it reviewable, diff-able, and part of the permanent record.
- The developer can re-run `forge refine` to continue an in-progress session or produce a revised draft.

---

## Stage 2: Technical Spec

**Input:** A PRD from Stage 1
**Output:** A technical spec at `.forge/specs/issue-<number>-spec.md`
**Mode:** Agent-driven with human review
**CLI entry point:** `forge spec .forge/specs/issue-<number>-prd.md`

### How It Works

The developer runs `forge spec` pointing at the PRD file. An agent reads the PRD, then explores the codebase to understand the implementation landscape, and drafts a technical spec. This is not an interactive interview — the agent works through the codebase on its own, then presents the spec for developer review.

```bash
forge spec .forge/specs/issue-847-prd.md
# Agent reads the PRD
# Agent explores codebase: greps for relevant files, reads existing patterns
# Agent drafts the spec
# Saves to .forge/specs/issue-847-spec.md
# Opens the spec in $EDITOR for developer review
# Developer can iterate with the agent in the same session
```

After the initial draft is produced, the developer can review inline and request changes. The agent stays in session so the developer can say "the API change section is wrong — we're not changing that endpoint, we're adding a new one" and the spec gets updated before being committed.

### Monorepo Context

The work monorepo is a pnpm monorepo managed with Turborepo. The spec agent needs to understand the package structure to produce useful output:

```
apps/
  admin-web/          — Internal admin interface
  outfitter-web/      — Outfitter-facing app
  customer-web/       — Customer-facing app
  backend/            — API server
  serverless-functions/

packages/
  polaris-adventures-js/  — Shared code: zod schemas, types, utilities
  <other shared packages>
```

Features typically touch 1–3 modules. A feature that adds a new booking type might touch `polaris-adventures-js` (schema), `backend` (route + handler), and `customer-web` (UI). The spec agent should identify exactly which packages are affected and what changes each needs.

### Spec Output Format

```markdown
# Technical Spec: <Issue Title>

**Issue:** #<number>
**PRD:** [[issue-<number>-prd]]
**Date:** <ISO date>
**Author:** forge/spec-agent

---

## Summary

<1 paragraph: what this feature does technically>

---

## Affected Packages and Files

| Package | Files | Change Type |
|---|---|---|
| `packages/polaris-adventures-js` | `src/schemas/booking.ts` | Modified |
| `apps/backend` | `src/routes/bookings.ts`, `src/handlers/bookings/createBooking.ts` | Modified |
| `apps/customer-web` | `src/pages/booking/NewBookingPage.tsx`, `src/components/booking/BookingForm.tsx` | Modified |

---

## Data Model Changes

<Describe any schema changes. Include before/after zod schemas or TypeScript types if relevant.>

### Example

```typescript
// packages/polaris-adventures-js/src/schemas/booking.ts
// BEFORE
export const BookingSchema = z.object({
  id: z.string(),
  type: z.enum(['guided', 'self-guided']),
  // ...
})

// AFTER — adds 'private-charter' type
export const BookingSchema = z.object({
  id: z.string(),
  type: z.enum(['guided', 'self-guided', 'private-charter']),
  charterDetails: z.object({ ... }).optional(),
  // ...
})
\```

---

## API Changes

<Describe new endpoints, modified endpoints, or removed endpoints. Include request/response shapes.>

---

## Component Hierarchy

<For UI changes, describe the component tree and where new components fit.>

---

## State Management

<Describe any state changes: new context, new hooks, new stores, or query changes.>

---

## Implementation Patterns

<Reference existing code that sets the pattern this feature should follow.>

- Booking creation follows the pattern in `apps/backend/src/handlers/bookings/createBooking.ts` — follow that structure for the new handler.
- Use `useBookingQuery` from `apps/customer-web/src/hooks/useBookingQuery.ts` as the model for the new query hook.

---

## Testing Strategy

- Unit tests: <what to test at the unit level>
- Integration tests: <API-level tests if applicable>
- E2E: <whether E2E tests are needed and what scenario to cover>
- Test files to create or modify: <explicit file paths>

---

## Migration and Rollout

<Any DB migrations, feature flags, deployment ordering considerations.>

---

## Out of Scope (from PRD)

<Restate the out-of-scope items here so they aren't accidentally implemented.>

---

## Open Questions

<Any remaining technical questions not resolved in the PRD. These must be resolved before decomposition.>
```

### Key Design Details

- The spec agent must read existing code, not just the PRD. The most common spec failure is an agent that specifies a new abstraction when a suitable one already exists.
- File paths in the spec should be accurate and verified by the agent. The spec is the source of truth for Stage 3 decomposition.
- The spec is reviewed by the developer before moving to Stage 3. This is the last human checkpoint before automated execution begins.
- Open Questions in the spec must be resolved. If they aren't, Stage 3 will produce incorrect task decompositions.

---

## Stage 3: Task Decomposition

**Input:** A technical spec from Stage 2
**Output:** Forge tasks in the task graph (with dependencies)
**Mode:** Agent-driven with human approval
**CLI entry point:** `forge decompose .forge/specs/issue-<number>-spec.md`

### How It Works

The developer runs `forge decompose` pointing at the spec. An agent reads the spec and creates a set of Forge tasks with proper dependency ordering. The developer then reviews the task graph and approves or adjusts before execution begins.

```bash
forge decompose .forge/specs/issue-847-spec.md
# Agent reads the spec
# Creates an epic linked to GitHub Issue #847
# Creates child tasks with dependencies
# Prints the proposed task graph for review

forge dep tree fg-a1b2   # Review the epic's task tree
# ├── fg-a1b2 [epic] "Add private charter booking type" (#847)
# │   ├── fg-c3d4 [ready] "Add private-charter to BookingSchema zod type"
# │   ├── fg-e5f6 [blocked: fg-c3d4] "Add charterDetails optional field to BookingSchema"
# │   ├── fg-g7h8 [blocked: fg-c3d4,fg-e5f6] "Add createPrivateCharterBooking backend handler"
# │   ├── fg-i9j0 [blocked: fg-g7h8] "Add POST /bookings/charter API route"
# │   └── fg-k1l2 [blocked: fg-i9j0] "Add PrivateCharterBookingForm UI component"

forge decompose --approve fg-a1b2  # Approve and make tasks available for execution
```

### Task Granularity

The right task size is roughly "one agent session, one logical change." Concretely:

**Good task granularity:**
- "Add `private-charter` to the `BookingType` zod enum in `packages/polaris-adventures-js/src/schemas/booking.ts`"
- "Create `usePrivateCharterBooking` query hook in `apps/customer-web/src/hooks/`"
- "Write unit tests for `createPrivateCharterBooking` handler"

**Too large:**
- "Implement the private charter booking feature"
- "Update the backend to support charter bookings"

**Too small:**
- "Add an import statement"
- "Update one line in the schema"

A useful heuristic: if the task description alone (without the spec) gives an agent enough context to execute it correctly, it's the right size. If the agent would need to read the full spec to understand what to do, the task is probably too vague.

### Dependency Ordering

Tasks must be ordered so foundational changes come before consuming code. The standard ordering for the monorepo:

1. **Shared schemas and types** (`packages/polaris-adventures-js`) — zod schemas, TypeScript types, shared utilities
2. **Database/migration changes** — if any
3. **Backend handlers and business logic** — the implementation
4. **API routes** — wire handlers to routes
5. **Shared hooks and query logic** — data fetching layer
6. **UI components** — consume the hooks
7. **Page composition** — assemble components into pages
8. **Tests** — unit and integration tests (can run in parallel with UI work once the API is done)

Violating this order causes agents to fail because the types they're importing don't exist yet.

### Task Data Structure

Each task created by decomposition includes:

```json
{
  "id": "fg-c3d4",
  "parentId": "fg-a1b2",
  "title": "Add private-charter to BookingSchema zod type",
  "description": "In `packages/polaris-adventures-js/src/schemas/booking.ts`, add 'private-charter' to the BookingType enum. Also add an optional `charterDetails` field with the shape defined in the spec. Run `pnpm turbo test --filter=polaris-adventures-js` to verify. See spec: .forge/specs/issue-847-spec.md#data-model-changes",
  "status": "ready",
  "dependencies": [],
  "sourceSpec": ".forge/specs/issue-847-spec.md",
  "sourceIssue": 847,
  "acceptanceCriteria": [
    "BookingType enum includes 'private-charter'",
    "charterDetails field is present and optional",
    "All existing tests pass",
    "TypeScript compiles without errors"
  ],
  "affectedPackages": ["packages/polaris-adventures-js"],
  "createdAt": "2026-02-18T10:00:00Z"
}
```

The `description` field must be self-contained. An agent assigned this task should be able to execute it correctly from the description alone, without reading the full spec.

### Key Design Details

- The epic (parent task) is linked to the GitHub Issue number. This is the traceability chain: PR → epic → GitHub Issue.
- Human approval is required before tasks become executable. The developer runs `forge decompose --approve <epic-id>` to release the tasks into the ready queue.
- The developer can adjust task boundaries before approving. If the decomposition is wrong (tasks are too big, dependencies are incorrect), the developer can edit task descriptions and dependency edges before approval.
- Task descriptions must be self-contained. This is the most important quality check. An agent should not need to read the spec to execute a task — the task description should include the specific files, the specific change, and the acceptance criteria.

---

## Stage 4: Parallel Execution

**Input:** Ready tasks from the task graph
**Output:** Completed work on git branches
**Mode:** Fully automated (agents work autonomously)
**CLI entry point:** `forge run <epic-id>` or `forge ready` + manual assignment

### How It Works

Once tasks are approved, the execution loop begins. Forge identifies ready tasks (those with no unresolved dependencies) and assigns them to available worker agents. Each worker gets its own git worktree so they don't interfere with each other.

```bash
forge run fg-a1b2          # Start execution of all tasks in the epic
forge ready                # List all unblocked, unassigned tasks
forge status               # Overview of all agents and their current tasks
forge attach worker-1      # Jump into a worker's tmux session to observe or unblock
```

Each worker agent operates in this cycle:

```bash
# Worker agent startup sequence
forge hook                 # Read my current assignment
# → Assigned: fg-c3d4 "Add private-charter to BookingSchema zod type"

git worktree add .forge/worktrees/fg-c3d4 -b forge/fg-c3d4
cd .forge/worktrees/fg-c3d4

# Execute the task...
# (agent reads task description, makes changes, runs tests)

pnpm turbo test --filter=polaris-adventures-js   # Run tests for affected packages only
git add -p && git commit -m "forge(fg-c3d4): add private-charter to BookingSchema"
forge task close fg-c3d4 --branch forge/fg-c3d4  # Mark complete, submit to merge queue
forge mq submit fg-c3d4 forge/fg-c3d4             # Push branch to merge queue
```

### Worktree Isolation

Each task gets its own git worktree at `.forge/worktrees/<task-id>/`. This means:

- Multiple agents can work simultaneously without file conflicts
- Each worktree is on its own branch (`forge/<task-id>`)
- Workers can run tests independently without interfering with each other's test output
- Cleanup is simple: `git worktree remove .forge/worktrees/<task-id>` after merging

### Running Tests

Workers run the monorepo's test suite scoped to their affected packages using Turborepo filtering:

```bash
pnpm turbo test --filter=polaris-adventures-js         # Test one package
pnpm turbo test --filter=backend --filter=polaris-adventures-js  # Test two packages
pnpm turbo build --filter=customer-web...              # Build customer-web and its dependencies
```

The task's `affectedPackages` field tells the worker exactly which packages to test. Workers should not run the full monorepo test suite — that's slow and unnecessary for scoped changes.

### Escalation

If a worker gets stuck — the task description is ambiguous, there's a conflict with existing code, or tests won't pass after reasonable attempts — it should escalate rather than spin indefinitely:

```bash
forge task update fg-c3d4 --note "Cannot resolve: the existing BookingType enum is imported in 14 files that use exhaustive switch statements. Updating the enum will break type-checking in those files. This task needs to be split or the spec needs to clarify whether those call sites should be updated too."
forge task escalate fg-c3d4
```

An escalated task is flagged in `forge status` for the developer to review. The worker moves on (if there's other work available) or waits for unblocking input.

### The Propulsion Principle

Workers do not wait for instructions between tasks. When a task is complete, the worker immediately checks for the next ready task in its epic:

```bash
forge ready --epic fg-a1b2    # Any more tasks ready?
forge sling fg-e5f6 worker-1  # Pick up the next task
```

This is the propulsion principle from Layer 2 of [[Forge - Implementation Outline]]: agents keep moving without manual nudging. The coordinator (or the developer) doesn't need to hand-hold each transition.

### Key Design Details

- Workers operate in isolated git worktrees — never on the main branch, never in the project root.
- Test scope is determined by `affectedPackages` in the task definition. Workers do not run full suite tests.
- Escalation is a first-class operation. Getting stuck and escalating is correct behavior; spinning in circles is not.
- The developer monitors via `forge status` but should not need to intervene unless a task is escalated.

---

## Stage 5: Merge Queue

**Input:** Completed branches from workers
**Output:** A single clean feature branch with all changes integrated
**Mode:** Automated (dedicated Merge Processor agent)
**CLI:** `forge mq list`, `forge mq process`

### How It Works

As workers complete tasks, their branches are submitted to the merge queue. A dedicated Merge Processor agent processes the queue sequentially, merging branches onto the feature branch in dependency order.

```bash
forge mq list
# Merge queue for epic fg-a1b2:
# 1. fg-c3d4  forge/fg-c3d4  [schema change]         READY TO MERGE
# 2. fg-e5f6  forge/fg-e5f6  [schema change]         WAITING (depends on fg-c3d4)
# 3. fg-g7h8  forge/fg-g7h8  [backend handler]       WAITING (depends on fg-e5f6)
# 4. fg-i9j0  forge/fg-i9j0  [API route]             WAITING (depends on fg-g7h8)
# 5. fg-k1l2  forge/fg-k1l2  [UI component]          WAITING (depends on fg-i9j0)

forge mq process fg-a1b2   # Merge Processor agent begins working through the queue
```

### Merge Order

The Merge Processor respects task dependencies when ordering merges. Foundational changes (schemas, shared types) are merged before the code that consumes them. This ensures that after each merge, the feature branch is in a buildable, testable state.

The feature branch is named `forge/epic-<epic-id>` (e.g., `forge/epic-fg-a1b2`) and is created fresh at the start of merge processing, branching from main.

### Merge Process Per Branch

For each branch in the queue:

```bash
git checkout forge/epic-fg-a1b2       # On the feature branch
git merge --no-ff forge/fg-c3d4       # Attempt merge
pnpm turbo build --filter=<affected>  # Verify it builds
pnpm turbo test --filter=<affected>   # Run tests
# If all green: proceed to next branch
# If conflicts or failures: attempt auto-resolution, then escalate
```

### Conflict Resolution

The Merge Processor is not just running `git merge`. It understands code semantics:

- **Non-overlapping changes:** Merge automatically. Two agents editing different functions in the same file is not a real conflict — git's line-level merge handles it.
- **Semantic conflicts:** Two agents both modified the same function or schema in incompatible ways. The Merge Processor reads both versions, understands the intent of each (from the task descriptions), and produces a merged version that satisfies both.
- **Irreconcilable conflicts:** Genuinely contradictory changes (e.g., one agent deleted a function another agent is calling). The Merge Processor escalates to the developer with a clear explanation of what's in conflict and why it can't be auto-resolved.

```bash
forge mq escalate fg-g7h8 --reason "Conflict in createBooking.ts: worker fg-g7h8 added a new parameter to createBooking() but worker fg-c3d4's schema changes require a different signature. Manual resolution required."
```

### Integration Testing

After each branch is merged, the Merge Processor runs integration tests scoped to the affected packages. If a merge breaks something that the branch's own tests didn't catch, the Merge Processor:

1. Identifies which merge introduced the regression (binary search if needed)
2. Escalates with a clear diagnosis
3. Does not proceed to merge more branches until the regression is resolved

### Key Design Details

- Merges are sequential, not parallel. This avoids compound conflicts that are harder to diagnose.
- The feature branch is always in a buildable state after each merge. A broken feature branch is escalated immediately, not carried forward.
- Merge order follows task dependency order. The spec defined the dependencies; the merge queue respects them.
- The Merge Processor is a dedicated agent role, not the coordinator. It has a specific prompt template tuned for conflict understanding and resolution.

---

## Stage 6: PR and Review

**Input:** A clean feature branch from the merge queue
**Output:** A merged PR
**Mode:** Semi-automated (agent creates PR, human reviews)
**CLI:** `forge pr create <epic-id>`

### How It Works

Once the merge queue is empty and the feature branch is clean, Forge creates a PR via `gh pr create`. The PR is structured to give reviewers everything they need without having to dig through individual commits.

```bash
forge pr create fg-a1b2
# Creates PR from forge/epic-fg-a1b2 → main
# Generates structured PR description (see below)
# Runs pre-review checks
# Outputs PR URL
```

### PR Description Structure

The PR description is generated from the spec, the task graph, and the commit history. It should give a reviewer everything they need without reading every line of code:

```markdown
## Summary

<1–2 paragraph summary of what this PR does and why, derived from the PRD>

Closes #847

---

## What Changed

### packages/polaris-adventures-js
- Added `private-charter` to `BookingType` enum
- Added optional `charterDetails` field to `BookingSchema`

### apps/backend
- New handler: `createPrivateCharterBooking` in `src/handlers/bookings/`
- New route: `POST /bookings/charter` in `src/routes/bookings.ts`

### apps/customer-web
- New component: `PrivateCharterBookingForm`
- Updated `NewBookingPage` to include charter option

---

## Tasks Completed

| Task | Description |
|---|---|
| fg-c3d4 | Add private-charter to BookingSchema zod type |
| fg-e5f6 | Add charterDetails optional field to BookingSchema |
| fg-g7h8 | Add createPrivateCharterBooking backend handler |
| fg-i9j0 | Add POST /bookings/charter API route |
| fg-k1l2 | Add PrivateCharterBookingForm UI component |

---

## Implementation Notes

<Notable decisions made during implementation. Anything a reviewer might wonder "why did they do it this way?" gets explained here.>

---

## Testing

- Unit tests added for `createPrivateCharterBooking` handler
- Schema tests updated in `packages/polaris-adventures-js`
- See test files: `apps/backend/src/handlers/bookings/__tests__/createPrivateCharterBooking.test.ts`

---

## Spec

Full technical spec: `.forge/specs/issue-847-spec.md`
PRD: `.forge/specs/issue-847-prd.md`

---

*Generated by Forge | Epic fg-a1b2 | 5 tasks | Issue #847*
```

### Pre-Review Checks

Before creating the PR, an agent runs a pre-review pass to catch common issues:

- TypeScript compiles without errors across all affected packages
- All tests pass (`pnpm turbo test --filter=<affected packages>`)
- No `console.log` statements left in production code
- No commented-out code blocks
- No TODO comments that should have been resolved
- Test coverage for new handlers/functions

If pre-review finds issues, they are fixed before the PR is created. The developer sees a clean PR.

### Human Review

The principal engineer reviews the PR. The review is aided by:

- The structured PR description (understands the what and why at a glance)
- The link to the spec (understands the full technical design)
- The link to the PRD (understands the user intent)
- Clean, logically-ordered commits (one per task, in dependency order)

On approval, the PR is merged via the normal GitHub merge process. CI runs automatically on the PR.

### Key Design Details

- The PR description is the human-readable summary of everything that happened in the pipeline. It should be comprehensive enough that someone could understand the change without reading every commit.
- Pre-review checks are not optional. A PR that doesn't compile or has failing tests should not reach the developer for review.
- Each commit in the PR corresponds to one task. This makes `git blame` and `git bisect` work correctly after merge.
- The PR links to the spec and PRD. The full context is always one click away.

---

## Stage Transitions

Each transition has an explicit trigger, and the developer's role changes as the pipeline progresses:

| Stage | Transition | Trigger | Developer Role |
|---|---|---|---|
| Issue | → PRD | `forge refine <issue>` | Active participant in dialogue |
| PRD | → Spec | `forge spec <prd-file>` | Review and iterate with agent |
| Spec | → Tasks | `forge decompose <spec-file>` | Approve task graph |
| Tasks | → Execution | `forge run <epic-id>` | Monitor; unblock escalations |
| Execution | → Merge | Automatic (task completion) | Resolve merge conflicts if escalated |
| Merge | → PR | Automatic (queue empty) | Review and approve PR |

The developer's involvement is front-loaded. The planning stages (1–3) require active engagement because the quality of the output depends on the quality of the input. By the time execution begins (Stage 4), the developer should be able to step away and let the system run.

---

## The "Ralph Wiggum" Loop

Once tasks exist in the approved graph, the execution engine runs a simple loop. Named after the characterization of agents that just happily pick up the next task without needing direction, it is the core of Stage 4 and the heart of Layer 4 in [[Forge - Implementation Outline]]:

```
while (forge ready --epic <epic-id> has tasks):
  task = pick highest priority ready task
  claim task (forge task claim <id>)
  create worktree (git worktree add .forge/worktrees/<id> -b forge/<id>)
  execute task (agent reads description, implements changes)
  run tests (pnpm turbo test --filter=<affected packages>)

  if tests pass:
    commit changes
    forge task close <id>
    forge mq submit <id> forge/<id>
  else if retry count < 3:
    retry with notes on what failed
  else:
    forge task escalate <id> --note "Failed after 3 attempts: <reason>"
    pick up next ready task if available
    wait for unblocking input
```

Multiple agents running this loop in parallel, against the same task graph, is the "factory." Each agent is independently simple — it just runs the loop. The coordination happens at the task graph level (dependency tracking, status transitions, the merge queue), not at the agent level. Agents don't need to know about each other; they only need to know about their task.

This is why the task graph design (Layer 1 in [[Forge - Implementation Outline]], detailed in [[Forge - Data Plane Design]]) is the critical foundation. Without a reliable, concurrent-safe task graph, the execution loop falls apart. With it, adding more agents is just a matter of running more loops.

---

## Artifact Summary

Each stage produces a durable artifact committed to the repository:

| Stage | Artifact | Location |
|---|---|---|
| PRD Refinement | `issue-<n>-prd.md` | `.forge/specs/` |
| Technical Spec | `issue-<n>-spec.md` | `.forge/specs/` |
| Task Decomposition | Task graph records | `.forge/tasks.jsonl` |
| Parallel Execution | Git branches | `forge/<task-id>` |
| Merge Queue | Feature branch | `forge/epic-<epic-id>` |
| PR and Review | Merged PR | GitHub |

The artifact chain is the audit trail. At any point you can answer: what was the original intent? (PRD), how was it designed? (spec), what was built? (task graph + branches), and what shipped? (PR). No context is lost between stages.
