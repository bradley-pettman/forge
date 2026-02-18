# Key Components of Agent Orchestration Systems

> A detailed analysis of the architectural components required to build a multi-agent orchestration system, drawn from studying Steve Yegge's Gas Town and generalized for broader application.

---

## 1. Persistent Work Tracking (The Data Plane)

### The Problem
AI coding agents operate in ephemeral sessions. When a session crashes, runs out of context, or simply ends, all in-flight state is lost. An orchestrator needs a durable substrate for all work, identity, and coordination data that survives any individual agent session.

### The Solution: A Git-Backed Work Graph
The foundation of any orchestration system is a **persistent, version-controlled work tracker** that agents can both read and write. This serves as both the data plane and control plane.

**Core properties:**
- **Atomic work units** — Issues/tasks with IDs, descriptions, statuses, assignees, priorities, and dependency relationships. In Gas Town these are called "Beads" — JSONL records stored in git.
- **Hash-based IDs** — Prevents merge collisions when multiple agents create work concurrently across branches (e.g., `bd-a1b2` rather than sequential integers).
- **Dependency tracking** — Parent-child relationships (epics), blocking relationships, and cross-references between work items.
- **Git-native storage** — All work state is committed to git, giving you full history, branching, and merge semantics for free. The work graph travels with the code.
- **Semantic compaction** — Old closed items get summarized to preserve context window space while retaining historical knowledge.

**Why not a database?** Git provides distributed, conflict-aware versioning that agents already understand. Every agent already knows how to `git commit` and `git push`. A database would require a separate server, connection management, and conflict resolution layer. Git gives you all of this as infrastructure agents are already working with.

**Key commands the system needs:**
| Operation | Purpose |
|-----------|---------|
| `create` | File a new work item |
| `ready` | List unblocked, available work |
| `update --claim` | Atomically assign and start a task |
| `show` | Full audit trail for an item |
| `close` | Mark work complete |
| `dep add` | Link dependencies between items |

---

## 2. The MEOW Stack (Molecular Expression of Work)

### The Problem
Simple flat task lists break down at scale. You need composable, durable workflow representations that can survive agent crashes, express complex multi-step processes, and be instantiated from reusable templates.

### The Hierarchy of Work Abstraction

The MEOW stack represents a discovery about how to layer work representations from concrete to abstract:

```
Formulas (TOML templates — source form)
    ↓ "cook"
Protomolecules (frozen templates — ready to instantiate)
    ↓ "pour"
Molecules (active workflows — agents walk these step by step)
    ↓ complete
Digests (condensed summary of completed workflow)
```

#### Layer 1: Work Items (Beads)
The atomic unit. A single issue with an ID, description, status, assignee. These are the nodes in the work graph.

#### Layer 2: Epics
Work items with children. Children are parallel by default but can have explicit dependencies to force sequencing. Epics can nest — an epic's children can themselves be epics. This gives you top-down planning trees.

#### Layer 3: Molecules
**The key innovation.** Molecules are *workflows* — chains of work items with explicit ordering and dependencies that an agent walks through step by step. Unlike epics (which are plans), molecules are *executable processes*.

Properties of molecules:
- **Durable** — Every step is a persistent work item in git. If an agent crashes mid-molecule, the next agent picks up at the exact step where work stopped.
- **Composable** — Molecules can be stitched together at runtime. You can wrap any workflow with additional review/test steps.
- **Observable** — As agents claim and close steps, it produces a live activity feed automatically.
- **Navigable** — Agents use commands like `mol current` to find their position and `close --continue` to advance atomically.

**Molecule vs. Epic:** Epics describe *what* needs to be done (a plan). Molecules describe *how* to do it (a process). An epic might say "implement auth." A molecule would say "step 1: design schema, step 2: implement models, step 3: write tests, step 4: code review."

#### Layer 4: Wisps (Ephemeral Molecules)
Molecules for orchestration overhead — patrol cycles, health checks, routine maintenance. Wisps exist in the database and function like regular molecules, but are *not* persisted to git. When complete, they're "burned" (destroyed) or optionally squashed into a one-line digest.

