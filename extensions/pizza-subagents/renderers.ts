import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import type { AgentToolResult } from "@mariozechner/pi-coding-agent";

export function renderSubagentResult(result: AgentToolResult<any>, options: { expanded: boolean }, theme: any) {
  const details = result.details;
  const text = result.content?.[0]?.type === "text" ? result.content[0].text : "";
  if (!details) return new Text(text, 0, 0);
  const container = new Container();
  const status = details.status ?? details.action ?? "subagent";
  const icon = status === "failed" ? theme.fg("error", "✗") : status === "running" || status === "queued" ? theme.fg("warning", "⏳") : theme.fg("success", "✓");
  container.addChild(new Text(`${icon} ${theme.fg("toolTitle", theme.bold("subagent"))} ${theme.fg("accent", status)}`, 0, 0));
  container.addChild(new Text(theme.fg("dim", text), 0, 0));
  if (options.expanded && details.artifacts) {
    container.addChild(new Spacer(1));
    container.addChild(new Text(theme.fg("muted", "Artifacts"), 0, 0));
    for (const [key, value] of Object.entries(details.artifacts)) {
      container.addChild(new Text(`${theme.fg("muted", `${key}:`)} ${theme.fg("accent", String(value))}`, 0, 0));
    }
  }
  if (options.expanded && typeof details.capsule === "string") {
    container.addChild(new Spacer(1));
    container.addChild(new Markdown(details.capsule, 0, 0, getMarkdownTheme()));
  }
  return container;
}

export function registerMessageRenderer(pi: { registerMessageRenderer: Function }): void {
  pi.registerMessageRenderer("pizza-subagent-result", (message: any, options: any, theme: any) => {
    const container = new Container();
    container.addChild(new Text(theme.fg("customMessageLabel", "🍕 subagent result"), 0, 0));
    container.addChild(new Markdown(String(message.content ?? ""), 0, 0, getMarkdownTheme()));
    if (options.expanded && message.details) {
      container.addChild(new Spacer(1));
      container.addChild(new Text(theme.fg("dim", JSON.stringify(message.details, null, 2)), 0, 0));
    }
    return container;
  });
}
