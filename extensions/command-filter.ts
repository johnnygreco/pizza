import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const BLOCKED_COMMANDS = new Set(["agents", "chain", "loop", "control-sessions"]);

export default function commandFilterExtension(pi: ExtensionAPI): void {
	const patched = pi as ExtensionAPI & {
		__pizzaCommandFilterInstalled?: boolean;
		registerCommand: ExtensionAPI["registerCommand"];
	};

	if (patched.__pizzaCommandFilterInstalled) return;
	patched.__pizzaCommandFilterInstalled = true;

	const originalRegisterCommand = pi.registerCommand.bind(pi);
	patched.registerCommand = ((name: string, command: unknown) => {
		if (BLOCKED_COMMANDS.has(name)) return;
		return originalRegisterCommand(name as never, command as never);
	}) as ExtensionAPI["registerCommand"];
}
