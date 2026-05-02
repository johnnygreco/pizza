import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { createRunRecord, writeMetadata } from "./artifacts.ts";
import { deliverRunResult, type DeliveryState } from "./delivery.ts";
import type { AgentDefinition, DeliveryPolicy, RunMode, RunOptions, SubagentRun, SubagentRunner } from "./types.ts";
import { updateSubagentsWidget } from "./widget.ts";

interface QueueItem {
  definition: AgentDefinition;
  task: string;
  options: RunOptions;
  run: SubagentRun;
  ctx?: ExtensionContext;
  resolve: (run: SubagentRun) => void;
  reject: (error: Error) => void;
}

export class SubagentRunManager {
  readonly runs = new Map<string, SubagentRun>();
  readonly state: DeliveryState = { reviewInbox: [], recentRuns: [] };
  private queue: QueueItem[] = [];
  private active = 0;

  constructor(
    private readonly pi: ExtensionAPI,
    private readonly runner: SubagentRunner,
    private readonly maxConcurrency = 4,
  ) {}

  async run(definition: AgentDefinition, task: string, options: Omit<RunOptions, "runMode"> & { runMode?: RunMode }, ctx?: ExtensionContext): Promise<SubagentRun> {
    const runMode = options.runMode ?? definition.defaultRunMode ?? "foreground";
    const deliveryPolicy: DeliveryPolicy = options.deliveryPolicy ?? (runMode === "background" ? "review" : definition.deliveryPolicy);
    const fullOptions: RunOptions = {
      ...options,
      runMode,
      deliveryPolicy,
      onProgress: (run) => {
        options.onProgress?.(run);
        this.updateWidget(ctx);
      },
    };
    const run = await createRunRecord(definition, task, fullOptions);
    this.runs.set(run.id, run);

    if (runMode === "foreground") {
      await this.executeForeground(definition, task, fullOptions, run, ctx);
      return run;
    }

    this.queue.push({
      definition,
      task,
      options: fullOptions,
      run,
      ctx,
      resolve: () => undefined,
      reject: () => undefined,
    });
    this.updateWidget(ctx);
    this.pump();
    return run;
  }

  listRuns(): SubagentRun[] {
    return Array.from(this.runs.values()).sort((a, b) => b.startedAt - a.startedAt);
  }

  getRun(runId: string): SubagentRun | undefined {
    return this.runs.get(runId);
  }

  async stop(runId: string): Promise<boolean> {
    const queuedIndex = this.queue.findIndex((item) => item.run.id === runId);
    if (queuedIndex >= 0) {
      const [item] = this.queue.splice(queuedIndex, 1);
      item.run.status = "stopped";
      item.run.completedAt = Date.now();
      await writeMetadata(item.run);
      item.resolve(item.run);
      this.updateWidget(item.ctx);
      return true;
    }
    const run = this.runs.get(runId);
    if (!run) return false;
    run.abortController?.abort();
    await this.runner.stop(runId);
    run.status = "stopped";
    run.completedAt = Date.now();
    await writeMetadata(run);
    this.updateWidget();
    return true;
  }

  async shutdown(): Promise<void> {
    for (const run of this.runs.values()) {
      if (run.status === "running" || run.status === "queued") {
        run.abortController?.abort();
        await this.runner.stop(run.id);
        run.status = "aborted";
        run.completedAt = Date.now();
        await writeMetadata(run).catch(() => undefined);
      }
    }
  }

  private async executeForeground(definition: AgentDefinition, task: string, options: RunOptions, run: SubagentRun, ctx?: ExtensionContext): Promise<void> {
    this.updateWidget(ctx);
    try {
      const result = await this.runner.run(definition, task, options, run);
      Object.assign(run, result.run);
      if (run.status !== "stopped" && run.deliveryPolicy !== "pull") {
        await deliverRunResult(this.pi, ctx, this.state, run, definition, run.deliveryPolicy === "review" && run.runMode === "foreground" ? "notify" : run.deliveryPolicy);
        await writeMetadata(run).catch(() => undefined);
      }
    } catch (error) {
      if ((run.status as string) !== "stopped") {
        run.status = (run.status as string) === "aborted" ? "aborted" : "failed";
      }
      run.error = run.status === "stopped" ? undefined : error instanceof Error ? error.message : String(error);
      run.completedAt = Date.now();
      await writeMetadata(run).catch(() => undefined);
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      this.updateWidget(ctx);
    }
  }

  private pump(): void {
    while (this.active < this.maxConcurrency && this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.active++;
      void this.executeQueued(item).finally(() => {
        this.active--;
        this.pump();
      });
    }
  }

  private async executeQueued(item: QueueItem): Promise<void> {
    item.run.status = "running";
    this.updateWidget(item.ctx);
    try {
      const result = await this.runner.run(item.definition, item.task, item.options, item.run);
      Object.assign(item.run, result.run);
      if ((item.run.status as string) !== "stopped") {
        await deliverRunResult(this.pi, item.ctx, this.state, item.run, item.definition, item.run.deliveryPolicy);
      }
      await writeMetadata(item.run).catch(() => undefined);
      item.resolve(item.run);
    } catch (error) {
      if ((item.run.status as string) !== "stopped") {
        item.run.status = (item.run.status as string) === "aborted" ? "aborted" : "failed";
      }
      item.run.error = (item.run.status as string) === "stopped" ? undefined : error instanceof Error ? error.message : String(error);
      item.run.completedAt = Date.now();
      await writeMetadata(item.run).catch(() => undefined);
      if ((item.run.status as string) !== "stopped") {
        item.ctx?.ui?.notify?.(`Subagent ${item.definition.name} failed: ${item.run.error}`, "error");
      }
      item.reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.updateWidget(item.ctx);
    }
  }

  private updateWidget(ctx?: ExtensionContext): void {
    updateSubagentsWidget(ctx, this.listRuns());
  }
}
