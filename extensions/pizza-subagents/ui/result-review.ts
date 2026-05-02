import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { writeMetadata, writeQueued } from "../artifacts.ts";
import { buildArtifactReference } from "../capsule.ts";
import { injectCapsule, removeFromReviewInbox, type DeliveryState } from "../delivery.ts";
import type { AgentDefinition, SubagentRun } from "../types.ts";

export async function reviewResult(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  state: DeliveryState,
  run: SubagentRun,
  definition: AgentDefinition,
): Promise<void> {
  const edited = await ctx.ui.editor(`Subagent Result: ${definition.name}`, run.capsule ?? run.finalOutput ?? "");
  if (edited === undefined) return;
  const choice = await ctx.ui.select("Review subagent result", [
    "Inject capsule",
    "Inject artifact reference only",
    "Discard",
    "Later",
  ]);
  if (choice === "Inject capsule") {
    run.capsule = edited;
    injectCapsule(pi, run, edited, false);
    run.status = "injected";
    run.completedAt = run.completedAt ?? Date.now();
    await Promise.all([
      writeQueued(run.capsulePath, edited.endsWith("\n") ? edited : `${edited}\n`),
      writeMetadata(run),
    ]);
    removeFromReviewInbox(state, run.id);
    ctx.ui.notify(`Injected subagent result ${run.id}.`, "info");
  } else if (choice === "Inject artifact reference only") {
    injectCapsule(pi, run, buildArtifactReference(run, definition), true);
    run.status = "injected";
    run.completedAt = run.completedAt ?? Date.now();
    await writeMetadata(run);
    removeFromReviewInbox(state, run.id);
    ctx.ui.notify(`Injected artifact reference for ${run.id}.`, "info");
  } else if (choice === "Discard") {
    run.status = "completed";
    await writeMetadata(run);
    removeFromReviewInbox(state, run.id);
    ctx.ui.notify(`Discarded subagent result ${run.id}.`, "info");
  }
}
