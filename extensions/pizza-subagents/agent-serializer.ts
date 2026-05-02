import { parseFrontmatter } from "@mariozechner/pi-coding-agent";
import type { AgentDefinition, AgentSource, ContextPolicy, DeliveryPolicy, RunMode } from "./types.ts";
import { CONTEXT_POLICIES, DELIVERY_POLICIES } from "./types.ts";

const VALID_THINKING = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);
const BUILTIN_TOOL_NAMES = new Set(["read", "bash", "edit", "write", "grep", "find", "ls"]);

export function sanitizeAgentName(input: string, fallback = "subagent"): string {
  const slug = String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || fallback;
}

export function isValidAgentName(name: string): boolean {
  return sanitizeAgentName(name) === name && name.length > 0;
}

export function parseTools(value: unknown): string[] | undefined {
  if (value == null || value === "") return undefined;
  if (Array.isArray(value)) return sanitizeTools(value.map(String));
  const text = String(value).trim();
  if (!text) return undefined;
  if (text.toLowerCase() === "none") return [];
  return sanitizeTools(text.split(","));
}

export function sanitizeTools(tools: string[] | undefined): string[] | undefined {
  if (tools === undefined) return undefined;
  const result: string[] = [];
  for (const raw of tools) {
    const tool = String(raw).trim();
    if (!tool) continue;
    if (tool === "subagent") continue;
    if (!/^[a-zA-Z0-9_-]+$/.test(tool)) continue;
    if (!BUILTIN_TOOL_NAMES.has(tool) && !tool.startsWith("pizza_")) continue;
    if (!result.includes(tool)) result.push(tool);
  }
  return result;
}

export function isContextPolicy(value: unknown): value is ContextPolicy {
  return typeof value === "string" && (CONTEXT_POLICIES as readonly string[]).includes(value);
}

export function isDeliveryPolicy(value: unknown): value is DeliveryPolicy {
  return typeof value === "string" && (DELIVERY_POLICIES as readonly string[]).includes(value);
}

function parseRunMode(value: unknown): RunMode | undefined {
  if (value === true || value === "true" || value === "background") return "background";
  if (value === false || value === "false" || value === "foreground") return "foreground";
  return undefined;
}

function parseOptionalString(value: unknown): string | undefined {
  if (value == null) return undefined;
  const text = String(value).trim();
  return text.length > 0 ? text : undefined;
}

export interface ValidationResult {
  definition: AgentDefinition;
  warnings: string[];
}

export function normalizeDefinition(input: Partial<AgentDefinition>, source: AgentSource): ValidationResult {
  const warnings: string[] = [];
  const name = sanitizeAgentName(input.name ?? "subagent");
  if (input.name && input.name !== name) warnings.push(`Agent name sanitized to "${name}".`);

  const description = parseOptionalString(input.description) ?? "Pizza subagent";
  if (!input.description) warnings.push("Missing description; using a generic description.");

  let contextPolicy: ContextPolicy = "project";
  if (isContextPolicy(input.contextPolicy)) contextPolicy = input.contextPolicy;
  else if (input.contextPolicy) warnings.push(`Invalid context policy "${String(input.contextPolicy)}"; using project.`);

  let deliveryPolicy: DeliveryPolicy = "review";
  if (isDeliveryPolicy(input.deliveryPolicy)) deliveryPolicy = input.deliveryPolicy;
  else if (input.deliveryPolicy) warnings.push(`Invalid delivery policy "${String(input.deliveryPolicy)}"; using review.`);

  const defaultRunMode = input.defaultRunMode === "foreground" || input.defaultRunMode === "background"
    ? input.defaultRunMode
    : deliveryPolicy === "notify" || deliveryPolicy === "pull"
      ? "foreground"
      : "background";

  const thinking = input.thinking && VALID_THINKING.has(String(input.thinking)) ? input.thinking : undefined;
  if (input.thinking && !thinking) warnings.push(`Invalid thinking level "${String(input.thinking)}"; inheriting parent setting.`);

  const systemPrompt = parseOptionalString(input.systemPrompt) ?? [
    `You are ${name}, a specialized Pizza subagent.`,
    "Complete the delegated task carefully and report concise, actionable results with file paths and evidence when relevant.",
  ].join("\n\n");

  return {
    warnings,
    definition: {
      name,
      description,
      systemPrompt,
      tools: sanitizeTools(input.tools),
      model: parseOptionalString(input.model),
      thinking,
      contextPolicy,
      deliveryPolicy,
      defaultRunMode,
      source,
      filePath: input.filePath,
      createdBy: input.createdBy,
      createdAt: input.createdAt,
      enabled: input.enabled !== false,
    },
  };
}

