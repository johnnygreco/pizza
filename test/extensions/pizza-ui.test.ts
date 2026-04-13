import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import pizzaUiExtension, {
  maybeWarnAboutPiCompatibility,
} from "../../extensions/pizza-ui.ts";

const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "..", "..", "package.json"), "utf-8"),
);
const VERSION: string = pkg.version;

function createMockApi() {
  const registeredEvents = new Map<string, Function[]>();
  const registeredCommands = new Map<string, any>();

  const api = {
    on: vi.fn((event: string, handler: Function) => {
      if (!registeredEvents.has(event)) {
        registeredEvents.set(event, []);
      }
      registeredEvents.get(event)!.push(handler);
    }),
    registerCommand: vi.fn((name: string, options: any) => {
      registeredCommands.set(name, options);
    }),
  };

  return { api, registeredEvents, registeredCommands };
}

function createMockContext(
  hasUI = true,
  options: {
    cwd?: string;
    model?: { id: string; name: string };
    percent?: number | null;
    sessionName?: string;
    entries?: any[];
  } = {},
) {
  return {
    hasUI,
    cwd: options.cwd ?? "/tmp/my-project",
    model: options.model ?? { id: "claude-sonnet-4-20250514", name: "sonnet" },
    getContextUsage: vi.fn(() =>
      options.percent !== undefined
        ? { tokens: 1000, contextWindow: 200000, percent: options.percent }
        : undefined,
    ),
    sessionManager: {
      getEntries: vi.fn(() => options.entries ?? []),
      getSessionName: vi.fn(() => options.sessionName),
    },
    ui: {
      setTitle: vi.fn(),
      setStatus: vi.fn(),
      setWidget: vi.fn(),
      setHeader: vi.fn(),
      notify: vi.fn(),
    },
  };
}

