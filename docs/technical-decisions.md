# Forge — Technical Decisions

A record of key technical decisions and their rationale.

Related: [Forge - Implementation Outline](./implementation-outline.md) | [Key Components of Agent Orchestration Systems](./key-components.md)

---

## 1. Language: TypeScript

**Decision:** Build Forge in TypeScript.

**Rationale:**
- Primary expertise of the developer — fastest path to working software
- CLI ecosystem is mature: Commander, oclif, Ink are all well-supported
- JSON/JSONL manipulation is first-class, which is critical for the data plane
- Agents are excellent at writing TypeScript — since Forge will be largely agent-built, this matters
- Node's async model handles concurrent agent coordination without additional complexity

**Alternatives Considered:**
- **Go** — what Gas Town and Beads use. Better binary distribution and concurrency primitives, but those advantages matter less for a personal tool that runs from source. The language familiarity tradeoff tips the balance to TypeScript.

---

## 2. Data Plane: Custom TypeScript Implementation (Beads-inspired, not Beads itself)

**Decision:** Build a Beads-equivalent in TypeScript rather than using Beads directly.

**Rationale:**
- Needs tight GitHub Issues integration — significantly easier when you own the code
- Beads' full feature set (Dolt, federation, wisps) is overkill for the initial scope
- A simpler JSONL-in-git task graph with hash IDs, dependency tracking, and status is 1-2 weeks of agent-built work
- Can adopt Beads' good ideas incrementally since the concepts are well-documented
- Staying in TypeScript keeps the entire system in one language

**Alternatives Considered:**
- **Using Beads directly** — mature and proven, but introduces a Go dependency, Dolt overhead, and makes customization harder. The federation and wisp features are not needed yet and the cost of the dependency outweighs the benefit.

---

## 3. Storage: SQLite + JSONL Dual-Layer

**Decision:** SQLite (via `better-sqlite3`) as the fast local query store, JSONL as the git-portable format.

**Rationale:**
- SQLite is native to Node/TypeScript, requires zero infrastructure, and `better-sqlite3` provides synchronous access which simplifies the codebase considerably
- JSONL in git gives distributed sync via normal `git push`/`git pull` — no separate sync infrastructure needed
- Git hooks bridge the two layers cleanly:
  - `pre-commit` exports SQLite state to JSONL
  - `post-merge` imports JSONL back into SQLite
- Hash-based task IDs prevent merge conflicts when multiple agents create tasks on different branches simultaneously

**Alternatives Considered:**
- **Pure JSONL** — portable but too slow for queries at scale; no indexing
- **Dolt** — what Beads uses. Overkill for this scope and adds a complex dependency
- **Plain SQLite without JSONL** — fast for queries but loses git portability; tasks become invisible to normal git workflows

---

## 4. Distribution: Separate Repo, Installed as Standalone CLI

**Decision:** Forge lives in its own repository and is installed globally via npm.

**Rationale:**
- Needs to work across multiple projects — the work monorepo and personal projects alike
- Forge can manage itself (eating its own dog food is a useful forcing function for quality)
- Forces clean boundaries — no implicit knowledge of any specific repo's internals
- Projects opt in via `forge init`, which creates a `.forge/` directory in the project root
- Any team member can install it independently without touching any project's dependencies

**Alternatives Considered:**
- **Package inside the work monorepo** — couples Forge's lifecycle to one project, prevents use elsewhere, creates implicit coupling to business logic
- **Start inside, extract later** — deferred complexity. The extraction cost is high and the boundary violations that accumulate in the meantime are hard to undo

---

## 5. UI: tmux Initially, Potential Electrobun Dashboard Later

**Decision:** tmux as the primary UI for managing agent sessions, with a richer dashboard as a future enhancement.

**Rationale:**
- Proven by Gas Town — the model works in practice
- Low barrier to entry: only a handful of tmux commands are needed to get value
- Sessions survive terminal disconnects — critical for long-running agent pipelines
- Scriptable and customizable without building custom UI infrastructure
- A web or desktop dashboard (possibly via Electrobun) is a meaningful enhancement but not a blocker for getting started

**Alternatives Considered:**
- **Build a dashboard first** — premature. The value is in the orchestration logic, not the UI. tmux is sufficient to validate the system before investing in a richer interface.

---

## 6. Relationship to GitHub Issues: Complementary, Not Replacement

**Decision:** Forge tasks are agent-scoped decompositions of human-scoped GitHub Issues. They coexist — Forge does not replace GitHub Issues.

**Rationale:**
- GitHub Issues + Projects are already the team's tool for human-level planning and tracking — that should not change
- Forge tasks are finer-grained implementation steps that agents work on autonomously
- A single GitHub Issue might spawn 5–15 Forge tasks depending on complexity
- Forge links each task back to its source GitHub Issue for traceability
- This keeps human planning in familiar tools while giving agents a richer, machine-readable task graph

