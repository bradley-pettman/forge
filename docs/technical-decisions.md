# Forge — Technical Decisions

A record of key technical decisions and their rationale.

Related: [[Forge - Implementation Outline]] | [[Key Components of Agent Orchestration Systems]]

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
- **Go** — what [[Gas Town]] and [[Beads]] use. Better binary distribution and concurrency primitives, but those advantages matter less for a personal tool that runs from source. The language familiarity tradeoff tips the balance to TypeScript.

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
- **Dolt** — what [[Beads]] uses. Overkill for this scope and adds a complex dependency
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
- Proven by [[Gas Town]] — the model works in practice
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
- [[Gas Town]]'s full supervision hierarchy (Deacon, Dogs, Boot) is unnecessary at this scale initially; adding it prematurely would add complexity without proportional benefit
- Getting the pipeline right is the hard problem; parallelism is a scaling concern to solve once the pipeline works

**Alternatives Considered:**
- **Design for swarm-scale from day one** — premature optimization. The coordination overhead and architectural complexity would slow down initial delivery significantly without solving the actual problem.

---

## 8. Relationship to Maestro: Peer Package, Not Child

**Decision:** Forge is a peer of the existing [[Maestro]] package, not a component within it.

**Rationale:**
- Maestro is runtime infrastructure — cache, database, queues, email — things the application uses at execution time while serving users
- Forge is development infrastructure — it manages the agents that build the application
- These are fundamentally different domains with different lifecycles, different consumers, and different reasons to change
- Both are reusable tools that live outside business logic; keeping them separate preserves that reusability
- Conflating them would couple development tooling to production runtime concerns in ways that would be painful to untangle later

**Alternatives Considered:**
- **Forge as a Maestro sub-package** — conceptually wrong. Maestro has no business knowing about agent orchestration, and Forge has no business being coupled to production runtime infrastructure. The coupling would limit both.
