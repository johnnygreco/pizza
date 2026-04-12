import { describe, expect, it, vi } from "vitest";
import pizzaUiExtension from "../../src/extensions/pizza-ui.js";
import { VERSION } from "../../src/config.js";

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

function createMockContext(hasUI = true) {
  return {
    hasUI,
    ui: {
      setTitle: vi.fn(),
      setStatus: vi.fn(),
      setWidget: vi.fn(),
      notify: vi.fn(),
    },
  };
}

describe("pizza-ui extension", () => {
  it("registers session_start, /pizza, and /status", () => {
    const { api, registeredEvents, registeredCommands } = createMockApi();
    pizzaUiExtension(api as any);

    expect(registeredEvents.has("session_start")).toBe(true);
    expect(registeredCommands.has("pizza")).toBe(true);
    expect(registeredCommands.has("status")).toBe(true);
  });

  it("sets up UI on session_start when hasUI", async () => {
    const { api, registeredEvents } = createMockApi();
    pizzaUiExtension(api as any);

    const ctx = createMockContext(true);
    const handler = registeredEvents.get("session_start")![0];
    await handler({}, ctx);

    expect(ctx.ui.setTitle).toHaveBeenCalledWith("pizza");
    expect(ctx.ui.setStatus).toHaveBeenCalledWith(
      "pizza",
      expect.stringContaining(VERSION),
    );
    expect(ctx.ui.setWidget).toHaveBeenCalled();
  });

  it("skips UI setup when no UI", async () => {
    const { api, registeredEvents } = createMockApi();
    pizzaUiExtension(api as any);

    const ctx = createMockContext(false);
    const handler = registeredEvents.get("session_start")![0];
    await handler({}, ctx);

    expect(ctx.ui.setTitle).not.toHaveBeenCalled();
    expect(ctx.ui.setStatus).not.toHaveBeenCalled();
    expect(ctx.ui.setWidget).not.toHaveBeenCalled();
  });

  it("/pizza command notifies with version when hasUI", async () => {
    const { api, registeredCommands } = createMockApi();
    pizzaUiExtension(api as any);

    const ctx = createMockContext(true);
    await registeredCommands.get("pizza").handler("", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining(VERSION),
      "info",
    );
  });

  it("/pizza command skips notify when no UI", async () => {
    const { api, registeredCommands } = createMockApi();
    pizzaUiExtension(api as any);

    const ctx = createMockContext(false);
    await registeredCommands.get("pizza").handler("", ctx);

    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });

  it("/status command notifies with version when hasUI", async () => {
    const { api, registeredCommands } = createMockApi();
    pizzaUiExtension(api as any);

    const ctx = createMockContext(true);
    await registeredCommands.get("status").handler("", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining(VERSION),
      "info",
    );
  });

  it("/status command skips notify when no UI", async () => {
    const { api, registeredCommands } = createMockApi();
    pizzaUiExtension(api as any);

    const ctx = createMockContext(false);
    await registeredCommands.get("status").handler("", ctx);

    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });
});
