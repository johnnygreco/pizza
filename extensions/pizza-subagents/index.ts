import { CustomEditor, type ExtensionAPI, type ExtensionContext, type KeybindingsManager } from "@mariozechner/pi-coding-agent";
import { StringEnum, Type } from "@mariozechner/pi-ai";
import { Text, type AutocompleteProvider, type EditorComponent, type EditorTheme, type TUI } from "@mariozechner/pi-tui";
import { discoverAgentDefinitions, sessionDefinitionsFromEntries } from "./agents.ts";
import { formatSubagentActivity, readSubagentActivity } from "./activity.ts";
import { formatAgentSummary } from "./agent-serializer.ts";
import { registerCreateSubagentCommand } from "./create-command.ts";
import { registerSubagentsCommand, type SessionRegistry } from "./manager-command.ts";
import { registerRemoveSubagentCommand } from "./remove-command.ts";
import { SubagentRunManager } from "./run-manager.ts";
import { SubprocessSubagentRunner } from "./runner.ts";
import { registerMessageRenderer, renderSubagentResult } from "./renderers.ts";
import { getSubagentAutocompletePrefix, isSubagentListInvocation, parseSubagentInvocation } from "./syntax.ts";
import type { AgentDefinition, ContextPolicy, DeliveryPolicy, RunMode, SubagentRun } from "./types.ts";

const ActionSchema = StringEnum(["run", "list", "status", "result", "stop", "activity"] as const, { default: "run" });
const RunModeSchema = StringEnum(["foreground", "background"] as const);
const ContextPolicySchema = StringEnum(["fresh", "project", "handoff", "fork", "explicit"] as const);
const DeliveryPolicySchema = StringEnum(["notify", "review", "auto-inject", "pull", "artifact-ref"] as const);

const SubagentToolParams = Type.Object({
  action: Type.Optional(ActionSchema),
  agent: Type.Optional(Type.String({ description: "Subagent name" })),
  task: Type.Optional(Type.String({ description: "Task to delegate" })),
  runMode: Type.Optional(RunModeSchema),
  contextPolicy: Type.Optional(ContextPolicySchema),
  deliveryPolicy: Type.Optional(DeliveryPolicySchema),
  runId: Type.Optional(Type.String()),
  wait: Type.Optional(Type.Boolean({ default: false })),
});

type SubagentToolInput = {
  action?: "run" | "list" | "status" | "result" | "stop" | "activity";
  agent?: string;
  task?: string;
  runMode?: RunMode;
  contextPolicy?: ContextPolicy;
  deliveryPolicy?: DeliveryPolicy;
  runId?: string;
  wait?: boolean;
};

class InMemorySessionRegistry implements SessionRegistry {
  private definitions = new Map<string, AgentDefinition>();
  private removed = new Set<string>();

  restore(entries: unknown[]): void {
    this.definitions.clear();
    this.removed.clear();
    for (const entry of entries as any[]) {
      if (entry?.type !== "custom") continue;
      if (entry.customType === "pizza-subagent-definition-removed") {
        const name = typeof entry.data?.name === "string" ? entry.data.name : undefined;
        if (!name) continue;
        this.removed.add(name);
        this.definitions.delete(name);
        continue;
      }
      if (entry.customType === "pizza-subagent-definition") {
        for (const definition of sessionDefinitionsFromEntries([entry])) {
          this.removed.delete(definition.name);
          this.definitions.set(definition.name, definition);
        }
      }
    }
  }

  list(): AgentDefinition[] {
    return Array.from(this.definitions.values());
  }

  add(definition: AgentDefinition): void {
    this.removed.delete(definition.name);
    this.definitions.set(definition.name, { ...definition, source: "session" });
  }

  remove(name: string): boolean {
    this.removed.add(name);
    return this.definitions.delete(name);
  }
}

function buildParentHandoff(ctx: ExtensionContext): string {
  const branch = ctx.sessionManager.getBranch?.() ?? ctx.sessionManager.getEntries();
  return (branch as any[]).slice(-10).map((entry) => {
    const msg = entry?.message;
    if (!msg) return "";
    const content = Array.isArray(msg.content)
      ? msg.content.filter((p: any) => p.type === "text").map((p: any) => p.text).join(" ")
      : String(msg.content ?? "");
    return `${msg.role}: ${content.replace(/\s+/g, " ").slice(0, 500)}`;
  }).filter(Boolean).join("\n");
}

function terminal(run: SubagentRun): boolean {
  return ["completed", "failed", "stopped", "aborted", "review-needed", "injected"].includes(run.status);
}

