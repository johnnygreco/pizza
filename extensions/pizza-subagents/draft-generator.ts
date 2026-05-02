import { complete } from "@mariozechner/pi-ai";
import type { Model } from "@mariozechner/pi-ai";
import { normalizeDefinition, sanitizeAgentName, sanitizeTools } from "./agent-serializer.ts";
import type { DraftAgentDefinition } from "./types.ts";

export interface RawDraft {
  name?: unknown;
  description?: unknown;
  tools?: unknown;
  model?: unknown;
  thinking?: unknown;
  contextPolicy?: unknown;
  deliveryPolicy?: unknown;
  defaultRunMode?: unknown;
  systemPrompt?: unknown;
  rationale?: unknown;
  warnings?: unknown;
}

const GENERATOR_SYSTEM_PROMPT = `You design Pizza subagent definitions.
Return ONLY JSON matching this shape:
{
  "name": "kebab-case-name",
  "description": "one line",
  "tools": ["read", "bash"],
  "model": null,
  "thinking": null,
  "contextPolicy": "project",
  "deliveryPolicy": "review",
  "defaultRunMode": "background",
  "systemPrompt": "...",
  "rationale": ["..."],
  "warnings": ["..."]
}

Rules:
- Do not write files.
- Use kebab-case names.
- Review/analysis/scouting/planning agents should be read-only: read, grep, find, ls, bash when useful.
- Implementation agents may include read, edit, write, bash.
- Avoid model/provider unless the user explicitly asks.
- Prefer contextPolicy "project" for codebase specialists and "handoff" for implementation/planning workers.
- Prefer deliveryPolicy "review" and defaultRunMode "background" unless the agent is inherently quick/foreground.
- Make the systemPrompt autonomous, specific, safety-aware, and output-structured.
- Mention read-only bash limits for review/recon agents.`;

function extractTextFromAssistant(message: any): string {
  if (!message?.content) return "";
  return message.content
    .filter((part: any) => part?.type === "text")
    .map((part: any) => part.text)
    .join("\n")
    .trim();
}

function parseJsonObject(text: string): RawDraft {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(trimmed) as RawDraft;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Draft generator did not return JSON.");
    return JSON.parse(match[0]) as RawDraft;
  }
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => String(item)).filter(Boolean);
}

function heuristicDraft(description: string): RawDraft {
  const lower = description.toLowerCase();
  const implementation = /\b(implement|fix|change|write|edit|build|refactor|add|remove|update)\b/.test(lower);
  const planning = /\b(plan|design|spec|architecture|strategy)\b/.test(lower);
  const review = /\b(review|audit|security|quality|accessibility|a11y|analy[sz]e|inspect|scout|find)\b/.test(lower);
  const nameBase = description.split(/\s+/).slice(0, 5).join(" ");
  const name = sanitizeAgentName(nameBase || (implementation ? "worker" : planning ? "planner" : review ? "reviewer" : "specialist"));
  const tools = implementation ? ["read", "edit", "write", "bash"] : ["read", "grep", "find", "ls", ...(review ? ["bash"] : [])];
  const contextPolicy = implementation || planning ? "handoff" : "project";
  return {
    name,
    description: description.replace(/\s+/g, " ").trim(),
    tools,
    model: null,
    thinking: null,
    contextPolicy,
    deliveryPolicy: "review",
    defaultRunMode: "background",
    systemPrompt: [
      `You are ${name}, a specialized Pizza subagent.`,
      `Mission: ${description.trim()}.`,
      implementation
        ? "Make focused, minimal code changes for the delegated task. Inspect relevant files first, edit carefully, and run targeted validation when practical."
        : "Do not modify files. Investigate carefully and report concise, evidence-backed findings with file paths and line numbers when relevant.",
      "Output structured results with: Summary, Evidence, Risks/Open Questions, Suggested Next Action.",
    ].join("\n\n"),
    rationale: [implementation ? "Implementation wording suggests edit/write tools." : "Read-only tools selected for analysis/review work."],
    warnings: [],
  };
}

export function validateDraft(raw: RawDraft, originalDescription: string): DraftAgentDefinition {
  const rationale = asStringArray(raw.rationale) ?? [];
  const rawWarnings = asStringArray(raw.warnings) ?? [];
  const normalized = normalizeDefinition(
    {
      name: typeof raw.name === "string" ? raw.name : sanitizeAgentName(originalDescription),
      description: typeof raw.description === "string" ? raw.description : originalDescription,
      tools: sanitizeTools(Array.isArray(raw.tools) ? raw.tools.map(String) : undefined),
      model: typeof raw.model === "string" ? raw.model : undefined,
      thinking: typeof raw.thinking === "string" ? raw.thinking as any : undefined,
      contextPolicy: typeof raw.contextPolicy === "string" ? raw.contextPolicy as any : "project",
      deliveryPolicy: typeof raw.deliveryPolicy === "string" ? raw.deliveryPolicy as any : "review",
      defaultRunMode: raw.defaultRunMode === "foreground" || raw.defaultRunMode === "background" ? raw.defaultRunMode : "background",
      systemPrompt: typeof raw.systemPrompt === "string" ? raw.systemPrompt : undefined,
      createdBy: "pizza",
      createdAt: new Date().toISOString(),
    },
    "one-off",
  );
  return {
    ...normalized.definition,
    source: "one-off",
    rationale,
    warnings: [...rawWarnings, ...normalized.warnings],
  };
}

export async function generateDraft(description: string, model: Model<any> | undefined, signal?: AbortSignal): Promise<DraftAgentDefinition> {
  const trimmed = description.trim();
  if (!trimmed) throw new Error("Subagent description is required.");
  if (!model) return validateDraft(heuristicDraft(trimmed), trimmed);

  try {
    const response = await complete(
      model,
      {
        systemPrompt: GENERATOR_SYSTEM_PROMPT,
        messages: [{ role: "user", content: `Design a subagent for: ${trimmed}`, timestamp: Date.now() }],
      },
      { signal, maxTokens: 4000 },
    );
    return validateDraft(parseJsonObject(extractTextFromAssistant(response)), trimmed);
  } catch (error) {
    const draft = validateDraft(heuristicDraft(trimmed), trimmed);
    draft.warnings = [...(draft.warnings ?? []), `Model draft generation failed; used a local heuristic: ${error instanceof Error ? error.message : String(error)}`];
    return draft;
  }
}

export function draftToReviewMarkdown(draft: DraftAgentDefinition): string {
  const tools = draft.tools === undefined ? "default" : draft.tools.length === 0 ? "none" : draft.tools.join(", ");
  return [
    `# ${draft.name}`,
    "",
    draft.description,
    "",
    `- Tools: ${tools}`,
    `- Model: ${draft.model ?? "inherit"}`,
    `- Thinking: ${draft.thinking ?? "inherit"}`,
    `- Context: ${draft.contextPolicy}`,
    `- Delivery: ${draft.deliveryPolicy}`,
    `- Run: ${draft.defaultRunMode ?? "background"}`,
    "",
    "## System Prompt",
    "",
    draft.systemPrompt,
    "",
    "## Rationale",
    ...(draft.rationale?.length ? draft.rationale.map((r) => `- ${r}`) : ["- (none)"]),
    "",
    "## Warnings",
    ...(draft.warnings?.length ? draft.warnings.map((w) => `- ${w}`) : ["- (none)"]),
  ].join("\n");
}