**Why wisps matter:** Without them, every patrol cycle from every supervisor agent would pollute the git history with orchestration noise. Wisps give you transactional workflow guarantees without the storage overhead.

#### Layer 5: Formulas
TOML-format source templates for workflows. Formulas support:
- **Variable substitution** — Parameterize workflows for different contexts
- **Composition** — Combine formulas (e.g., wrap any workflow with a "Rule of Five" review formula)
- **Loops and gates** — Turing-complete workflow definitions
- **Three-tier resolution** — Project-level > Town-level > System-level defaults

Formulas are "cooked" into protomolecules (frozen, ready-to-instantiate templates), then "poured" into active molecules.

---

## 3. Agent Identity and Attribution

### The Problem
When you have 20+ agents working simultaneously, you need to know who did what, track performance over time, and route work to capable agents. Without persistent identity, every agent session is a black box.

### The Solution: Persistent Agent Identities

Every agent in the system has a **persistent identity** that is separate from its ephemeral session. This is a critical architectural distinction:

| Layer | What it is | Lifecycle | Persistence |
|-------|-----------|-----------|-------------|
| **Identity** | Agent record, work history, capabilities | Permanent | Survives all sessions |
| **Sandbox** | Git worktree, branch, hook assignment | Per-task | Created on assignment, destroyed on completion |
| **Session** | The actual AI context window | Per-interaction | Cycles on handoff or crash |

**Identity format:** Slash-separated, role-based naming (e.g., `project/crew/alice`, `project/polecats/toast`, `mayor`).

**Attribution chain:** Every action is traceable:
- Git commits carry agent name + human owner email
- Work items record `created_by` and `updated_by`
- Event logs include actor identity

**The "agents execute, humans own" principle:** The agent is the *author* of work, but the human *owns* it. This distinction matters for accountability, compliance, and trust.

**Capability ledger:** Completed work accumulates into an agent's permanent record (a "CV"), enabling data-driven decisions about routing and model selection.

---

## 4. Worker Role Taxonomy

### The Problem
A flat pool of identical agents doesn't scale. Different responsibilities require different prompting, authority levels, and lifecycle management. You need specialization.

### The Solution: Well-Defined Worker Roles

An orchestration system needs two categories of roles:

#### Infrastructure Roles (System Management)

| Role | Scope | Purpose | Gas Town Name |
|------|-------|---------|---------------|
| **Coordinator** | Global | Your primary interface. Concierge and chief-of-staff. Routes work, kicks off workflows. | Mayor |
| **Supervisor Daemon** | Global | Background health monitor. Runs continuous patrol loops. Propagates heartbeats downward. | Deacon |
| **Worker Monitor** | Per-project | Watches ephemeral workers, detects stalls/zombies, nudges stuck agents, handles cleanup. | Witness |
| **Merge Processor** | Per-project | Manages the merge queue. Intelligently merges changes one at a time. Handles rebase conflicts. | Refinery |
| **Daemon Helpers** | Global | Short-lived assistants for the supervisor daemon. Handle maintenance, plugins, and investigations so the daemon stays focused on its patrol loop. | Dogs |

#### Worker Roles (Project Work)

| Role | Scope | Purpose | Gas Town Name |
|------|-------|---------|---------------|
| **Ephemeral Workers** | Per-project | Spin up on demand, work in swarms, produce merge requests, then get fully decommissioned. Identity persists; sessions don't. | Polecats |
| **Persistent Workers** | Per-project | Long-lived agents you interact with directly. Great for design work, back-and-forth collaboration. You choose their names. | Crew |

**Key insight: The human is also a role.** The human operator ("Overseer") has an identity in the system, an inbox, and can send/receive messages. You're the product manager — the system is an "idea compiler."

#### Ephemeral Worker Lifecycle

Ephemeral workers exist in exactly three states:
1. **Working** — Actively executing assigned tasks
2. **Stalled** — Session interrupted, work incomplete (needs nudge or restart)
3. **Zombie** — Finished work but failed to exit cleanly (needs cleanup)

There is no idle pool. A non-working ephemeral worker indicates a failure state, not a waiting state.

