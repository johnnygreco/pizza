import type { AgentDefinition, SubagentRun } from "./types.ts";

export function buildCapsule(run: SubagentRun, definition: AgentDefinition, finalOutput: string): string {
  const result = finalOutput.trim() || "(no output)";
  return [
    `<subagent-result id="${run.id}" agent="${definition.name}">`,
    `Task: ${run.task}`,
    `Status: ${run.status}`,
    `Model: ${run.model ?? definition.model ?? "inherit"}`,
    `Context policy: ${run.contextPolicy}`,
    `Delivery policy: ${run.deliveryPolicy}`,
    `Run mode: ${run.runMode}`,
    `Timestamp: ${new Date(run.completedAt ?? Date.now()).toISOString()}`,
    "Artifacts:",
    `- context: ${run.contextPath}`,
    `- transcript: ${run.transcriptPath}`,
    `- result: ${run.resultPath}`,
    `- capsule: ${run.capsulePath}`,
    "",
    "Result:",
    result,
    `</subagent-result>`,
    "",
  ].join("\n");
}

export function buildArtifactReference(run: SubagentRun, definition: AgentDefinition): string {
  return [
    `<subagent-artifact-ref id="${run.id}" agent="${definition.name}">`,
    `Task: ${run.task}`,
    `Status: ${run.status}`,
    `Context: ${run.contextPath}`,
    `Result: ${run.resultPath}`,
    `Capsule: ${run.capsulePath}`,
    `</subagent-artifact-ref>`,
  ].join("\n");
}