/** Call the setHeader factory and render the component at a given width. */
function renderHeader(ctx: ReturnType<typeof createMockContext>, width = 120): string {
  const factory = ctx.ui.setHeader.mock.calls[0][0] as Function;
  const component = factory(null, null);
  const lines: string[] = component.render(width);
  return lines.join("\n");
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("pizza-ui extension", () => {
  it("registers session_start and /pizza", () => {
    const { api, registeredEvents, registeredCommands } = createMockApi();
    pizzaUiExtension(api as any);

    expect(registeredEvents.has("session_start")).toBe(true);
    expect(registeredCommands.has("pizza")).toBe(true);
  });

  it("sets title and header on session_start", async () => {
    const { api, registeredEvents } = createMockApi();
    pizzaUiExtension(api as any);

    const ctx = createMockContext(true, { cwd: "/home/user/my-repo" });
    await registeredEvents.get("session_start")![0]({ reason: "startup" }, ctx);

    expect(ctx.ui.setTitle).toHaveBeenCalledWith("pizza \u00B7 my-repo");
    expect(ctx.ui.setHeader).toHaveBeenCalledWith(expect.any(Function));
  });

  it("banner contains neon PIZZA letters and border", async () => {
    const { api, registeredEvents } = createMockApi();
    pizzaUiExtension(api as any);

    const ctx = createMockContext(true);
    await registeredEvents.get("session_start")![0]({ reason: "startup" }, ctx);

    const output = renderHeader(ctx);
    // box-drawing PIZZA letter patterns
    expect(output).toContain("╔═══╗");
    expect(output).toContain("╠═══╝");
    expect(output).toContain("╚═════╝");
    expect(output).toContain("╠═══╣");
    // rounded border corners
    expect(output).toContain("╭");
    expect(output).toContain("╰");
    // tagline
    expect(output).toContain("Pi ");
    expect(output).toContain("with toppings");
  });

  it("banner contains pizza art with toppings and cheese drips", async () => {
    const { api, registeredEvents } = createMockApi();
    pizzaUiExtension(api as any);

    const ctx = createMockContext(true);
    await registeredEvents.get("session_start")![0]({ reason: "startup" }, ctx);

    const output = renderHeader(ctx);
    expect(output).toContain("●");
    expect(output).toContain("▬");
    expect(output).toContain("░");
    expect(output).toContain("████████████");
    expect(output).toContain("╽");
  });

  it("banner contains keyboard shortcuts and commands", async () => {
    const { api, registeredEvents } = createMockApi();
    pizzaUiExtension(api as any);

    const ctx = createMockContext(true);
    await registeredEvents.get("session_start")![0]({ reason: "startup" }, ctx);

    const output = renderHeader(ctx);
    expect(output).toContain("HOTKEYS");
    expect(output).toContain("Shift+Tab");
    expect(output).toContain("Alt+Enter");
    expect(output).toContain("interrupt");
    expect(output).toContain("suspend");
    expect(output).toContain("cycle thinking");
    expect(output).toContain("cycle models");
    expect(output).toContain("toggle tools");
    expect(output).toContain("QUICK COMMANDS");
    expect(output).toContain("commands");
    expect(output).toContain("bash");
  });

  it("banner contains version info", async () => {
    const { api, registeredEvents } = createMockApi();
    pizzaUiExtension(api as any);

    const ctx = createMockContext(true);
    await registeredEvents.get("session_start")![0]({ reason: "startup" }, ctx);

    const output = renderHeader(ctx);
    expect(output).toContain(`v${VERSION}`);
    expect(output).toContain("pizza");
  });

  it("banner has padding and session meta rows", async () => {
    const { api, registeredEvents } = createMockApi();
    pizzaUiExtension(api as any);

    const ctx = createMockContext(true);
    await registeredEvents.get("session_start")![0]({ reason: "startup" }, ctx);

    const output = renderHeader(ctx, 140);
    const lines = output.split("\n");
    // top border + padding + 11 content + padding + session meta + bottom border = 16
    expect(lines.length).toBe(16);

    // Second line (after top border) should be empty padding (only borders + spaces)
    const paddingLine = stripAnsi(lines[1]);
    const paddingContent = paddingLine.slice(2, -2);
    expect(paddingContent.trim()).toBe("");
  });

  it("shows 'New session' for fresh startup", async () => {
    const { api, registeredEvents } = createMockApi();
    pizzaUiExtension(api as any);

    const ctx = createMockContext(true);
    await registeredEvents.get("session_start")![0]({ reason: "startup" }, ctx);

    const output = renderHeader(ctx);
    expect(output).toContain("New session");
    expect(output).toContain("sonnet");
  });

  it("shows 'Resumed' with session metadata for resumed session", async () => {
    const { api, registeredEvents } = createMockApi();
    pizzaUiExtension(api as any);

    const entries = [
      {
        type: "message",
        id: "1",
        parentId: null,
        timestamp: new Date(Date.now() - 3600000).toISOString(),
        message: { role: "user", content: "Fix the login bug" },
      },
      {
        type: "message",
        id: "2",
        parentId: "1",
        timestamp: new Date(Date.now() - 3500000).toISOString(),
        message: { role: "assistant", content: "I'll fix that." },
      },
    ];
    const ctx = createMockContext(true, {
      entries,
      sessionName: "auth-fix",
    });
    await registeredEvents.get("session_start")![0]({ reason: "resume" }, ctx);

    const output = renderHeader(ctx);
    expect(output).toContain("Resumed");
    expect(output).toContain('"auth-fix"');
    expect(output).toContain("2 msgs");
    expect(output).toContain("sonnet");
  });

  it("shows topic from first user message when no session name", async () => {
    const { api, registeredEvents } = createMockApi();
    pizzaUiExtension(api as any);

    const entries = [
      {
        type: "message",
        id: "1",
        parentId: null,
        timestamp: new Date(Date.now() - 60000).toISOString(),
        message: { role: "user", content: "Refactor the database layer" },
      },
    ];
    const ctx = createMockContext(true, { entries });
    await registeredEvents.get("session_start")![0]({ reason: "startup" }, ctx);

    const output = renderHeader(ctx);
    expect(output).toContain("Resumed");
    expect(output).toContain('"Refactor the database layer"');
  });

  it("header component caches render output", async () => {
    const { api, registeredEvents } = createMockApi();
    pizzaUiExtension(api as any);

    const ctx = createMockContext(true);
    await registeredEvents.get("session_start")![0]({ reason: "startup" }, ctx);

    const factory = ctx.ui.setHeader.mock.calls[0][0] as Function;
    const component = factory(null, null);
    const first = component.render(120);
    const second = component.render(120);
    expect(first).toBe(second);
    const third = component.render(80);
    expect(third).not.toBe(first);
  });

  it("falls back to stacked layout for narrow terminals", async () => {
    const { api, registeredEvents } = createMockApi();
    pizzaUiExtension(api as any);

    const ctx = createMockContext(true);
    await registeredEvents.get("session_start")![0]({ reason: "startup" }, ctx);

    const output = renderHeader(ctx, 70);
    const lines = output.split("\n");
    // stacked: top + padding + 10 left + separator + 11 right + padding + meta + bottom = 27
    expect(lines.length).toBe(27);
    expect(output).toContain("●");
    expect(output).toContain("interrupt");
    expect(output).toContain("New session");
  });

  it("skips UI setup when no UI", async () => {
    const { api, registeredEvents } = createMockApi();
    pizzaUiExtension(api as any);

    const ctx = createMockContext(false);
    await registeredEvents.get("session_start")![0]({ reason: "startup" }, ctx);

    expect(ctx.ui.setTitle).not.toHaveBeenCalled();
    expect(ctx.ui.setHeader).not.toHaveBeenCalled();
  });

  it("warns when Pi is outside Pizza's supported range", () => {
    const ctx = createMockContext(true);

    maybeWarnAboutPiCompatibility(ctx as any, "0.66.5");

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("expects Pi 0.67.x"),
      "warning",
    );
  });

  it("stays quiet when Pi is within Pizza's supported range", () => {
    const ctx = createMockContext(true);

    maybeWarnAboutPiCompatibility(ctx as any, "0.67.0");

    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });

  it("/pizza shows version, model, cwd, and context", async () => {
    const { api, registeredCommands } = createMockApi();
    pizzaUiExtension(api as any);

    const ctx = createMockContext(true, {
      cwd: "/home/user/project",
      model: { id: "claude-sonnet-4-20250514", name: "sonnet" },
      percent: 15,
    });
    await registeredCommands.get("pizza").handler("", ctx);

    const msg = ctx.ui.notify.mock.calls[0][0] as string;
    expect(msg).toContain(VERSION);
    expect(msg).toContain("Pi:");
    expect(msg).toContain("compatible with 0.67.x");
    expect(msg).toContain("sonnet");
    expect(msg).toContain("/home/user/project");
    expect(msg).toContain("15%");
  });

  it("/pizza skips when no UI", async () => {
    const { api, registeredCommands } = createMockApi();
    pizzaUiExtension(api as any);

    const ctx = createMockContext(false);
    await registeredCommands.get("pizza").handler("", ctx);

    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });
});
