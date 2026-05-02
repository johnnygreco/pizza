import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir, withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import type { AgentDefinition, RunOptions, SubagentRun } from "./types.ts";

export function createRunId(): string {
  return `sa_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
}

function cwdHash(cwd: string): string {
  return createHash("sha1").update(cwd).digest("hex").slice(0, 12);
}

export function getArtifactDir(cwd: string, sessionId: string | undefined, runId: string): string {
  return join(getAgentDir(), "pizza", "subagents", "runs", cwdHash(cwd), sessionId ?? "ephemeral", runId);
}

export async function createRunRecord(definition: AgentDefinition, task: string, options: RunOptions): Promise<SubagentRun> {
  const id = createRunId();
  const artifactDir = getArtifactDir(options.cwd, options.sessionId, id);
  await mkdir(artifactDir, { recursive: true });
  return {
    id,
    agentName: definition.name,
    description: definition.description,
    task,
    status: options.runMode === "background" ? "queued" : "running",
    runMode: options.runMode,
    contextPolicy: options.contextPolicy ?? definition.contextPolicy,
    deliveryPolicy: options.deliveryPolicy ?? definition.deliveryPolicy,
    startedAt: Date.now(),
    toolUses: 0,
    turns: 0,
    artifactDir,
    contextPath: join(artifactDir, "context.md"),
    promptPath: join(artifactDir, "prompt.md"),
    transcriptPath: join(artifactDir, "transcript.jsonl"),
    resultPath: join(artifactDir, "result.md"),
    capsulePath: join(artifactDir, "capsule.md"),
    metadataPath: join(artifactDir, "metadata.json"),
    abortController: new AbortController(),
  };
}

function formatTools(definition: AgentDefinition): string {
  return definition.tools === undefined ? "default" : definition.tools.length === 0 ? "none" : definition.tools.join(", ");
}

export function buildContextMarkdown(definition: AgentDefinition, task: string, options: RunOptions): string {
  const contextPolicy = options.contextPolicy ?? definition.contextPolicy;
  const blocks = [
    "# Pizza Subagent Context",
    "",
    `- Run timestamp: ${new Date().toISOString()}`,
    `- Agent: ${definition.name}`,
    `- Source: ${definition.source}${definition.filePath ? ` (${definition.filePath})` : ""}`,
    `- CWD: ${options.cwd}`,
    `- Model: ${definition.model ?? "inherit"}`,
    `- Thinking: ${definition.thinking ?? "inherit"}`,
    `- Tools: ${formatTools(definition)}`,
    `- Context policy: ${contextPolicy}`,
    `- Delivery policy: ${options.deliveryPolicy ?? definition.deliveryPolicy}`,
    "",
    "## Agent System Prompt",
    "",
    definition.systemPrompt.trim(),
    "",
    "## Task",
    "",
    task.trim(),
  ];

  if (contextPolicy === "project") {
    blocks.push(
      "",
      "## Project Context",
      "",
      "Project context is included by Pi's standard resource loader in the child process. See the child transcript for exact loaded messages and tool usage.",
    );
  } else if (contextPolicy === "handoff") {
    blocks.push("", "## Parent Handoff", "", options.parentContext?.trim() || "No explicit parent handoff was available.");
  } else if (contextPolicy === "fresh") {
    blocks.push("", "## Fresh Context", "", "Only the agent prompt, task, cwd, and selected tools are intentionally provided.");
  } else {
    blocks.push("", "## Context Note", "", `${contextPolicy} is experimental; MVP runner treats it as a fresh/project-like context as documented in metadata.`);
  }

  return blocks.join("\n") + "\n";
}

export async function writeRunFiles(run: SubagentRun, definition: AgentDefinition, contextMarkdown: string): Promise<void> {
  await mkdir(run.artifactDir, { recursive: true });
  await Promise.all([
    writeQueued(run.contextPath, contextMarkdown),
    writeQueued(run.promptPath, definition.systemPrompt.trim() + "\n"),
    writeQueued(run.transcriptPath, ""),
    writeMetadata(run),
  ]);
}

export async function writeQueued(filePath: string, content: string): Promise<void> {
  await withFileMutationQueue(filePath, async () => {
    await writeFile(filePath, content, "utf8");
  });
}

export async function appendJsonLine(filePath: string, value: unknown): Promise<void> {
  const { appendFile } = await import("node:fs/promises");
  await withFileMutationQueue(filePath, async () => {
    await appendFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
  });
}

export async function writeMetadata(run: SubagentRun): Promise<void> {
  const { abortController: _abortController, ...serializable } = run;
  await writeQueued(run.metadataPath, JSON.stringify(serializable, null, 2) + "\n");
}
