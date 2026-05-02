import { readFileSync, statSync } from "node:fs";

export interface SubagentActivity {
  transcriptPath: string;
  bytes: number;
  turns: number;
  toolUses: number;
  sawAgentEnd: boolean;
  latestEvent?: string;
  latestTool?: {
    name: string;
    args?: unknown;
  };
  latestAssistantText?: string;
  latestToolResult?: string;
}

function tailText(path: string, maxBytes = 1024 * 1024): { text: string; bytes: number } {
  const stat = statSync(path);
  const bytes = stat.size;
  const fd = readFileSync(path);
  if (fd.length <= maxBytes) return { text: fd.toString("utf8"), bytes };
  return { text: fd.subarray(fd.length - maxBytes).toString("utf8"), bytes };
}

function textParts(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((part: any) => part?.type === "text")
    .map((part: any) => String(part.text ?? ""))
    .join("\n")
    .trim();
}

export function readSubagentActivity(transcriptPath: string): SubagentActivity | undefined {
  try {
    const { text, bytes } = tailText(transcriptPath);
    const lines = text.split("\n").filter((line) => line.trim());
    const activity: SubagentActivity = {
      transcriptPath,
      bytes,
      turns: 0,
      toolUses: 0,
      sawAgentEnd: false,
    };

    for (const line of lines) {
      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      activity.latestEvent = event.type;
      if (event.type === "turn_end") activity.turns++;
      if (event.type === "agent_end") activity.sawAgentEnd = true;
      if (event.type === "tool_execution_start" || event.type === "toolcall_start" || event.type === "tool_call") {
        activity.toolUses++;
        activity.latestTool = { name: event.toolName ?? event.name ?? "unknown", args: event.args ?? event.input };
      }
      if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
        const delta = String(event.assistantMessageEvent.delta ?? "");
        activity.latestAssistantText = ((activity.latestAssistantText ?? "") + delta).slice(-2000);
      }
      if (event.type === "message_end" && event.message?.role === "assistant") {
        const text = textParts(event.message.content);
        if (text) activity.latestAssistantText = text.slice(-2000);
      }
      if ((event.type === "tool_execution_end" || event.type === "tool_result_end") && event.result?.content) {
        const text = textParts(event.result.content);
        if (text) activity.latestToolResult = text.slice(-1000);
      }
      if (event.type === "message_end" && event.message?.role === "toolResult") {
        const text = textParts(event.message.content);
        if (text) activity.latestToolResult = text.slice(-1000);
      }
    }

    return activity;
  } catch {
    return undefined;
  }
}

function oneLine(value: unknown, max = 120): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return (text ?? "").replace(/\s+/g, " ").slice(0, max);
}

export function formatSubagentActivity(activity: SubagentActivity | undefined): string {
  if (!activity) return "No transcript activity is available yet.";
  const lines = [
    `Transcript: ${activity.transcriptPath}`,
    `Progress: ${activity.turns} turns, ${activity.toolUses} tool uses${activity.sawAgentEnd ? " (agent_end seen)" : ""}`,
  ];
  if (activity.latestTool) {
    lines.push(`Latest tool: ${activity.latestTool.name}${activity.latestTool.args ? ` ${oneLine(activity.latestTool.args)}` : ""}`);
  }
  if (activity.latestEvent) lines.push(`Latest event: ${activity.latestEvent}`);
  if (activity.latestToolResult) lines.push(`Latest tool result: ${oneLine(activity.latestToolResult, 240)}`);
  if (activity.latestAssistantText) lines.push(`Latest assistant text:\n${activity.latestAssistantText.trim()}`);
  return lines.join("\n");
}
