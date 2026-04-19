import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import pizzaUiExtension, {
  maybeWarnAboutPiCompatibility,
} from "../../extensions/pizza-ui.ts";

const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "..", "..", "package.json"), "utf-8"),
);
const VERSION: string = pkg.version;

function createMockApi(
  options: {
    commands?: Array<{ name: string; source: "skill" | "prompt" | "extension" }>;
  } = {},
) {
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
    getCommands: vi.fn(() => options.commands ?? []),
  };

  return { api, registeredEvents, registeredCommands };
}

function createMockContext(
  hasUI = true,
  options: {
    cwd?: string;
    model?: { id: string; name: string; provider?: string };
    percent?: number | null;
    sessionName?: string;
    entries?: any[];
  } = {},
) {
  return {
    hasUI,
    cwd: options.cwd ?? "/tmp/my-project",
    model: options.model ?? { id: "claude-sonnet-4-20250514", name: "sonnet", provider: "anthropic" },
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
    expect(registeredEvents.has("turn_end")).toBe(true);
    expect(registeredEvents.has("model_select")).toBe(true);
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
    expect(output).toContain("with extra toppings");
  });

  it("banner contains pizza art with extra toppings and cheese drips", async () => {
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
    expect(output).toContain("SHORTCUTS");
    expect(output).toContain("Shift+Tab");
    expect(output).toContain("Alt+Enter");
    expect(output).toContain("interrupt");
    expect(output).toContain("suspend");
    expect(output).toContain("cycle thinking");
    expect(output).toContain("cycle models");
    expect(output).toContain("toggle tools");
    expect(output).toContain("PREFIXES");
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
    // top border + padding + 11 content + padding + resources (1) + padding +
    // session meta + bottom border = 18
    expect(lines.length).toBe(18);

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
    expect(output).toContain("Anthropic: sonnet");
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
    expect(output).toContain("Anthropic: sonnet");
  });

  it("shows provider-aware labels in the banner and /pizza output", async () => {
    const { api, registeredEvents, registeredCommands } = createMockApi();
    pizzaUiExtension(api as any);

    const ctx = createMockContext(true, {
      model: {
        id: "anthropic/claude-opus-4.1",
        name: "Anthropic: Claude Opus 4.1",
        provider: "openrouter",
      },
    });
    await registeredEvents.get("session_start")![0]({ reason: "startup" }, ctx);

    const output = renderHeader(ctx);
    expect(output).toContain("OpenRouter: Claude Opus 4.1");
    expect(output).not.toContain("OpenRouter: Anthropic: Claude Opus 4.1");

    await registeredCommands.get("pizza").handler("", ctx);
    const msg = ctx.ui.notify.mock.calls.at(-1)![0] as string;
    expect(msg).toContain("Model: OpenRouter: Claude Opus 4.1");
  });

  it("updates the banner when the model changes", async () => {
    const { api, registeredEvents } = createMockApi();
    pizzaUiExtension(api as any);

    const ctx = createMockContext(true, {
      model: { id: "claude-sonnet-4-20250514", name: "sonnet", provider: "anthropic" },
    });
    await registeredEvents.get("session_start")![0]({ reason: "startup" }, ctx);
    expect(renderHeader(ctx)).toContain("Anthropic: sonnet");

    ctx.model = {
      id: "anthropic/claude-opus-4.6",
      name: "Anthropic: Claude Opus 4.6",
      provider: "openrouter",
    };
    await registeredEvents.get("model_select")![0]({}, ctx);

    const output = renderHeader(ctx);
    expect(output).toContain("OpenRouter: Claude Opus 4.6");
    expect(output).not.toContain("Anthropic: sonnet");
  });

  it("reuses the same header component across updates", async () => {
    const { api, registeredEvents } = createMockApi();
    pizzaUiExtension(api as any);

    const ctx = createMockContext(true, {
      model: { id: "claude-sonnet-4-20250514", name: "sonnet", provider: "anthropic" },
      entries: [
        {
          type: "message",
          id: "1",
          parentId: null,
          timestamp: new Date().toISOString(),
          message: { role: "user", content: "Inspect the banner updates" },
        },
      ],
    });

    await registeredEvents.get("session_start")![0]({ reason: "startup" }, ctx);
    const factory = ctx.ui.setHeader.mock.calls[0][0] as Function;
    const tui = { requestRender: vi.fn() };
    const header = factory(tui, null);

    ctx.model = {
      id: "anthropic/claude-opus-4.6",
      name: "Anthropic: Claude Opus 4.6",
      provider: "openrouter",
    };
    await registeredEvents.get("model_select")![0]({}, ctx);
    await registeredEvents.get("turn_end")![0]({}, ctx);

    expect(ctx.ui.setHeader).toHaveBeenCalledTimes(1);
    expect(tui.requestRender).toHaveBeenCalledTimes(2);
    expect(header.render(120).join("\n")).toContain("OpenRouter: Claude Opus 4.6");
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
    // stacked: top + padding + 10 left + separator + 11 right + padding +
    // resources (1) + padding + meta + bottom = 29
    expect(lines.length).toBe(29);
    expect(output).toContain("●");
    expect(output).toContain("interrupt");
    expect(output).toContain("New session");
  });

  it("no rendered line exceeds the requested width, even with a long session meta", async () => {
    const { api, registeredEvents } = createMockApi();
    pizzaUiExtension(api as any);

    // A long first-user message + long model label would previously overflow
    // the stacked banner's inner width at narrow terminal sizes.
    const entries = [
      {
        type: "message",
        id: "1",
        parentId: null,
        timestamp: new Date(Date.now() - 3600000).toISOString(),
        message: {
          role: "user",
          content:
            "I want to change the tagline of Pizza from something to something else that is quite long",
        },
      },
    ];
    const ctx = createMockContext(true, {
      entries,
      model: {
        id: "anthropic/claude-opus-4.6",
        name: "Anthropic: Claude Opus 4.6",
        provider: "openrouter",
      },
    });
    await registeredEvents.get("session_start")![0]({ reason: "resume" }, ctx);

    for (const width of [70, 93, 120, 160]) {
      const lines = renderHeader(ctx, width).split("\n");
      for (const line of lines) {
        // Visible width of every rendered line must fit the terminal width.
        const vis = stripAnsi(line).length;
        expect(vis).toBeLessThanOrEqual(width);
      }
    }
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
      model: { id: "claude-sonnet-4-20250514", name: "sonnet", provider: "anthropic" },
      percent: 15,
    });
    await registeredCommands.get("pizza").handler("", ctx);

    const msg = ctx.ui.notify.mock.calls[0][0] as string;
    expect(msg).toContain(VERSION);
    expect(msg).toContain("Pi:");
    expect(msg).toContain("compatible with 0.67.x");
    expect(msg).toContain("Anthropic: sonnet");
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