---

## 5. The Propulsion Principle

### The Problem
AI agents are polite. They wait for user input. In an orchestration system with dozens of agents, you cannot manually kick each one every time it starts a new session. You need agents that drive themselves forward autonomously.

### The Solution: "If there is work on your hook, YOU MUST RUN IT"

This is the core autonomy principle. Every agent has a **hook** — a designated slot where work is assigned. On startup (or restart), the agent checks its hook and immediately begins working on whatever is there. No waiting for confirmation.

**The hook mechanism:**
- Each agent has a persistent hook (a special work item in the data plane)
- Work is "slung" onto the hook via a dispatch command
- On startup, the agent reads its hook and begins executing
- When work completes or the session needs recycling, the agent "hands off" — cleaning up and restarting, with the hook ensuring continuity

**The nudge workaround:** In practice, AI agents don't always follow the propulsion principle. They sometimes sit waiting for user input despite being prompted to check their hook autonomously. The workaround is a **nudge system** — automated messages sent to agents 30-60 seconds after startup that kick them into reading their hook and taking action. The content of the nudge doesn't matter (it can be "hi" or anything); what matters is that the agent receives *any* input that triggers it to check its state.

**Handoff as the core inner loop:** At any point in any session, you can say "let's hand off" and the agent will:
1. Save any in-progress state to the data plane
2. Optionally send itself future work
3. Restart its session
4. The new session picks up via the propulsion principle

This means **context window exhaustion is a non-issue**. Work persists in the data plane; sessions are disposable cattle.

**Seance — talking to predecessors:** Because agents restart frequently, there's a mechanism to let a new agent session query its predecessor (via session resume) to recover context that didn't make it to the data plane.

---

## 6. Work Dispatch and Tracking (Sling/Convoy System)

### The Problem
You need a way to assign work to agents, track batches of related work, and get notified when work completes. Simple task assignment isn't enough at scale — you need batch tracking with dashboard visibility.

### The Solution: Sling + Convoy

**Slinging** is the fundamental primitive for dispatching work:
- `sling` assigns a work item to an agent by placing it on their hook
- Can target specific agents or let the system choose
- Can start immediately or defer
- Can force a session restart

**Convoys** are the batch tracking layer:
- A convoy wraps a set of related work items into a trackable delivery unit
- Convoys persist after work completes (unlike the worker swarms that execute them)
- Even single-item work gets auto-wrapped in a convoy for dashboard visibility
- Convoys track cross-project work — a single feature touching multiple repos is one convoy

**Convoy vs. Swarm:**
- **Convoy** = permanent tracking identifier. The *what*.
- **Swarm** = ephemeral group of agents actively working on convoy issues. The *who*.

Multiple swarms can attack the same convoy over time. When one batch of agents finishes and some issues remain, the monitor will recycle new agents and push them at the remaining work.

**Convoy lifecycle:** OPEN (active tracking) → CLOSED (all issues resolved, notification sent). Adding new issues to a closed convoy reopens it.

---

## 7. The Merge Queue Problem

### The Problem
When multiple agents work in parallel (swarming), they all produce changes that need to merge to main. This creates a "monkey knife fight" — agents conflict over rebasing, the baseline changes dramatically during the swarm, and late-finishing agents may need to completely reimagine their changes against an unrecognizable new HEAD.

### The Solution: A Dedicated Merge Processor

A specialized agent role handles all merges sequentially:
- Processes merge requests one at a time
- Intelligently handles rebase conflicts (not just mechanical merge — the AI understands the *intent* of both sides)
- Can escalate truly irreconcilable conflicts
- No work is allowed to be lost
- Has its own patrol cycle with pre-flight cleanup and post-flight steps

**Key insight:** The merge processor isn't just running `git merge`. It's an AI agent that understands code semantics. When two agents modify the same function in incompatible ways, it can reason about both intents and produce a correct synthesis. This is fundamentally different from traditional merge tooling.

---

## 8. Hierarchical Health Monitoring (Patrol System)

### The Problem
With many agents running, sessions crash, agents get stuck, work stalls. You need an automated health monitoring system that keeps everything running without human intervention.

