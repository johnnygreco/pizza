import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir, withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import { parseAgentMarkdown, sanitizeAgentName, serializeAgentDefinition } from "./agent-serializer.ts";
import type { AgentDefinition, AgentSource, DiscoveryOptions, DiscoveryResult } from "./types.ts";

const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
export const BUILTIN_AGENTS_DIR = join(EXTENSION_DIR, "agents");

export function getUserAgentsDir(agentDir = getAgentDir()): string {
  return join(agentDir, "agents");
}

export function findNearestProjectAgentsDir(cwd: string): string | undefined {
  let current = cwd;
  while (true) {
    const candidate = join(current, ".pi", "agents");
    if (isDirectory(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function loadDefinitionsFromDir(dir: string, source: AgentSource): AgentDefinition[] {
  if (!existsSync(dir)) return [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const definitions: AgentDefinition[] = [];
  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    const filePath = join(dir, entry.name);
    try {
      const definition = parseAgentMarkdown(readFileSync(filePath, "utf8"), source, filePath);
      if (definition) definitions.push(definition);
    } catch {
      // Ignore malformed agent files during discovery. The manager can expose parse errors later.
    }
  }
  return definitions;
}

function precedence(source: AgentSource): number {
  switch (source) {
    case "builtin": return 0;
    case "user": return 1;
    case "project": return 2;
    case "session": return 3;
    case "one-off": return 4;
  }
}

export function discoverAgentDefinitions(cwd: string, options: DiscoveryOptions = {}): DiscoveryResult {
  const userDir = getUserAgentsDir();
  const projectDir = findNearestProjectAgentsDir(cwd);
  const all = [
    ...loadDefinitionsFromDir(BUILTIN_AGENTS_DIR, "builtin"),
    ...loadDefinitionsFromDir(userDir, "user"),
    ...(projectDir ? loadDefinitionsFromDir(projectDir, "project") : []),
    ...(options.sessionDefinitions ?? []).map((d) => ({ ...d, source: "session" as const })),
    ...(options.oneOffDefinition ? [{ ...options.oneOffDefinition, source: "one-off" as const }] : []),
  ];

  const byName = new Map<string, AgentDefinition>();
  for (const definition of all) {
    if (!options.includeDisabled && definition.enabled === false) continue;
    const key = sanitizeAgentName(definition.name);
    if (!key) continue;
    const normalized = { ...definition, name: key };
    const existing = byName.get(key);
    if (!existing || precedence(normalized.source) >= precedence(existing.source)) {
      byName.set(key, normalized);
    }
  }

  return {
    agents: Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name)),
    byName,
    directories: { builtin: BUILTIN_AGENTS_DIR, user: userDir, project: projectDir },
  };
}

export function resolveAgent(name: string, cwd: string, sessionDefinitions: AgentDefinition[] = []): AgentDefinition | undefined {
  return discoverAgentDefinitions(cwd, { sessionDefinitions }).byName.get(sanitizeAgentName(name));
}

export function getAgentFilePath(definition: AgentDefinition, scope: "user" | "project", cwd: string): string {
  const dir = scope === "user" ? getUserAgentsDir() : join(cwd, ".pi", "agents");
  return join(dir, `${sanitizeAgentName(definition.name)}.md`);
}

export async function saveAgentDefinition(definition: AgentDefinition, scope: "user" | "project", cwd: string): Promise<string> {
  const filePath = getAgentFilePath(definition, scope, cwd);
  await mkdir(dirname(filePath), { recursive: true });
  const saved: AgentDefinition = {
    ...definition,
    source: scope,
    filePath,
    createdBy: definition.createdBy ?? "pizza",
    createdAt: definition.createdAt ?? new Date().toISOString(),
  };
  await withFileMutationQueue(filePath, async () => {
    await writeFile(filePath, serializeAgentDefinition(saved), "utf8");
  });
  return filePath;
}

export function deleteAgentDefinition(definition: AgentDefinition): void {
  if (!definition.filePath) throw new Error("Agent has no file path");
  if (definition.source === "builtin") throw new Error("Builtin agents cannot be deleted");
  rmSync(definition.filePath, { force: true });
}

export function sessionDefinitionsFromEntries(entries: unknown[]): AgentDefinition[] {
  const definitions: AgentDefinition[] = [];
  for (const entry of entries as any[]) {
    if (entry?.type !== "custom" || entry?.customType !== "pizza-subagent-definition") continue;
    const data = entry.data;
    if (!data || typeof data !== "object") continue;
    const name = sanitizeAgentName(data.name ?? "");
    if (!name) continue;
    definitions.push({
      name,
      description: String(data.description ?? "Session subagent"),
      systemPrompt: String(data.systemPrompt ?? ""),
      tools: Array.isArray(data.tools) ? data.tools.map(String) : undefined,
      model: typeof data.model === "string" ? data.model : undefined,
      thinking: typeof data.thinking === "string" ? data.thinking : undefined,
      contextPolicy: data.contextPolicy ?? "project",
      deliveryPolicy: data.deliveryPolicy ?? "review",
      defaultRunMode: data.defaultRunMode ?? "background",
      source: "session",
      createdBy: data.createdBy,
      createdAt: data.createdAt,
      enabled: data.enabled !== false,
    } as AgentDefinition);
  }
  return definitions;
}
