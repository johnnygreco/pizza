import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { SubagentRun } from "./types.ts";

function statusIcon(status: SubagentRun["status"]): string {
  switch (status) {
    case "queued": return "⏳";
    case "running": return "⠹";
    case "completed": return "✓";
    case "review-needed": return "◉";
    case "failed": return "✗";
    case "aborted":
    case "stopped": return "■";
    case "injected": return "↳";
  }
}

export function updateSubagentsWidget(ctx: ExtensionContext | undefined, runs: SubagentRun[]): void {
  if (!ctx?.hasUI) return;
  const visible = runs.filter((run) => ["queued", "running", "review-needed", "failed"].includes(run.status)).slice(0, 5);
  if (visible.length === 0) {
    ctx.ui.setWidget("pizza.subagents", undefined);
    return;
  }
  ctx.ui.setWidget("pizza.subagents", [
    "🍕 Subagents",
    ...visible.map((run) => {
      const task = run.task.replace(/\s+/g, " ").slice(0, 56);
      const metrics = run.status === "running" ? ` · ${run.turns} turns · ${run.toolUses} tools` : "";
      return `${statusIcon(run.status)} ${run.agentName} · ${task}${metrics}`;
    }),
  ]);
}