### The Solution: Patrol Loops with Hierarchical Propagation

**Patrols** are ephemeral workflows (wisps) that monitoring agents run in a loop:

```
Supervisor Daemon (global)
  ├── heartbeats downward to all workers
  ├── runs global plugins
  ├── dispatches maintenance to helpers
  │
  ├── Worker Monitor (per-project)
  │   ├── checks ephemeral worker health
  │   ├── detects stalls and zombies
  │   ├── nudges stuck agents
  │   ├── runs project-level plugins
  │   └── peeks at supervisor health
  │
  └── Merge Processor (per-project)
      ├── pre-flight cleanup
      ├── processes merge queue until empty
      └── post-flight and handoff
```

**Exponential backoff:** When patrol agents find no work, they gradually sleep longer between cycles. Any mutating command or manual wake wakes the system back up.

**The "Boot the Dog" pattern:** The daemon kept getting interrupted by its own heartbeat timer, so a dedicated lightweight helper exists *solely* to check on the daemon every N minutes and decide whether it needs a heartbeat, a nudge, a restart, or to be left alone. This keeps the daemon focused on its actual patrol rather than responding to interrupts.

**Key design principle:** Monitoring agents *observe and nudge* but don't *force*. The Worker Monitor doesn't kill agents or force session cycles — it detects problems, nudges stuck agents, cleans up zombies, and escalates when needed.

---

## 9. Nondeterministic Idempotence (NDI)

### The Problem
Traditional workflow engines (like Temporal) achieve durability through deterministic replay — the exact same steps execute in the exact same order. But AI agents are inherently nondeterministic. How do you guarantee workflow completion when your workers are unpredictable?

### The Solution: Guaranteed Outcomes Through Persistent State

NDI states: even though the *path* is fully nondeterministic, the *outcome* — the workflow you wanted — eventually completes, "guaranteed," as long as you keep throwing agents at it.

**How it works:**
1. The agent identity is persistent (a work item in git). Sessions come and go.
2. The hook is persistent (also in git).
3. The molecule (workflow) is persistent (a chain of work items, also in git).
4. If an agent crashes mid-step, the next session starts up, finds the molecule, identifies the current step, and picks up where it left off.
5. If it crashed mid-implementation, no problem — it figures out the right fix and moves on.
6. The molecule's acceptance criteria tell the agent what "done" looks like for each step.

**This is not Temporal.** NDI doesn't provide exactly-once semantics or deterministic replay. But it provides **good-enough workflow guarantees for a developer tool**: work items close, workflows complete, and the permanent ledger records everything that happened.

**The throughput tradeoff:** Some work gets done twice. Some work gets lost and redone. Designs go missing and get recreated. This is acceptable because the focus is on *throughput* — creation and correction at the speed of thought. You might not be 100% efficient, but you are *flying*.

---

## 10. Real-Time Messaging and Coordination

### The Problem
Agents need to communicate with each other, receive notifications, and be nudged into action. Email-style async messaging is too slow; you need real-time communication within the agent fleet.

### The Solution: Multi-Layer Messaging

**Level 1: Mail (Async)**
Work items serve as the mail system. Agents have inboxes (collections of work items addressed to them). Mail is durable and persists in git.

**Level 2: Events (Real-Time)**
A real-time event system for coordination signals — "work is ready," "merge needed," "patrol complete." Events are cooperative and flow through the agent hierarchy.

**Level 3: Nudges (Terminal-Level)**
Direct terminal input to agent sessions. Used to kick agents into action when they're waiting for input. Works around debouncing issues with terminal multiplexer key-sending. The content of a nudge is largely irrelevant — what matters is that the agent receives *any* input.

**Two-tier structure:** Work items exist at both the project level (project work — features, bugs) and the orchestration level (system work — patrols, releases, cross-project coordination). Both use the same underlying data plane, and workers can operate cross-project when needed.

---

## 11. The Terminal Multiplexer as UI

### The Problem
You need to manage 10-30+ concurrent agent sessions, switch between them, monitor output, and send input. A traditional IDE can't handle this.

### The Solution: tmux (or equivalent)

