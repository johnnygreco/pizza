import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { discoverAgentDefinitions, saveAgentDefinition } from "./agents.ts";
import { formatAgentSummary } from "./agent-serializer.ts";
import type { AgentDefinition } from "./types.ts";
import type { SubagentRunManager } from "./run-manager.ts";
import { reviewResult } from "./ui/result-review.ts";

export interface SessionRegistry {
  list(): AgentDefinition[];
  add(definition: AgentDefinition): void;
  remove(name: string): boolean;
}

export function registerSubagentsCommand(pi: ExtensionAPI, manager: SubagentRunManager, registry: SessionRegistry): void {
  pi.registerCommand("subagents", {
    description: "Open the Pizza subagent manager",
    handler: async (args, ctx) => {
      const cmd = args.trim().toLowerCase();
      if (!ctx.hasUI) {
        printSummary(ctx, registry, manager);
        return;
      }
      if (cmd === "review") {
        await openReviewInbox(pi, ctx, manager, registry);
        return;
      }
      const choice = await ctx.ui.select("Pizza Subagents", [
        "Agent definitions",
        "Running / recent runs",
        "Review inbox",
        "Settings",
        "Cancel",
      ]);
      if (choice === "Agent definitions") await showDefinitions(ctx, registry);
      else if (choice === "Running / recent runs") await showRuns(ctx, manager);
      else if (choice === "Review inbox") await openReviewInbox(pi, ctx, manager, registry);
      else if (choice === "Settings") ctx.ui.notify("Pizza subagent settings UI is not implemented yet. MVP defaults: maxConcurrency=4, delivery=review.", "info");
    },
  });
}

function printSummary(ctx: ExtensionCommandContext, registry: SessionRegistry, manager: SubagentRunManager): void {
  const discovery = discoverAgentDefinitions(ctx.cwd, { sessionDefinitions: registry.list() });
  const lines = ["Pizza subagents:", ...discovery.agents.map(formatAgentSummary), "", "Runs:", ...manager.listRuns().slice(0, 10).map((run) => `${run.id} ${run.status} ${run.agentName}: ${run.task}`)];
  console.log(lines.join("\n"));
}

async function showDefinitions(ctx: ExtensionCommandContext, registry: SessionRegistry): Promise<void> {
  const discovery = discoverAgentDefinitions(ctx.cwd, { sessionDefinitions: registry.list() });
  if (discovery.agents.length === 0) {
    ctx.ui.notify("No subagents found.", "info");
    return;
  }
  const labels = discovery.agents.map((agent) => `${agent.name} (${agent.source})`);
  const choice = await ctx.ui.select("Agent definitions", labels);
  if (!choice) return;
  const agent = discovery.agents[labels.indexOf(choice)];
  const action = await ctx.ui.select(agent.name, ["Show details", "Convert session to saved user file", "Convert session to saved project file", "Cancel"]);
  if (action === "Show details") {
    await ctx.ui.editor(agent.name, formatAgentSummary(agent) + "\n\n" + agent.systemPrompt);
  } else if (action?.startsWith("Convert session")) {
    if (agent.source !== "session") {
      ctx.ui.notify("Only session agents can be converted here.", "warning");
      return;
    }
    const scope = action.includes("project") ? "project" : "user";
    const filePath = await saveAgentDefinition(agent, scope, ctx.cwd);
    ctx.ui.notify(`Saved ${agent.name}:\n${filePath}`, "info");
  }
}

async function showRuns(ctx: ExtensionCommandContext, manager: SubagentRunManager): Promise<void> {
  const runs = manager.listRuns();
  if (runs.length === 0) {
    ctx.ui.notify("No subagent runs yet.", "info");
    return;
  }
  const labels = runs.map((run) => `${run.id} · ${run.status} · ${run.agentName} · ${run.task.slice(0, 60)}`);
  const choice = await ctx.ui.select("Subagent runs", labels);
  if (!choice) return;
  const run = runs[labels.indexOf(choice)];
  const action = await ctx.ui.select(run.id, ["Show status/artifacts", "Stop", "Open capsule", "Cancel"]);
  if (action === "Show status/artifacts") {
    await ctx.ui.editor(run.id, JSON.stringify({ ...run, abortController: undefined }, null, 2));
  } else if (action === "Stop") {
    const ok = await manager.stop(run.id);
    ctx.ui.notify(ok ? `Stopped ${run.id}` : `Run ${run.id} not found`, ok ? "info" : "warning");
  } else if (action === "Open capsule") {
    await ctx.ui.editor(run.id, run.capsule ?? run.finalOutput ?? "No result yet.");
  }
}

async function openReviewInbox(pi: ExtensionAPI, ctx: ExtensionCommandContext, manager: SubagentRunManager, registry: SessionRegistry): Promise<void> {
  const inbox = manager.state.reviewInbox;
  if (inbox.length === 0) {
    ctx.ui.notify("Review inbox is empty.", "info");
    return;
  }
  const labels = inbox.map((run) => `${run.id} · ${run.agentName} · ${run.task.slice(0, 70)}`);
  const choice = await ctx.ui.select("Review inbox", labels);
  if (!choice) return;
  const run = inbox[labels.indexOf(choice)];
  const definition = discoverAgentDefinitions(ctx.cwd, { sessionDefinitions: registry.list() }).byName.get(run.agentName) ?? {
    name: run.agentName,
    description: run.description,
    systemPrompt: "",
    source: "one-off" as const,
    contextPolicy: run.contextPolicy,
    deliveryPolicy: run.deliveryPolicy,
  };
  await reviewResult(pi, ctx, manager.state, run, definition);
}
