import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { deleteAgentDefinition, discoverAgentDefinitions } from "./agents.ts";
import type { SessionRegistry } from "./manager-command.ts";

export function registerRemoveSubagentCommand(pi: ExtensionAPI, registry: SessionRegistry): void {
  pi.registerCommand("remove-subagent", {
    description: "Remove a saved or session-scoped Pizza subagent",
    handler: async (args, ctx) => {
      const nameArg = args.trim();
      const discovery = discoverAgentDefinitions(ctx.cwd, { sessionDefinitions: registry.list(), includeDisabled: true });
      let agent = nameArg ? discovery.byName.get(nameArg) : undefined;
      if (!agent) {
        if (!ctx.hasUI) {
          console.log(`Unknown subagent: ${nameArg || "(none)"}`);
          return;
        }
        const removable = discovery.agents.filter((a) => a.source !== "builtin");
        if (removable.length === 0) {
          ctx.ui.notify("No removable subagents found. Builtin agents cannot be deleted.", "info");
          return;
        }
        const labels = removable.map((a) => `${a.name} (${a.source})`);
        const choice = await ctx.ui.select("Remove subagent", labels);
        if (!choice) return;
        agent = removable[labels.indexOf(choice)];
      }
      if (agent.source === "builtin") {
        ctx.ui.notify("Builtin Pizza subagents cannot be deleted. Override/disable support is planned for a later release.", "warning");
        return;
      }
      if (agent.source === "session") {
        registry.remove(agent.name);
        pi.appendEntry("pizza-subagent-definition-removed", {
          name: agent.name,
          removedAt: new Date().toISOString(),
        });
        ctx.ui.notify(`Removed session subagent ${agent.name}.`, "info");
        return;
      }
      const ok = !ctx.hasUI || await ctx.ui.confirm("Delete subagent file?", `${agent.name}\n${agent.filePath}`);
      if (!ok) return;
      deleteAgentDefinition(agent);
      ctx.ui.notify(`Deleted ${agent.name}:\n${agent.filePath}`, "info");
    },
  });
}
