import { describe, it, expect, vi } from "vitest";
import statusExtension from "../../src/extensions/status.js";
import { VERSION } from "../../src/config.js";

/**
 * Minimal mock of Pi's ExtensionAPI — only the surface this extension touches.
 */
function createMockApi() {
  const registeredEvents = new Map<string, Function[]>();
  const registeredCommands = new Map<string, any>();

  const api = {
    on: vi.fn((event: string, handler: Function) => {
      if (!registeredEvents.has(event)) registeredEvents.set(event, []);
      registeredEvents.get(event)!.push(handler);
    }),
    registerTool: vi.fn(),
    registerCommand: vi.fn((name: string, opts: any) => {
      registeredCommands.set(name, opts);
    }),
    registerShortcut: vi.fn(),
    registerFlag: vi.fn(),
  };

  return { api, registeredEvents, registeredCommands };
}

function createMockContext(hasUI = true) {
  return {
    hasUI,
    cwd: "/tmp/test",
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
      confirm: vi.fn(),
      input: vi.fn(),
      select: vi.fn(),
      setWidget: vi.fn(),
    },
    signal: new AbortController().signal,
  };
}

describe("status extension", () => {
  it("exports a default function", () => {
    expect(typeof statusExtension).toBe("function");
  });

  describe("registration", () => {
    it("subscribes to session_start", () => {
      const { api, registeredEvents } = createMockApi();
      statusExtension(api as any);

      expect(api.on).toHaveBeenCalledWith(
        "session_start",
        expect.any(Function),
      );
      expect(registeredEvents.get("session_start")?.length).toBe(1);
    });

    it("registers the /status command", () => {
      const { api, registeredCommands } = createMockApi();
      statusExtension(api as any);

      expect(api.registerCommand).toHaveBeenCalled();
      expect(registeredCommands.has("status")).toBe(true);
      expect(registeredCommands.get("status").description).toBeDefined();
    });
  });

  describe("session_start handler", () => {
    it("sets status indicator when UI is available", async () => {
      const { api, registeredEvents } = createMockApi();
      statusExtension(api as any);

      const handler = registeredEvents.get("session_start")![0];
      const ctx = createMockContext(true);
      await handler({}, ctx);

      expect(ctx.ui.setStatus).toHaveBeenCalledWith(
        "pizza",
        expect.any(String),
      );
    });

    it("skips status when no UI", async () => {
      const { api, registeredEvents } = createMockApi();
      statusExtension(api as any);

      const handler = registeredEvents.get("session_start")![0];
      const ctx = createMockContext(false);
      await handler({}, ctx);

      expect(ctx.ui.setStatus).not.toHaveBeenCalled();
    });
  });

  describe("/status command handler", () => {
    it("notifies with version info", async () => {
      const { api, registeredCommands } = createMockApi();
      statusExtension(api as any);

      const command = registeredCommands.get("status");
      const ctx = createMockContext(true);
      await command.handler("", ctx);

      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining(VERSION),
        "info",
      );
    });
  });
});
