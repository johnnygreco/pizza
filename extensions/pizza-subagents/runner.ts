import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename } from "node:path";
import type { Message } from "@mariozechner/pi-ai";
import type { AgentDefinition, RunOptions, RunResult, SubagentRun, SubagentRunner, UsageStats } from "./types.ts";
import { appendJsonLine, buildContextMarkdown, createRunRecord, writeMetadata, writeQueued, writeRunFiles } from "./artifacts.ts";
import { buildCapsule } from "./capsule.ts";

function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript && existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }
  const execName = basename(process.execPath).toLowerCase();
  if (!/^(node|bun)(\.exe)?$/.test(execName)) return { command: process.execPath, args };
  return { command: "pi", args };
}

function textFromMessage(message: Message): string {
  if (message.role !== "assistant") return "";
  return message.content.filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n").trim();
}

function addUsage(target: UsageStats, usage: any): void {
  if (!usage) return;
  target.input += Number(usage.input ?? usage.inputTokens ?? 0);
  target.output += Number(usage.output ?? usage.outputTokens ?? 0);
  target.cacheRead += Number(usage.cacheRead ?? 0);
  target.cacheWrite += Number(usage.cacheWrite ?? 0);
  target.cost += Number(usage.cost?.total ?? usage.cost ?? 0);
  target.contextTokens = Number(usage.totalTokens ?? target.contextTokens ?? 0);
}

export class SubprocessSubagentRunner implements SubagentRunner {
  private processes = new Map<string, ChildProcess>();

  async run(definition: AgentDefinition, task: string, options: RunOptions, existingRun?: SubagentRun): Promise<RunResult> {
    const run = existingRun ?? await createRunRecord(definition, task, options);
    run.status = "running";
    const contextMarkdown = buildContextMarkdown(definition, task, options);
    await writeRunFiles(run, definition, contextMarkdown);

    const prompt = this.buildChildPrompt(task, contextMarkdown, options);
    const args = this.buildArgs(definition, run, prompt, options);
    await writeMetadata(run);

    const messages: Message[] = [];
    const transcriptWrites: Promise<void>[] = [];
    let transcriptError: string | undefined;
    let stderr = "";
    let finalOutput = "";
    let wasAborted = false;

    const exitCode = await new Promise<number>((resolve) => {
      const invocation = getPiInvocation(args);
      const proc = spawn(invocation.command, invocation.args, {
        cwd: options.cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.processes.set(run.id, proc);

      let buffer = "";
      let sawAgentEnd = false;
      const usage: UsageStats = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };

      const processLine = (line: string) => {
        if (!line.trim()) return;
        let event: any;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }
        const transcriptWrite = appendJsonLine(run.transcriptPath, event).catch((error) => {
          transcriptError = error instanceof Error ? error.message : String(error);
        });
        transcriptWrites.push(transcriptWrite);
        let changed = false;
        if (event.type === "agent_end") {
          sawAgentEnd = true;
          changed = true;
          setTimeout(() => {
            if (!proc.killed) proc.kill("SIGTERM");
          }, 250).unref?.();
        }
        if (event.type === "tool_execution_start" || event.type === "toolcall_start" || event.type === "tool_call") {
          run.toolUses++;
          changed = true;
        }
        if (event.type === "message_end" && event.message) {
          const msg = event.message as Message;
          messages.push(msg);
          if (msg.role === "assistant") {
            run.turns++;
            changed = true;
            run.model = `${(msg as any).provider ?? ""}/${(msg as any).model ?? ""}`.replace(/^\//, "") || run.model;
            addUsage(usage, (msg as any).usage);
            const text = textFromMessage(msg);
            if (text) finalOutput = text;
          }
        }
        if (event.type === "tool_result_end" && event.message) {
          messages.push(event.message as Message);
          changed = true;
        }
        run.usage = usage;
        if (changed) options.onProgress?.(run);
      };

      proc.stdout.on("data", (data) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) processLine(line);
      });
      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });
      proc.on("close", (code) => {
        if (buffer.trim()) processLine(buffer);
        this.processes.delete(run.id);
        resolve(sawAgentEnd ? 0 : code ?? 0);
      });
      proc.on("error", () => {
        this.processes.delete(run.id);
        resolve(1);
      });

      const signal = options.signal ?? run.abortController?.signal;
      if (signal) {
        const kill = () => {
          wasAborted = true;
          proc.kill("SIGTERM");
          setTimeout(() => {
            if (!proc.killed) proc.kill("SIGKILL");
          }, 5000).unref?.();
        };
        if (signal.aborted) kill();
        else signal.addEventListener("abort", kill, { once: true });
      }
    });

    await Promise.all(transcriptWrites);

    if (wasAborted && (run.status as string) === "stopped") {
      run.error = undefined;
    } else if (wasAborted) {
      run.status = "aborted";
      run.error = "Subagent run aborted.";
    } else if (exitCode !== 0) {
      run.status = "failed";
      run.error = stderr.trim() || `Subagent exited with code ${exitCode}.`;
    } else {
      run.status = "completed";
    }

    if (!finalOutput && messages.length > 0) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const text = textFromMessage(messages[i]);
        if (text) { finalOutput = text; break; }
      }
    }
    if (!finalOutput && stderr.trim()) finalOutput = stderr.trim();

    if (transcriptError) {
      run.error = run.error ? `${run.error}\nTranscript write error: ${transcriptError}` : `Transcript write error: ${transcriptError}`;
    }

    run.completedAt = Date.now();
    run.finalOutput = finalOutput;
    const capsule = buildCapsule(run, definition, finalOutput);
    run.capsule = capsule;
    await mkdir(run.artifactDir, { recursive: true });
    await Promise.all([
      writeQueued(run.resultPath, finalOutput.trim() + "\n"),
      writeQueued(run.capsulePath, capsule),
      writeMetadata(run),
    ]);

    if (run.status === "failed" || run.status === "aborted") {
      throw new Error(run.error ?? "Subagent failed");
    }
    return { run, finalOutput, capsule };
  }

  async stop(runId: string): Promise<void> {
    const proc = this.processes.get(runId);
    if (!proc) return;
    proc.kill("SIGTERM");
    setTimeout(() => {
      if (!proc.killed) proc.kill("SIGKILL");
    }, 5000).unref?.();
  }

  private buildArgs(definition: AgentDefinition, run: SubagentRun, prompt: string, options: RunOptions): string[] {
    const args = ["--mode", "json", "-p", "--no-session", "--no-extensions", "--append-system-prompt", run.promptPath];
    if (options.contextPolicy === "fresh") args.push("--no-skills", "--no-prompt-templates");
    if (definition.model) args.push("--model", definition.model);
    if (definition.thinking) args.push("--thinking", definition.thinking);
    if (definition.tools !== undefined) {
      if (definition.tools.length === 0) args.push("--no-tools");
      else args.push("--tools", definition.tools.join(","));
    }
    args.push(prompt);
    return args;
  }

  private buildChildPrompt(task: string, contextMarkdown: string, options: RunOptions): string {
    const taskBlock = task.trim() ? [`Task: ${task.trim()}`, ""] : [];
    if (options.contextPolicy === "handoff") {
      return [...taskBlock, "Parent handoff/context:", options.parentContext ?? contextMarkdown].join("\n");
    }
    return [...taskBlock, "Context manifest:", contextMarkdown].join("\n");
  }
}