async function maybeConfirmProjectAgent(ctx: ExtensionContext, definition: AgentDefinition): Promise<boolean> {
  if (definition.source !== "project") return true;
  if (!ctx.hasUI) return false;
  return ctx.ui.confirm(
    "Run project-local subagent?",
    `${definition.name}\n${definition.filePath ?? "(unknown path)"}\n\nProject agents are repo-controlled prompts. Only continue for trusted repositories.`,
  );
}

export default function pizzaSubagentsExtension(pi: ExtensionAPI): void {
  const registry = new InMemorySessionRegistry();
  const manager = new SubagentRunManager(pi, new SubprocessSubagentRunner(), 4);

  registerMessageRenderer(pi as any);
  registerCreateSubagentCommand(pi, manager, (definition) => registry.add(definition));
  registerSubagentsCommand(pi, manager, registry);
  registerRemoveSubagentCommand(pi, registry);

  pi.on("session_start", async (_event, ctx) => {
    registry.restore(ctx.sessionManager.getEntries());
    installSubagentAutocomplete(ctx, registry);
  });

  pi.on("session_shutdown", async () => {
    await manager.shutdown();
  });

  pi.on("input", async (event, ctx) => {
    if (event.source === "extension" || event.text.trimStart().startsWith("/")) return { action: "continue" };
    const invocation = parseSubagentInvocation(event.text);
    if (!invocation) return { action: "continue" };

    const discovery = discoverAgentDefinitions(ctx.cwd, { sessionDefinitions: registry.list() });
    if (isSubagentListInvocation(invocation)) {
      const text = formatSubagentList(discovery.agents);
      if (ctx.hasUI) ctx.ui.notify(text, "info");
      else console.log(text);
      return { action: "handled" };
    }

    const definition = discovery.byName.get(invocation.agent);
    if (!definition) {
      const available = discovery.agents.map((agent) => agent.name).join(", ") || "none";
      if (ctx.hasUI) ctx.ui.notify(`Unknown subagent "${invocation.agent}". Available: ${available}`, "warning");
      else console.log(`Unknown subagent "${invocation.agent}". Available: ${available}`);
      return { action: "handled" };
    }

    if (!(await maybeConfirmProjectAgent(ctx, definition))) {
      if (ctx.hasUI) ctx.ui.notify("Canceled: project-local subagent not approved.", "info");
      return { action: "handled" };
    }

    try {
      const run = await manager.run(definition, invocation.prompt, {
        cwd: ctx.cwd,
        runMode: definition.defaultRunMode ?? "background",
        contextPolicy: definition.contextPolicy,
        deliveryPolicy: definition.deliveryPolicy,
        parentContext: buildParentHandoff(ctx),
        sessionId: ctx.sessionManager.getSessionId?.(),
      }, ctx);
      const promptLabel = invocation.prompt.trim() ? `: ${invocation.prompt.trim().slice(0, 80)}` : " with no user prompt";
      if (ctx.hasUI) ctx.ui.notify(`Started ${definition.name}${promptLabel}. Run id: ${run.id}`, "info");
      else console.log(`Started ${definition.name}${promptLabel}. Run id: ${run.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (ctx.hasUI) ctx.ui.notify(`Subagent ${definition.name} failed: ${message}`, "error");
      else console.error(`Subagent ${definition.name} failed: ${message}`);
    }
    return { action: "handled" };
  });

  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description: "List, run, inspect, and stop Pizza subagents with transparent artifacts and reviewable results.",
    promptSnippet: "Delegate scoped work to Pizza subagents; use list/status/result before polling or creating agents.",
    promptGuidelines: [
      "Use subagent for clearly separable research, planning, review, or implementation tasks when isolated context helps.",
      "Use /create-subagent for user-driven creation; do not silently create persistent agents.",
      "For background subagent runs, do not busy-poll; tell the user the run id and rely on notification/review flow unless they ask for status.",
      "When delegating with subagent, explain the context policy and delivery policy in plain language.",
    ],
    parameters: SubagentToolParams,
    async execute(_toolCallId, params: SubagentToolInput, signal, _onUpdate, ctx) {
      const action = params.action ?? "run";
      const discovery = discoverAgentDefinitions(ctx.cwd, { sessionDefinitions: registry.list() });

      if (action === "list") {
        const text = discovery.agents.map(formatAgentSummary).join("\n\n") || "No subagents available.";
        return { content: [{ type: "text", text }], details: { action, agents: discovery.agents } };
      }

      if (action === "status") {
        const runs = manager.listRuns();
        const text = runs.length ? runs.map((run) => {
          const activity = readSubagentActivity(run.transcriptPath);
          const counts = activity ? ` (${activity.turns} turns, ${activity.toolUses} tools${activity.sawAgentEnd ? ", agent_end seen" : ""})` : "";
          return `${run.id} ${run.status}${counts} ${run.agentName}: ${run.task}`;
        }).join("\n") : "No subagent runs yet.";
        return { content: [{ type: "text", text }], details: { action, runs: runs.map(publicRun) } };
      }

      if (action === "activity") {
        if (!params.runId) return { content: [{ type: "text", text: "runId is required for activity." }], details: { action }, isError: true } as any;
        const run = manager.getRun(params.runId);
        if (!run) return { content: [{ type: "text", text: `Unknown subagent run: ${params.runId}` }], details: { action }, isError: true } as any;
        const activity = readSubagentActivity(run.transcriptPath);
        return { content: [{ type: "text", text: formatSubagentActivity(activity) }], details: { action, status: run.status, run: publicRun(run), activity } };
      }

      if (action === "result") {
        if (!params.runId) return { content: [{ type: "text", text: "runId is required for result." }], details: { action }, isError: true } as any;
        let run = manager.getRun(params.runId);
        if (params.wait) {
          const start = Date.now();
          while (run && !terminal(run) && Date.now() - start < 60000) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            run = manager.getRun(params.runId!);
          }
        }
        if (!run) return { content: [{ type: "text", text: `Unknown subagent run: ${params.runId}` }], details: { action }, isError: true } as any;
        const activity = readSubagentActivity(run.transcriptPath);
        const text = run.capsule ?? run.finalOutput ?? `Run ${run.id} is ${run.status}.\n\n${formatSubagentActivity(activity)}`;
        return { content: [{ type: "text", text }], details: { action, status: run.status, run: publicRun(run), artifacts: artifacts(run), capsule: run.capsule, activity } };
      }

      if (action === "stop") {
        if (!params.runId) return { content: [{ type: "text", text: "runId is required for stop." }], details: { action }, isError: true } as any;
        const ok = await manager.stop(params.runId);
        return { content: [{ type: "text", text: ok ? `Stopped ${params.runId}.` : `Unknown subagent run: ${params.runId}` }], details: { action, stopped: ok } };
      }

      if (!params.agent || !params.task) {
        const available = discovery.agents.map((agent) => agent.name).join(", ") || "none";
        return { content: [{ type: "text", text: `agent and task are required for run. Available agents: ${available}` }], details: { action }, isError: true } as any;
      }
      const definition = discovery.byName.get(params.agent);
      if (!definition) {
        const available = discovery.agents.map((agent) => agent.name).join(", ") || "none";
        return { content: [{ type: "text", text: `Unknown subagent ${params.agent}. Available: ${available}` }], details: { action }, isError: true } as any;
      }
      if (!(await maybeConfirmProjectAgent(ctx, definition))) {
        return { content: [{ type: "text", text: "Canceled: project-local subagent not approved or no UI is available to confirm it." }], details: { action } };
      }

      const run = await manager.run(definition, params.task, {
        cwd: ctx.cwd,
        runMode: params.runMode ?? definition.defaultRunMode ?? "foreground",
        contextPolicy: params.contextPolicy ?? definition.contextPolicy,
        deliveryPolicy: params.deliveryPolicy ?? definition.deliveryPolicy,
        parentContext: buildParentHandoff(ctx),
        sessionId: ctx.sessionManager.getSessionId?.(),
        signal,
      }, ctx);

      const text = run.runMode === "background"
        ? `Started background subagent ${definition.name}. Run id: ${run.id}. Delivery: ${run.deliveryPolicy}. Artifacts: ${run.artifactDir}`
        : (run.finalOutput ?? run.capsule ?? `Subagent ${definition.name} completed. Run id: ${run.id}`);
      return { content: [{ type: "text", text }], details: { action, status: run.status, run: publicRun(run), artifacts: artifacts(run), capsule: run.capsule } };
    },
    renderCall(args: SubagentToolInput, theme) {
      const action = args.action ?? "run";
      const target = args.agent ? ` ${args.agent}` : args.runId ? ` ${args.runId}` : "";
      const task = args.task ? `\n  ${theme.fg("dim", args.task.slice(0, 80))}` : "";
      return new Text(theme.fg("toolTitle", theme.bold("subagent")) + theme.fg("accent", ` ${action}${target}`) + task, 0, 0);
    },
    renderResult: renderSubagentResult,
  });
}

function artifacts(run: SubagentRun): Record<string, string> {
  return {
    context: run.contextPath,
    transcript: run.transcriptPath,
    result: run.resultPath,
    capsule: run.capsulePath,
    metadata: run.metadataPath,
  };
}

function publicRun(run: SubagentRun): Omit<SubagentRun, "abortController"> {
  const { abortController: _abortController, ...serializable } = run;
  return serializable;
}

function createSubagentAutocompleteProvider(
  base: AutocompleteProvider & { shouldTriggerFileCompletion?: (lines: string[], cursorLine: number, cursorCol: number) => boolean },
  ctx: ExtensionContext,
  registry: SessionRegistry,
): AutocompleteProvider & { shouldTriggerFileCompletion?: (lines: string[], cursorLine: number, cursorCol: number) => boolean } {
  return {
    async getSuggestions(lines, cursorLine, cursorCol, options) {
      const line = lines[cursorLine] ?? "";
      const beforeCursor = line.slice(0, cursorCol);
      const match = getSubagentAutocompletePrefix(beforeCursor);
      if (!match) return base.getSuggestions(lines, cursorLine, cursorCol, options);

      const agents = discoverAgentDefinitions(ctx.cwd, { sessionDefinitions: registry.list() }).agents;
      const items = agents
        .filter((agent) => agent.name.startsWith(match.query))
        .map((agent) => ({
          value: `:${agent.name}`,
          label: `:${agent.name}`,
          description: `${agent.source} — ${agent.description}`,
        }));
      return { prefix: match.prefix, items };
    },
    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      if (!String(item.value).startsWith(":")) {
        return base.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
      }
      const line = lines[cursorLine] ?? "";
      const before = line.slice(0, cursorCol - prefix.length);
      const after = line.slice(cursorCol);
      const replacement = `${item.value} `;
      const nextLine = `${before}${replacement}${after}`;
      return {
        lines: [...lines.slice(0, cursorLine), nextLine, ...lines.slice(cursorLine + 1)],
        cursorLine,
        cursorCol: before.length + replacement.length,
      };
    },
    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      const line = lines[cursorLine] ?? "";
      if (getSubagentAutocompletePrefix(line.slice(0, cursorCol))) return true;
      return base.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
    },
  };
}

class SubagentAutocompleteEditor implements EditorComponent {
  private _onSubmit?: (text: string) => void;
  private _onChange?: (text: string) => void;
  readonly actionHandlers: Map<any, () => void>;

  constructor(
    private readonly inner: EditorComponent,
    private readonly keybindings: KeybindingsManager,
  ) {
    this.actionHandlers = (inner as any).actionHandlers instanceof Map ? (inner as any).actionHandlers : new Map();
  }

  get onEscape(): (() => void) | undefined {
    return (this.inner as any).onEscape;
  }

  set onEscape(handler: (() => void) | undefined) {
    (this.inner as any).onEscape = handler;
  }

  get onCtrlD(): (() => void) | undefined {
    return (this.inner as any).onCtrlD;
  }

  set onCtrlD(handler: (() => void) | undefined) {
    (this.inner as any).onCtrlD = handler;
  }

  get onPasteImage(): (() => void) | undefined {
    return (this.inner as any).onPasteImage;
  }

  set onPasteImage(handler: (() => void) | undefined) {
    (this.inner as any).onPasteImage = handler;
  }

  get onExtensionShortcut(): ((data: string) => boolean | undefined) | undefined {
    return (this.inner as any).onExtensionShortcut;
  }

  set onExtensionShortcut(handler: ((data: string) => boolean | undefined) | undefined) {
    (this.inner as any).onExtensionShortcut = handler;
  }

  get onSubmit(): ((text: string) => void) | undefined {
    return this._onSubmit;
  }

  set onSubmit(handler: ((text: string) => void) | undefined) {
    this._onSubmit = handler;
    this.inner.onSubmit = handler;
  }

  get onChange(): ((text: string) => void) | undefined {
    return this._onChange;
  }

  set onChange(handler: ((text: string) => void) | undefined) {
    this._onChange = handler;
    this.inner.onChange = handler;
  }

  get focused(): boolean {
    return Boolean((this.inner as any).focused);
  }

  set focused(value: boolean) {
    (this.inner as any).focused = value;
  }

  get wantsKeyRelease(): boolean | undefined {
    return this.inner.wantsKeyRelease;
  }

  get borderColor(): ((str: string) => string) | undefined {
    return this.inner.borderColor;
  }

  set borderColor(value: ((str: string) => string) | undefined) {
    this.inner.borderColor = value;
  }

  render(width: number): string[] {
    return this.inner.render(width);
  }

  invalidate(): void {
    this.inner.invalidate();
  }

  getText(): string {
    return this.inner.getText();
  }

  getExpandedText(): string {
    return this.inner.getExpandedText?.() ?? this.inner.getText();
  }

  getLines(): string[] {
    return (this.inner as any).getLines?.() ?? this.inner.getText().split("\n");
  }

  getCursor(): { line: number; col: number } {
    const cursor = (this.inner as any).getCursor?.();
    if (cursor && typeof cursor.line === "number" && typeof cursor.col === "number") return cursor;
    const lines = this.getLines();
    const line = Math.max(0, lines.length - 1);
    return { line, col: lines[line]?.length ?? 0 };
  }

  setText(text: string): void {
    this.inner.setText(text);
  }

  addToHistory(text: string): void {
    this.inner.addToHistory?.(text);
  }

  insertTextAtCursor(text: string): void {
    this.inner.insertTextAtCursor?.(text);
  }

  setAutocompleteProvider(provider: AutocompleteProvider): void {
    this.inner.setAutocompleteProvider?.(provider);
  }

  setPaddingX(padding: number): void {
    this.inner.setPaddingX?.(padding);
  }

  setAutocompleteMaxVisible(maxVisible: number): void {
    this.inner.setAutocompleteMaxVisible?.(maxVisible);
  }

  handleInput(data: string): void {
    const tabInSubagentContext = this.keybindings.matches(data, "tui.input.tab") && this.getSubagentAutocompleteMatch() !== undefined;
    if (tabInSubagentContext && !this.isShowingAutocomplete()) {
      this.requestAutocomplete(false, true);
      return;
    }

    this.inner.handleInput(data);

    if (this.shouldTriggerAfterInput(data) && !this.isShowingAutocomplete() && this.getSubagentAutocompleteMatch()) {
      this.requestAutocomplete(false, false);
    }
  }

  private getSubagentAutocompleteMatch(): ReturnType<typeof getSubagentAutocompletePrefix> {
    const lines = this.getLines();
    const cursor = this.getCursor();
    const line = lines[cursor.line] ?? "";
    return getSubagentAutocompletePrefix(line.slice(0, cursor.col));
  }

  private shouldTriggerAfterInput(data: string): boolean {
    return data === ":"
      || /^[a-zA-Z0-9_-]$/.test(data)
      || this.keybindings.matches(data, "tui.editor.deleteCharBackward")
      || this.keybindings.matches(data, "tui.editor.deleteCharForward");
  }

  private isShowingAutocomplete(): boolean {
    return Boolean((this.inner as any).isShowingAutocomplete?.());
  }

  private requestAutocomplete(force: boolean, explicitTab: boolean): void {
    // Pi's editor only auto-opens built-in trigger characters. Use the same
    // request path slash commands use so ":" gets a normal autocomplete menu.
    const editor = this.inner as any;
    if (typeof editor.requestAutocomplete === "function") {
      editor.requestAutocomplete({ force, explicitTab });
    } else if (typeof editor.tryTriggerAutocomplete === "function") {
      editor.tryTriggerAutocomplete(explicitTab);
    }
  }
}

function installSubagentAutocompleteTrigger(ctx: ExtensionContext): void {
  const currentEditor = ctx.ui.getEditorComponent();
  ctx.ui.setEditorComponent((tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => {
    const inner = currentEditor
      ? currentEditor(tui, theme, keybindings)
      : new CustomEditor(tui, theme, keybindings);
    return new SubagentAutocompleteEditor(inner, keybindings);
  });
}

function installSubagentAutocomplete(ctx: ExtensionContext, registry: SessionRegistry): void {
  if (!ctx.hasUI) return;
  ctx.ui.addAutocompleteProvider((current) => createSubagentAutocompleteProvider(current, ctx, registry));
  installSubagentAutocompleteTrigger(ctx);
}


function formatSubagentList(agents: AgentDefinition[]): string {
  if (agents.length === 0) return "No subagents available.";
  return [
    "Available Pizza subagents:",
    ...agents.map((agent) => `- ${agent.name} (${agent.source}) — ${agent.description}`),
    "",
    "Run one with: :<agent-name> <prompt>",
  ].join("\n");
}