export function parseAgentMarkdown(content: string, source: AgentSource, filePath?: string): AgentDefinition | undefined {
  const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(content);
  const fallbackName = filePath ? sanitizeAgentName(filePath.replace(/^.*[\\/]/, "").replace(/\.md$/i, "")) : "subagent";
  const name = sanitizeAgentName(parseOptionalString(frontmatter.name) ?? fallbackName, fallbackName);
  const description = parseOptionalString(frontmatter.description);
  if (!description) return undefined;
  if (frontmatter.enabled === false || String(frontmatter.enabled).toLowerCase() === "false") {
    return {
      name,
      description,
      systemPrompt: body.trim(),
      contextPolicy: "project",
      deliveryPolicy: "review",
      source,
      filePath,
      enabled: false,
    };
  }

  const contextValue = frontmatter.context ?? frontmatter.contextPolicy;
  const deliveryValue = frontmatter.delivery ?? frontmatter.deliveryPolicy;
  const runModeValue = frontmatter.run_in_background ?? frontmatter.defaultRunMode;
  const normalized = normalizeDefinition(
    {
      name,
      description,
      systemPrompt: body.trim(),
      tools: parseTools(frontmatter.tools),
      model: parseOptionalString(frontmatter.model),
      thinking: parseOptionalString(frontmatter.thinking) as AgentDefinition["thinking"],
      contextPolicy: isContextPolicy(contextValue) ? contextValue : "project",
      deliveryPolicy: isDeliveryPolicy(deliveryValue) ? deliveryValue : "review",
      defaultRunMode: parseRunMode(runModeValue),
      createdBy: frontmatter.created_by === "pizza" ? "pizza" : frontmatter.created_by === "user" ? "user" : undefined,
      createdAt: parseOptionalString(frontmatter.created_at),
      filePath,
      enabled: true,
    },
    source,
  ).definition;
  return normalized;
}

function yamlValue(value: string | undefined): string {
  if (!value) return "";
  if (/^[a-zA-Z0-9_.\-/]+$/.test(value)) return value;
  return JSON.stringify(value);
}

export function serializeAgentDefinition(definition: AgentDefinition): string {
  const tools = definition.tools === undefined ? undefined : definition.tools.length === 0 ? "none" : definition.tools.join(",");
  const lines = [
    "---",
    `name: ${definition.name}`,
    `description: ${yamlValue(definition.description)}`,
  ];
  if (tools !== undefined) lines.push(`tools: ${tools}`);
  lines.push(`model: ${definition.model ?? ""}`);
  lines.push(`thinking: ${definition.thinking ?? ""}`);
  lines.push(`context: ${definition.contextPolicy}`);
  lines.push(`delivery: ${definition.deliveryPolicy}`);
  lines.push(`run_in_background: ${definition.defaultRunMode === "background" ? "true" : "false"}`);
  if (definition.createdBy) lines.push(`created_by: ${definition.createdBy}`);
  if (definition.createdAt) lines.push(`created_at: ${definition.createdAt}`);
  if (definition.enabled === false) lines.push("enabled: false");
  lines.push("---", "", definition.systemPrompt.trim(), "");
  return lines.join("\n");
}

export function formatAgentSummary(definition: AgentDefinition): string {
  const tools = definition.tools === undefined ? "default" : definition.tools.length === 0 ? "none" : definition.tools.join(", ");
  return `${definition.name} (${definition.source}) — ${definition.description}\n  tools: ${tools}; context: ${definition.contextPolicy}; delivery: ${definition.deliveryPolicy}; run: ${definition.defaultRunMode ?? "foreground"}`;
}
