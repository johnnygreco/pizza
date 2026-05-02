import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pizzaThemeExtension from "../../extensions/pizza-theme.ts";
import {
  DEFAULT_PIZZA_THEME,
  getActivePizzaThemeName,
  setActivePizzaTheme,
} from "../../extensions/shared/pizza-palette.ts";

function createMockApi() {
  const registeredEvents = new Map<string, Function[]>();
  const registeredCommands = new Map<string, any>();
  const registeredShortcuts = new Map<string, any>();

  const api = {
    on: vi.fn((event: string, handler: Function) => {
      if (!registeredEvents.has(event)) registeredEvents.set(event, []);
      registeredEvents.get(event)!.push(handler);
    }),
    registerCommand: vi.fn((name: string, options: any) => {
      registeredCommands.set(name, options);
    }),
    registerShortcut: vi.fn((key: string, options: any) => {
      registeredShortcuts.set(key, options);
    }),
  };

  return { api, registeredEvents, registeredCommands, registeredShortcuts };
}

function createMockContext(
  options: {
    hasUI?: boolean;
    themes?: Array<{ name: string; path?: string }>;
    active?: string;
  } = {},
) {
  const themes = options.themes ?? [
    { name: "pizzeria", path: "/themes/retro.json" },
    { name: "dracula", path: "/themes/cyber.json" },
  ];
  const state = { active: options.active ?? themes[0]?.name ?? "" };

  return {
    hasUI: options.hasUI ?? true,
    ui: {
      get theme() {
        return { name: state.active };
      },
      getAllThemes: vi.fn(() => themes),
      setTheme: vi.fn((name: string) => {
        if (!themes.find((t) => t.name === name)) {
          return { success: false, error: `unknown: ${name}` };
        }
        state.active = name;
        return { success: true };
      }),
      setStatus: vi.fn(),
      setWidget: vi.fn(),
      notify: vi.fn(),
      select: vi.fn(
        async (_title: string, _items: string[]): Promise<string | undefined> => undefined,
      ),
    },
  };
}

describe("pizza-theme cycler — registration", () => {
  it("registers ctrl+q, /theme, and session_start", () => {
    const { api, registeredEvents, registeredCommands, registeredShortcuts } = createMockApi();
    pizzaThemeExtension(api as any);

    expect(registeredShortcuts.has("ctrl+q")).toBe(true);
    expect(registeredCommands.has("theme")).toBe(true);
    expect(registeredEvents.has("session_start")).toBe(true);
  });
});