const RESOURCE_COMMANDS: Array<{ name: string; source: "skill" | "prompt" | "extension" }> = [
  { name: "skill:alpha", source: "skill" },
  { name: "skill:beta", source: "skill" },
  { name: "hello", source: "prompt" },
  { name: "todo", source: "extension" },
  { name: "pizza", source: "extension" },
];

function withThemesSurface(ctx: ReturnType<typeof createMockContext>) {
  (ctx.ui as any).getAllThemes = vi.fn(() => [
    { name: "pizzeria", path: "/themes/pizzeria.json" },
    { name: "dracula", path: "/themes/dracula.json" },
  ]);
  return ctx;
}

describe("/pizza resources subcommand", () => {
  afterEach(async () => {
    // Reset module-level expansion flag to collapsed.
    const { api, registeredCommands } = createMockApi({ commands: [] });
    pizzaUiExtension(api as any);
    const ctx = withThemesSurface(createMockContext(true));
    await registeredCommands.get("pizza").handler("resources collapse", ctx);
  });

  it("renders a collapsed resources row with category counts by default", async () => {
    const { api, registeredEvents } = createMockApi({ commands: RESOURCE_COMMANDS });
    pizzaUiExtension(api as any);

    const ctx = withThemesSurface(createMockContext(true));
    await registeredEvents.get("session_start")![0]({ reason: "startup" }, ctx);

    const output = stripAnsi(renderHeader(ctx, 140));
    expect(output).toContain("▸ resources");
    expect(output).toContain("skills 2");
    expect(output).toContain("prompts 1");
    expect(output).toContain("ext 2");
    expect(output).toContain("themes 2");
    expect(output).toContain("(/pizza resources)");
    // Collapsed form: resource names should not be listed.
    expect(output).not.toContain("alpha");
  });

  it("/pizza resources toggles to expanded and lists names per category", async () => {
    const { api, registeredEvents, registeredCommands } = createMockApi({
      commands: RESOURCE_COMMANDS,
    });
    pizzaUiExtension(api as any);

    const ctx = withThemesSurface(createMockContext(true));
    await registeredEvents.get("session_start")![0]({ reason: "startup" }, ctx);
    await registeredCommands.get("pizza").handler("resources", ctx);

    const output = stripAnsi(renderHeader(ctx, 140));
    expect(output).toContain("▾ resources");
    expect(output).toContain("skills:");
    expect(output).toContain("alpha");
    expect(output).toContain("beta");
    expect(output).not.toContain("skill:alpha");
    expect(output).toContain("hello");
    expect(output).toContain("todo");
    expect(output).toContain("pizzeria");

    const last = ctx.ui.notify.mock.calls.at(-1)!;
    expect(last[0]).toBe("Resources expanded");
  });

  it("/pizza resources collapse returns to the compact form", async () => {
    const { api, registeredEvents, registeredCommands } = createMockApi({
      commands: RESOURCE_COMMANDS,
    });
    pizzaUiExtension(api as any);

    const ctx = withThemesSurface(createMockContext(true));
    await registeredEvents.get("session_start")![0]({ reason: "startup" }, ctx);
    await registeredCommands.get("pizza").handler("resources expand", ctx);
    await registeredCommands.get("pizza").handler("resources collapse", ctx);

    const output = stripAnsi(renderHeader(ctx, 140));
    expect(output).toContain("▸ resources");
    expect(output).not.toContain("alpha");
  });

  it("wraps expanded resource lists that overflow the banner width", async () => {
    const manyPrompts = Array.from({ length: 20 }, (_, i) => `prompt-name-${i}`);
    const manyThemes = Array.from({ length: 15 }, (_, i) => `theme-name-${i}`);
    const commands = manyPrompts.map(
      (name): { name: string; source: "prompt" } => ({ name, source: "prompt" }),
    );

    const { api, registeredEvents, registeredCommands } = createMockApi({
      commands,
    });
    pizzaUiExtension(api as any);

    const ctx = createMockContext(true);
    (ctx.ui as any).getAllThemes = vi.fn(() =>
      manyThemes.map((name) => ({ name, path: `/themes/${name}.json` })),
    );
    await registeredEvents.get("session_start")![0]({ reason: "startup" }, ctx);
    await registeredCommands.get("pizza").handler("resources expand", ctx);

    const width = 100;
    const output = renderHeader(ctx, width);
    const stripped = stripAnsi(output);

    for (const name of manyPrompts) expect(stripped).toContain(name);
    for (const name of manyThemes) expect(stripped).toContain(name);

    for (const line of output.split("\n")) {
      expect(stripAnsi(line).length).toBeLessThanOrEqual(width);
    }
  });
});
