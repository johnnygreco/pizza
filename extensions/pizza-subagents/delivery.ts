import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { buildArtifactReference } from "./capsule.ts";
import type { AgentDefinition, DeliveryPolicy, SubagentRun } from "./types.ts";

export interface DeliveryState {
  reviewInbox: SubagentRun[];
  recentRuns: SubagentRun[];
}

export function addRecent(state: DeliveryState, run: SubagentRun): void {
  state.recentRuns = [run, ...state.recentRuns.filter((r) => r.id !== run.id)].slice(0, 50);
}

export function removeFromReviewInbox(state: DeliveryState, runId: string): void {
  state.reviewInbox = state.reviewInbox.filter((run) => run.id !== runId);
}

export async function deliverRunResult(
  pi: ExtensionAPI,
  ctx: ExtensionContext | undefined,
  state: DeliveryState,
  run: SubagentRun,
  definition: AgentDefinition,
  policy: DeliveryPolicy = run.deliveryPolicy,
): Promise<void> {
  addRecent(state, run);
  if (policy === "review") {
    run.status = "review-needed";
    state.reviewInbox = [run, ...state.reviewInbox.filter((r) => r.id !== run.id)];
    ctx?.ui?.notify?.(`Subagent ${definition.name} completed; result is waiting in /subagents review inbox.\n${run.capsulePath}`, "info");
    return;
  }

  if (policy === "notify" || policy === "pull") {
    ctx?.ui?.notify?.(`Subagent ${definition.name} completed (${run.id}).\nResult: ${run.resultPath}`, "info");
    return;
  }

  if (policy === "auto-inject") {
    injectCapsule(pi, run, run.capsule ?? "", false);
    run.status = "injected";
    return;
  }

  if (policy === "artifact-ref") {
    injectCapsule(pi, run, buildArtifactReference(run, definition), true);
    run.status = "injected";
    return;
  }

  ctx?.ui?.notify?.(`Subagent delivery policy ${policy} is reserved for future use. Result: ${run.resultPath}`, "warning");
}

export function injectCapsule(pi: ExtensionAPI, run: SubagentRun, content: string, artifactRefOnly = false): void {
  pi.sendMessage({
    customType: "pizza-subagent-result",
    content,
    display: true,
    details: {
      runId: run.id,
      agentName: run.agentName,
      task: run.task,
      contextPolicy: run.contextPolicy,
      deliveryPolicy: run.deliveryPolicy,
      artifactRefOnly,
      artifacts: {
        context: run.contextPath,
        transcript: run.transcriptPath,
        result: run.resultPath,
        capsule: run.capsulePath,
      },
    },
  }, { deliverAs: "nextTurn" });
}