**Alternatives Considered:**
- **Replace GitHub Issues entirely** — would break existing team workflows and remove visibility for non-Forge users. Not appropriate.
- **Ignore GitHub Issues** — loses the connection between agent work and human-level intent; makes it hard to know what is being worked on and why.

---

## 7. Architecture: Pipeline-Oriented (Not Swarm-First)

**Decision:** Optimize for pipeline automation with 2–5 agents rather than designing for massive parallelism from the start.

**Rationale:**
- The developer is currently at roughly "stage 5" (single CLI agent) and wants to reach stage 6–7
- The bottleneck is the pipeline from a vague issue to a merged PR — not raw throughput
- The system should be immediately useful with 2–3 agents and scale up gracefully as confidence grows
- Gas Town's full supervision hierarchy (Deacon, Dogs, Boot) is unnecessary at this scale initially; adding it prematurely would add complexity without proportional benefit
- Getting the pipeline right is the hard problem; parallelism is a scaling concern to solve once the pipeline works

**Alternatives Considered:**
- **Design for swarm-scale from day one** — premature optimization. The coordination overhead and architectural complexity would slow down initial delivery significantly without solving the actual problem.

---

## 8. Relationship to Maestro: Peer Package, Not Child

**Decision:** Forge is a peer of the existing Maestro package, not a component within it.

**Rationale:**
- Maestro is runtime infrastructure — cache, database, queues, email — things the application uses at execution time while serving users
- Forge is development infrastructure — it manages the agents that build the application
- These are fundamentally different domains with different lifecycles, different consumers, and different reasons to change
- Both are reusable tools that live outside business logic; keeping them separate preserves that reusability
- Conflating them would couple development tooling to production runtime concerns in ways that would be painful to untangle later

**Alternatives Considered:**
- **Forge as a Maestro sub-package** — conceptually wrong. Maestro has no business knowing about agent orchestration, and Forge has no business being coupled to production runtime infrastructure. The coupling would limit both.

---

## 9. Issue Tracker: Provider Abstraction with GitHub as Default

**Decision:** Forge is not coupled to GitHub Issues. A provider interface allows Linear, Jira, or no tracker at all.

**Rationale:**
- Different teams use different issue trackers; Forge should work with any of them
- The `none` provider is important — it allows Forge to work without any issue tracker integration, for personal projects or when you just want to use the pipeline manually
- A provider interface keeps the core system clean and decoupled from any specific tracker's API

**Interface:**

```typescript
interface IssueTrackerProvider {
  name: string;
  getIssue(id: string): Promise<Issue>;
  getIssueComments(id: string): Promise<Comment[]>;
  searchIssues(query: string): Promise<Issue[]>;
  addComment(issueId: string, body: string): Promise<void>;
  linkForgeTask(issueId: string, forgeTaskId: string): Promise<void>;
}
```

**Built-in Providers:**

| Provider | Implementation | Auth |
|----------|---------------|------|
| **GitHub** (default) | Via `gh` CLI | gh auth |
| **Linear** | Via Linear API | API key |
| **Jira** | Via Jira REST API | API token |
| **None** | Manual — user provides context directly | N/A |

**Configuration:**

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

---

## 10. Agent Runtime: Abstraction with CLI-First, SDK-Later

**Decision:** Start with Claude Code CLI via tmux (works with Teams plan). Claude Agent SDK becomes the preferred runtime when API credits are available.

**Rationale:**
- The Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) provides programmatic access to the same agent loop that powers Claude Code, with type-safe TypeScript API, cost tracking, and structured error handling
- However, the CLI approach works with existing Teams plan subscriptions and requires no API credits
- An agent runtime abstraction lets us swap between runtimes without changing the rest of the system

**Interface:**

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
```

**Built-in Runtimes:**

| Runtime | When to use | Billing |
|---------|------------|---------|
| `claude-cli` | Works with Claude Teams plan subscriptions | Subscription |
| `claude-sdk` | Full programmatic control, cost tracking | API credits |

**Start with `claude-cli` (tmux)** since it works with the existing Teams plan. The `claude-sdk` runtime becomes available when API credits are an option, and provides a significantly better developer experience for orchestration.

---

## 11. Initialization Modes: Standard, Stealth, Branch

**Decision:** Forge supports three initialization modes: standard (commits `.forge/` to repo), stealth (fully local via `.git/info/exclude`), and branch (commits to a separate git branch).

**Rationale:**
- Standard mode is ideal for teams that want shared visibility into Forge state
- Stealth mode is essential for using Forge on shared repos without polluting the repo or requiring team buy-in. Uses `.git/info/exclude` (repo-local gitignore that is not committed and not in `.gitignore`)
- Branch mode is a middle ground — Forge data is in git (versioned, backed up) but on a separate branch that does not pollute `main`
- Inspired by Beads, which offers similar initialization modes

**Alternatives Considered:**
- **Standard-only** — would prevent adoption on shared repos where not everyone uses Forge
- **Gitignore-based stealth** — modifying `.gitignore` is visible to teammates and could cause confusion
