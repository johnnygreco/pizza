import type { ThinkingLevel } from "@mariozechner/pi-agent-core";

export const CONTEXT_POLICIES = ["fresh", "project", "handoff", "fork", "explicit"] as const;
export type ContextPolicy = (typeof CONTEXT_POLICIES)[number];

export const MVP_CONTEXT_POLICIES = ["fresh", "project", "handoff"] as const;
export type MvpContextPolicy = (typeof MVP_CONTEXT_POLICIES)[number];

export const DELIVERY_POLICIES = [
  "notify",
  "review",
  "auto-inject",
  "pull",
  "artifact-ref",
  "repl",
  "mcp",
] as const;
export type DeliveryPolicy = (typeof DELIVERY_POLICIES)[number];

export const RUN_MODES = ["foreground", "background"] as const;
export type RunMode = (typeof RUN_MODES)[number];

export const AGENT_SOURCES = ["builtin", "user", "project", "session", "one-off"] as const;
export type AgentSource = (typeof AGENT_SOURCES)[number];

export type SubagentStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "stopped"
  | "aborted"
  | "review-needed"
  | "injected";

export interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens?: number;
}

export interface AgentDefinition {
  name: string;
  description: string;
  systemPrompt: string;
  tools?: string[];
  model?: string;
  thinking?: ThinkingLevel | "off";
  contextPolicy: ContextPolicy;
  deliveryPolicy: DeliveryPolicy;
  defaultRunMode?: RunMode;
  source: AgentSource;
  filePath?: string;
  createdBy?: "pizza" | "user";
  createdAt?: string;
  enabled?: boolean;
}

export interface DraftAgentDefinition extends AgentDefinition {
  rationale?: string[];
  warnings?: string[];
}

export interface DiscoveryOptions {
  includeDisabled?: boolean;
  sessionDefinitions?: AgentDefinition[];
  oneOffDefinition?: AgentDefinition;
}

export interface DiscoveryResult {
  agents: AgentDefinition[];
  byName: Map<string, AgentDefinition>;
  directories: {
    builtin: string;
    user: string;
    project?: string;
  };
}

export interface RunOptions {
  runMode: RunMode;
  contextPolicy?: ContextPolicy;
  deliveryPolicy?: DeliveryPolicy;
  cwd: string;
  sessionId?: string;
  parentContext?: string;
  signal?: AbortSignal;
  onProgress?: (run: SubagentRun) => void;
}

export interface SubagentRun {
  id: string;
  agentName: string;
  description: string;
  task: string;
  status: SubagentStatus;
  runMode: RunMode;
  contextPolicy: ContextPolicy;
  deliveryPolicy: DeliveryPolicy;
  startedAt: number;
  completedAt?: number;
  toolUses: number;
  turns: number;
  usage?: UsageStats;
  artifactDir: string;
  contextPath: string;
  promptPath: string;
  transcriptPath: string;
  resultPath: string;
  capsulePath: string;
  metadataPath: string;
  finalOutput?: string;
  capsule?: string;
  error?: string;
  model?: string;
  abortController?: AbortController;
}

export interface RunResult {
  run: SubagentRun;
  finalOutput: string;
  capsule: string;
}

export interface SubagentRunner {
  run(definition: AgentDefinition, task: string, options: RunOptions, run?: SubagentRun): Promise<RunResult>;
  stop(runId: string): Promise<void>;
}

export interface SubagentSettings {
  maxConcurrency: number;
  defaultDelivery: DeliveryPolicy;
  backgroundDelivery: DeliveryPolicy;
  foregroundDelivery: "inline" | DeliveryPolicy;
  confirmProjectAgents: boolean;
  artifactLocation: "agentDir";
  autoInjectTriggersTurn: boolean;
  disableBuiltins: boolean;
}

export const DEFAULT_SUBAGENT_SETTINGS: SubagentSettings = {
  maxConcurrency: 4,
  defaultDelivery: "review",
  backgroundDelivery: "review",
  foregroundDelivery: "inline",
  confirmProjectAgents: true,
  artifactLocation: "agentDir",
  autoInjectTriggersTurn: false,
  disableBuiltins: false,
};
