import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { buildContextMarkdown } from "./artifacts.ts";
import { generateDraft, draftToReviewMarkdown } from "./draft-generator.ts";
import { saveAgentDefinition } from "./agents.ts";
import type { AgentDefinition } from "./types.ts";
import { reviewDraft } from "./ui/draft-review.ts";
import type { SubagentRunManager } from "./run-manager.ts";

function buildParentHandoff(ctx: ExtensionCommandContext): string {
  const branch = ctx.sessionManager.getBranch?.() ?? ctx.sessionManager.getEntries();
  const recent = (branch as any[]).slice(-12).map((entry) => {
    const msg = entry?.message;
    if (!msg) return "";
    const role = msg.role;
    const content = Array.isArray(msg.content)
      ? msg.content.filter((p: any) => p.type === "text").map((p: any) => p.text).join(" ")
      : String(msg.content ?? "");
    return `${role}: ${content.replace(/\s+/g, " ").slice(0, 500)}`;
  }).filter(Boolean);
  return recent.length ? `Recent parent-session context:\n${recent.join("\n")}` : "No recent parent-session messages available.";
}

export function registerCreateSubagentCommand(pi: ExtensionAPI, manager: SubagentRunManager, onSessionDefinition?: (definition: AgentDefinition) => void): void {
  pi.registerCommand("create-subagent", {
    description: "Generate, review, run, keep, or save a Pizza subagent draft",
    handler: async (args, ctx) => {
      let description = args.trim();
      if (!description && ctx.hasUI) {
        description = (await ctx.ui.input("Create subagent", "Describe what the subagent will do"))?.trim() ?? "";
      }
      if (!description) {
        emit(ctx, "Usage: /create-subagent <description of what it will do>", "warning");
        return;
      }

      ctx.ui.setWorkingMessage?.("Designing subagent...");
      const draft = await generateDraft(description, ctx.model, ctx.signal);
      ctx.ui.setWorkingMessage?.();

      if (!ctx.hasUI) {
        console.log(draftToReviewMarkdown(draft));
        return;
      }

      while (true) {
        const result = await reviewDraft(ctx, draft);
        const reviewed = result.draft as AgentDefinition;
        if (result.action === "cancel") {
          ctx.ui.notify("Canceled subagent creation.", "info");
          return;
        }
        if (result.action === "preview-context") {
          const preview = buildContextMarkdown(reviewed, "<task provided at run time>", {
            cwd: ctx.cwd,
            runMode: reviewed.defaultRunMode ?? "background",
            contextPolicy: reviewed.contextPolicy,
            deliveryPolicy: reviewed.deliveryPolicy,
            parentContext: buildParentHandoff(ctx),
            sessionId: ctx.sessionManager.getSessionId?.(),
          });
          await ctx.ui.editor("Subagent context preview", preview);
          continue;
        }
        if (result.action === "keep-session") {
          const sessionDefinition = { ...reviewed, source: "session" as const, filePath: undefined };
          pi.appendEntry("pizza-subagent-definition", sessionDefinition);
          onSessionDefinition?.(sessionDefinition);
          ctx.ui.notify(`Kept subagent ${reviewed.name} for this session.`, "info");
          return;
        }
        if (result.action === "save-user" || result.action === "save-project") {
          const scope = result.action === "save-user" ? "user" : "project";
          const ok = await ctx.ui.confirm("Save subagent permanently?", `Write ${reviewed.name} to ${scope} scope?`);
          if (!ok) return;
          const filePath = await saveAgentDefinition(reviewed, scope, ctx.cwd);
          ctx.ui.notify(`Saved subagent ${reviewed.name}:\n${filePath}`, "info");
          return;
        }
        if (result.action === "run-once") {
          const task = (await ctx.ui.input("Run once", "Task for this one-off subagent"))?.trim();
          if (!task) return;
          const run = await manager.run(
            { ...reviewed, source: "one-off" },
            task,
            {
              cwd: ctx.cwd,
              runMode: reviewed.defaultRunMode ?? "foreground",
              contextPolicy: reviewed.contextPolicy,
              deliveryPolicy: reviewed.deliveryPolicy,
              parentContext: buildParentHandoff(ctx),
              sessionId: ctx.sessionManager.getSessionId?.(),
            },
            ctx,
          );
          ctx.ui.notify(`Subagent ${reviewed.name} ${run.runMode === "background" ? "started" : "completed"}: ${run.id}\n${run.artifactDir}`, "info");
          return;
        }
      }
    },
  });
}

function emit(ctx: ExtensionCommandContext, message: string, level: "info" | "warning"): void {
  if (ctx.hasUI) ctx.ui.notify(message, level);
  else console.log(message);
}
