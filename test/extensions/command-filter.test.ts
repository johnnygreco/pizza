import { describe, expect, it, vi } from "vitest";
import commandFilterExtension from "../../extensions/command-filter.ts";

describe("command-filter extension", () => {
	it("blocks removed commands and keeps allowed commands", () => {
		const registered = new Map<string, unknown>();
		const api = {
			registerCommand: vi.fn((name: string, command: unknown) => {
				registered.set(name, command);
			}),
		};

		commandFilterExtension(api as any);

		api.registerCommand("agents", {});
		api.registerCommand("chain", {});
		api.registerCommand("loop", {});
		api.registerCommand("control-sessions", {});
		api.registerCommand("run", {});
		api.registerCommand("parallel", {});
		api.registerCommand("todos", {});

		expect(registered.has("agents")).toBe(false);
		expect(registered.has("chain")).toBe(false);
		expect(registered.has("loop")).toBe(false);
		expect(registered.has("control-sessions")).toBe(false);
		expect(registered.has("run")).toBe(true);
		expect(registered.has("parallel")).toBe(true);
		expect(registered.has("todos")).toBe(true);
	});
});