describe("pizza-theme cycler — shortcuts", () => {
  beforeEach(() => {
    setActivePizzaTheme(DEFAULT_PIZZA_THEME);
  });

  afterEach(() => {
    setActivePizzaTheme(DEFAULT_PIZZA_THEME);
    vi.useRealTimers();
  });

  it("ctrl+q cycles forward and updates Pi, status, and swatch", async () => {
    const { api, registeredShortcuts } = createMockApi();
    pizzaThemeExtension(api as any);

    const ctx = createMockContext({ active: "pizzeria" });
    await registeredShortcuts.get("ctrl+q").handler(ctx);

    expect(ctx.ui.setTheme).toHaveBeenCalledWith("dracula");
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("pizza.theme", expect.stringContaining("dracula"));
    expect(ctx.ui.setWidget).toHaveBeenCalledWith(
      "pizza.theme.swatch",
      expect.any(Function),
      expect.objectContaining({ placement: "belowEditor" }),
    );
    expect(ctx.ui.notify).toHaveBeenCalledWith("dracula (2/2)", "info");
  });

  it("syncs the pizza palette to the newly-activated theme", async () => {
    const { api, registeredShortcuts } = createMockApi();
    pizzaThemeExtension(api as any);

    const ctx = createMockContext({ active: "pizzeria" });
    expect(getActivePizzaThemeName()).toBe("pizzeria");

    await registeredShortcuts.get("ctrl+q").handler(ctx);
    expect(getActivePizzaThemeName()).toBe("dracula");
  });

  it("does nothing when no themes are available", async () => {
    const { api, registeredShortcuts } = createMockApi();
    pizzaThemeExtension(api as any);

    const ctx = createMockContext({ themes: [] });
    await registeredShortcuts.get("ctrl+q").handler(ctx);

    expect(ctx.ui.setTheme).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith("No themes available", "warning");
  });

  it("skips UI calls when ctx has no UI", async () => {
    const { api, registeredShortcuts } = createMockApi();
    pizzaThemeExtension(api as any);

    const ctx = createMockContext({ hasUI: false });
    await registeredShortcuts.get("ctrl+q").handler(ctx);

    expect(ctx.ui.setTheme).not.toHaveBeenCalled();
    expect(ctx.ui.setStatus).not.toHaveBeenCalled();
    expect(ctx.ui.setWidget).not.toHaveBeenCalled();
  });

  it("clears the swatch after 3s", async () => {
    vi.useFakeTimers();
    const { api, registeredShortcuts } = createMockApi();
    pizzaThemeExtension(api as any);

    const ctx = createMockContext({ active: "pizzeria" });
    await registeredShortcuts.get("ctrl+q").handler(ctx);

    expect(ctx.ui.setWidget).toHaveBeenCalledWith(
      "pizza.theme.swatch",
      expect.any(Function),
      expect.anything(),
    );

    vi.advanceTimersByTime(3000);

    expect(ctx.ui.setWidget).toHaveBeenLastCalledWith("pizza.theme.swatch", undefined);
  });

  it("cancels a pending swatch timer when the theme is cycled again", async () => {
    vi.useFakeTimers();
    const { api, registeredShortcuts } = createMockApi();
    pizzaThemeExtension(api as any);

    const ctx = createMockContext({ active: "pizzeria" });
    await registeredShortcuts.get("ctrl+q").handler(ctx);

    vi.advanceTimersByTime(1000);
    await registeredShortcuts.get("ctrl+q").handler(ctx);

    // After 2500ms more (total 3500ms, 2500ms since the second cycle) the
    // first timer would have fired at 3000ms — but it should have been cleared.
    vi.advanceTimersByTime(2500);

    // Only the second cycle's clear should have happened; no extra clears
    // between the two cycle calls from an expired first timer.
    const clearCalls = ctx.ui.setWidget.mock.calls.filter(
      ([, content]) => content === undefined,
    );
    expect(clearCalls.length).toBe(0);

    vi.advanceTimersByTime(500); // reach 3000ms since second cycle
    const finalClearCalls = ctx.ui.setWidget.mock.calls.filter(
      ([, content]) => content === undefined,
    );
    expect(finalClearCalls.length).toBe(1);
  });
});

