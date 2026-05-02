import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { parseTools, sanitizeAgentName } from "../agent-serializer.ts";
import { draftToReviewMarkdown } from "../draft-generator.ts";
import type { DraftAgentDefinition } from "../types.ts";

export type DraftReviewAction = "run-once" | "keep-session" | "save-user" | "save-project" | "preview-context" | "cancel";

export interface DraftReviewResult {
  action: DraftReviewAction;
  draft: DraftAgentDefinition;
}

function section(markdown: string, heading: string): string | undefined {
  const marker = `## ${heading}`;
  const start = markdown.indexOf(marker);
  if (start < 0) return undefined;
  const after = markdown.slice(start + marker.length);
  const next = after.search(/\n##\s+/);
  return (next >= 0 ? after.slice(0, next) : after).trim();
}

export function parseEditedDraft(markdown: string, draft: DraftAgentDefinition): DraftAgentDefinition {
  const lines = markdown.split("\n");
  const title = lines.find((line) => line.startsWith("# "))?.slice(2).trim();
  const systemPrompt = section(markdown, "System Prompt") ?? draft.systemPrompt;
  const field = (label: string) => {
    const match = markdown.match(new RegExp(`^- ${label}:\\s*(.+)$`, "im"));
    return match?.[1]?.trim();
  };
  return {
    ...draft,
    name: sanitizeAgentName(title ?? draft.name),
    systemPrompt,
    tools: field("Tools") === "default" ? undefined : field("Tools") === "none" ? [] : parseTools(field("Tools")),
    model: field("Model") === "inherit" ? undefined : field("Model") ?? draft.model,
    thinking: field("Thinking") === "inherit" ? undefined : field("Thinking") as any ?? draft.thinking,
    contextPolicy: field("Context") as any ?? draft.contextPolicy,
    deliveryPolicy: field("Delivery") as any ?? draft.deliveryPolicy,
    defaultRunMode: field("Run") as any ?? draft.defaultRunMode,
  };
}

export async function reviewDraft(ctx: ExtensionCommandContext, draft: DraftAgentDefinition): Promise<DraftReviewResult> {
  let current = draft;
  while (true) {
    const edited = await ctx.ui.editor("Review/edit Pizza subagent draft", draftToReviewMarkdown(current));
    if (edited === undefined) return { action: "cancel", draft: current };
    current = parseEditedDraft(edited, current);

    const choice = await ctx.ui.select("Create Subagent", [
      "Run once",
      "Keep for session",
      "Save permanently (user)",
      "Save permanently (project)",
      "Preview context",
      "Cancel",
    ]);
    switch (choice) {
      case "Run once": return { action: "run-once", draft: current };
      case "Keep for session": return { action: "keep-session", draft: current };
      case "Save permanently (user)": return { action: "save-user", draft: current };
      case "Save permanently (project)": return { action: "save-project", draft: current };
      case "Preview context": return { action: "preview-context", draft: current };
      default: return { action: "cancel", draft: current };
    }
  }
}