The terminal multiplexer provides:
- **Session management** — Each agent runs in its own named session
- **Session groups** — Workers grouped by role and project, navigable with next/previous bindings
- **Session snooping** — Peek at what any agent is doing without switching to it
- **Status lines** — Custom status bars showing agent state, rig info, convoy progress
- **Copy mode** — Pause output and scroll back through agent activity
- **Persistence** — Sessions survive terminal disconnects
- **Extensibility** — Custom popups, views, key bindings per your workflow

**Essential commands are few:** List/switch sessions, navigate within groups, scroll back, suspend. The barrier to entry is low despite tmux's reputation.

**This is a transitional UI.** The tmux approach works but is clearly a stepping stone. Better UIs (web, Emacs, dedicated GUIs) can be built on top of the same underlying orchestration layer.

---

## 12. Plugin Architecture

### The Problem
An orchestration system needs to be extensible. Different teams need different quality gates, different integration points, different scheduled tasks.

### The Solution: Plugins as Scheduled Agent Attention

A plugin is defined as **"coordinated or scheduled attention from an agent."** Plugins are steps within patrol workflows — any patrol can contain "run plugins" steps.

**Plugin tiers:**
- **Project-level plugins** — Run by the project's Worker Monitor during its patrol
- **Global plugins** — Run by the Supervisor Daemon, executed by helper agents so the daemon isn't blocked

**Plugin resolution hierarchy (for workflow templates):**
1. Project-level (project maintainers know their workflows best)
2. Organization-level (cross-project defaults and customizations)
3. System-level (factory defaults compiled into the binary)

**Key insight:** Plugins run with the full capabilities of an AI agent. They're not simple webhook callbacks — they're "let an AI look at this and figure out the right thing to do" with specific focus areas and instructions.

---

## 13. Project/Rig Management

### The Problem
You may have multiple repositories/projects under orchestration simultaneously. Each needs its own workers, merge queues, and monitoring, but they also need to coordinate.

### The Solution: Multi-Project Architecture

**Structure:**
```
Town (HQ — global orchestration)
├── Project A (its own workers, merge queue, monitor)
├── Project B (its own workers, merge queue, monitor)
└── Project C (its own workers, merge queue, monitor)
```

**Scoping:**
- Some roles are global (Coordinator, Supervisor Daemon, Helpers)
- Some roles are per-project (Merge Processor, Worker Monitor, Ephemeral Workers, Persistent Workers)

**Cross-project work:** Workers can grab clones of other projects and make fixes when needed. The work tracking system supports cross-project routing — work items automatically route to the correct project's database based on their ID prefix.

**Graceful degradation:** Every part of the system can work independently or in small groups. You can choose which parts to run at any time. Even without the terminal multiplexer, the system limps along using raw agent sessions with async messaging.

---

## Summary: The Minimum Viable Orchestrator

If you were building an agent orchestration system from scratch, the components in rough priority order would be:

1. **Persistent work tracking** — Git-backed issue graph (the data plane)
2. **Agent identity** — Persistent identities separate from ephemeral sessions
3. **Propulsion principle** — Hooks + autonomous startup behavior
4. **Work dispatch** — Sling work to agents, track with convoys
5. **Workflow molecules** — Durable multi-step process execution
6. **Merge queue** — Dedicated AI-powered merge processing
7. **Health monitoring** — Hierarchical patrol system with nudging
8. **Session management** — tmux or equivalent for managing many agents
9. **Workflow templates** — Formula/protomolecule system for reusable workflows
10. **Plugin architecture** — Extensible quality gates and integrations

The insight from Gas Town is that these components are **not optional luxuries** — they are the naturally-emerging shapes that arise when you try to coordinate unreliable-but-intelligent workers at scale. Similar to how Kubernetes converged on controllers, schedulers, and reconciliation loops for container orchestration, agent orchestration converges on persistent work graphs, propulsion principles, hierarchical monitoring, and merge queues.

---

*Sources: Steve Yegge's "Welcome to Gas Town" blog post (Jan 2026), Gas Town GitHub repository documentation, Beads GitHub repository*
