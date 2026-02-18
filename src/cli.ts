#!/usr/bin/env node

import { Command } from "commander";

const program = new Command();

program
  .name("forge")
  .description("Agent orchestration CLI — from requirements to merged PRs")
  .version("0.1.0");

// Layer 0: Spec pipeline
program
  .command("init")
  .description("Initialize .forge/ in the current project")
  .option("--stealth", "Local-only mode, invisible to teammates")
  .option("--branch <name>", "Commit forge data to a separate git branch")
  .action(async (options) => {
    console.log("forge init — not yet implemented");
  });

program
  .command("refine <issue>")
  .description("Refine a GitHub issue into a PRD through structured dialogue")
  .action(async (issue) => {
    console.log(`forge refine ${issue} — not yet implemented`);
  });

program
  .command("spec <prd>")
  .description("Generate a technical spec from a PRD")
  .action(async (prd) => {
    console.log(`forge spec ${prd} — not yet implemented`);
  });

program
  .command("plan <spec>")
  .description("Decompose a spec into tasks")
  .option("--markdown", "Output as markdown plan instead of task graph")
  .action(async (spec, options) => {
    console.log(`forge plan ${spec} — not yet implemented`);
  });

// Layer 1: Data plane
const task = program.command("task").description("Manage tasks in the work graph");

task
  .command("create <title>")
  .description("Create a new task")
  .option("-t, --type <type>", "Task type (task, bug, feature, epic)", "task")
  .option("-p, --priority <n>", "Priority 0-4", "2")
  .option("--github-issue <number>", "Link to GitHub issue")
  .option("--parent <id>", "Parent task ID (for subtasks)")
  .option("-d, --description <text>", "Task description")
  .action(async (title, options) => {
    console.log(`forge task create "${title}" — not yet implemented`);
  });

task
  .command("show <id>")
  .description("Show task details")
  .action(async (id) => {
    console.log(`forge task show ${id} — not yet implemented`);
  });

task
  .command("update <id>")
  .description("Update a task")
  .option("-s, --status <status>", "Status (open, in_progress, closed)")
  .option("-a, --assignee <agent>", "Assign to agent")
  .option("-p, --priority <n>", "Priority 0-4")
  .action(async (id, options) => {
    console.log(`forge task update ${id} — not yet implemented`);
  });

task
  .command("close <id>")
  .description("Close a task")
  .option("-r, --reason <text>", "Close reason")
  .action(async (id, options) => {
    console.log(`forge task close ${id} — not yet implemented`);
  });

program
  .command("ready")
  .description("List unblocked, unassigned tasks")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    console.log("forge ready — not yet implemented");
  });

// Layer 1: Dependencies
const dep = program.command("dep").description("Manage task dependencies");

dep
  .command("add <child> <parent>")
  .description("Add a dependency")
  .option("--type <type>", "Dependency type (blocks, related, discovered-from)", "blocks")
  .action(async (child, parent, options) => {
    console.log(`forge dep add ${child} ${parent} — not yet implemented`);
  });

dep
  .command("tree <id>")
  .description("Show dependency tree")
  .action(async (id) => {
    console.log(`forge dep tree ${id} — not yet implemented`);
  });

// Layer 2: Agent management
program
  .command("dispatch <taskId> <agent>")
  .description("Dispatch a task to an agent")
  .action(async (taskId, agent) => {
    console.log(`forge dispatch ${taskId} ${agent} — not yet implemented`);
  });

program
  .command("hook")
  .description("Show current agent hook assignment")
  .action(async () => {
    console.log("forge hook — not yet implemented");
  });

program
  .command("handoff")
  .description("Save state and restart agent session")
  .action(async () => {
    console.log("forge handoff — not yet implemented");
  });

program
  .command("nudge <agent>")
  .description("Send a nudge to an agent session")
  .action(async (agent) => {
    console.log(`forge nudge ${agent} — not yet implemented`);
  });

// Layer 3: Session management
program
  .command("status")
  .description("Overview of all agents and their current work")
  .action(async () => {
    console.log("forge status — not yet implemented");
  });

// Layer 4: Batch tracking
const batch = program.command("batch").description("Track batches of related work");

batch
  .command("create <name>")
  .description("Create a new batch")
  .action(async (name) => {
    console.log(`forge batch create "${name}" — not yet implemented`);
  });

batch
  .command("list")
  .description("List active batches")
  .action(async () => {
    console.log("forge batch list — not yet implemented");
  });

batch
  .command("show [id]")
  .description("Show batch details")
  .action(async (id) => {
    console.log(`forge batch show ${id ?? ""} — not yet implemented`);
  });

// Layer 5: Health
program
  .command("doctor")
  .description("Run system health check")
  .action(async () => {
    console.log("forge doctor — not yet implemented");
  });

program.parse();