describe("pizza-theme cycler — /theme command", () => {
  beforeEach(() => {
    setActivePizzaTheme(DEFAULT_PIZZA_THEME);
  });

  afterEach(() => {
    setActivePizzaTheme(DEFAULT_PIZZA_THEME);
  });

  it("/theme <name> switches directly", async () => {
    const { api, registeredCommands } = createMockApi();
    pizzaThemeExtension(api as any);

    const ctx = createMockContext({ active: "pizzeria" });
    await registeredCommands.get("theme").handler("dracula", ctx);

    expect(ctx.ui.setTheme).toHaveBeenCalledWith("dracula");
    expect(ctx.ui.notify).toHaveBeenCalledWith("Theme: dracula", "info");
  });

  it("/theme next cycles forward", async () => {
    const { api, registeredCommands } = createMockApi();
    pizzaThemeExtension(api as any);

    const ctx = createMockContext({ active: "pizzeria" });
    await registeredCommands.get("theme").handler("next", ctx);

    expect(ctx.ui.setTheme).toHaveBeenCalledWith("dracula");
    expect(ctx.ui.notify).toHaveBeenCalledWith("dracula (2/2)", "info");
  });

  it("/theme prev cycles backward wrapping around", async () => {
    const { api, registeredCommands } = createMockApi();
    pizzaThemeExtension(api as any);

    const ctx = createMockContext({ active: "pizzeria" });
    await registeredCommands.get("theme").handler("prev", ctx);

    expect(ctx.ui.setTheme).toHaveBeenCalledWith("dracula");
    expect(ctx.ui.notify).toHaveBeenCalledWith("dracula (2/2)", "info");
  });

  it("/theme with no args opens the picker", async () => {
    const { api, registeredCommands } = createMockApi();
    pizzaThemeExtension(api as any);

    const ctx = createMockContext({ active: "pizzeria" });
    ctx.ui.select = vi.fn(async () => "dracula");

    await registeredCommands.get("theme").handler("", ctx);

    expect(ctx.ui.select).toHaveBeenCalledTimes(1);
    const [title, items] = ctx.ui.select.mock.calls[0];
    expect(title).toContain("current: pizzeria");
    expect(items[0]).toMatch(/pizzeria \(active\)/);
    expect(ctx.ui.setTheme).toHaveBeenCalledWith("dracula");
  });

  it("/theme leaves state alone when the picker is cancelled", async () => {
    const { api, registeredCommands } = createMockApi();
    pizzaThemeExtension(api as any);

    const ctx = createMockContext({ active: "pizzeria" });
    ctx.ui.select = vi.fn(async () => undefined);

    await registeredCommands.get("theme").handler("", ctx);

    expect(ctx.ui.setTheme).not.toHaveBeenCalled();
    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });

  it("/theme warns on unknown names without touching Pi", async () => {
    const { api, registeredCommands } = createMockApi();
    pizzaThemeExtension(api as any);

    const ctx = createMockContext({ active: "pizzeria" });
    await registeredCommands.get("theme").handler("nope", ctx);

    expect(ctx.ui.setTheme).not.toHaveBeenCalled();
    const call = ctx.ui.notify.mock.calls.at(-1)!;
    expect(call[0]).toContain("Unknown theme: nope");
    expect(call[0]).toContain("/theme next");
    expect(call[1]).toBe("warning");
  });

  it("/theme surfaces pi's setTheme errors", async () => {
    const { api, registeredCommands } = createMockApi();
    pizzaThemeExtension(api as any);

    const ctx = createMockContext({ active: "pizzeria" });
    ctx.ui.setTheme = vi.fn(() => ({ success: false, error: "boom" }));

    await registeredCommands.get("theme").handler("dracula", ctx);

    const call = ctx.ui.notify.mock.calls.at(-1)!;
    expect(call[0]).toContain("boom");
    expect(call[1]).toBe("error");
  });

  it("/theme is a no-op when there is no UI", async () => {
    const { api, registeredCommands } = createMockApi();
    pizzaThemeExtension(api as any);

    const ctx = createMockContext({ hasUI: false });
    await registeredCommands.get("theme").handler("dracula", ctx);

    expect(ctx.ui.setTheme).not.toHaveBeenCalled();
    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });
});

describe("pizza-theme cycler — session lifecycle", () => {
  it("session_start primes the status line and palette", async () => {
    const { api, registeredEvents } = createMockApi();
    pizzaThemeExtension(api as any);

    const ctx = createMockContext({ active: "dracula" });
    await registeredEvents.get("session_start")![0]({}, ctx);

    expect(ctx.ui.setStatus).toHaveBeenCalledWith(
      "pizza.theme",
      expect.stringContaining("dracula"),
    );
    expect(getActivePizzaThemeName()).toBe("dracula");
  });

  it("session_start skips UI setup when hasUI is false", async () => {
    const { api, registeredEvents } = createMockApi();
    pizzaThemeExtension(api as any);

    const ctx = createMockContext({ hasUI: false });
    await registeredEvents.get("session_start")![0]({}, ctx);

    expect(ctx.ui.setStatus).not.toHaveBeenCalled();
  });
});
