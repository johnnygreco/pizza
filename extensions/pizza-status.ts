/**
 * Pizza Status Bar Extension
 *
 * Shows context usage progress bar and model in the status line.
 * The progress bar conveys usage visually; the text complements it
 * with the model name rather than repeating the percentage.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const STATUS_KEY = "pizza.status";

function buildProgressBar(theme: ExtensionContext["ui"]["theme"], percent: number): string {
	const width = 20;
	const filled = Math.round((percent / 100) * width);
	const empty = width - filled;
	const bar = "\u2588".repeat(filled) + "\u2591".repeat(empty);

	let color: "success" | "accent" | "warning" | "error" = "success";
	if (percent >= 90) color = "error";
	else if (percent >= 70) color = "warning";
	else if (percent >= 30) color = "accent";

	return theme.fg(color, bar);
}

function updateStatus(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	const usage = ctx.getContextUsage();
	const model = ctx.model?.name ?? ctx.model?.id;
	const percent = usage?.percent ?? 0;
	const bar = buildProgressBar(ctx.ui.theme, percent);
	const modelText = model ? `  ${model}` : "";
	ctx.ui.setStatus(STATUS_KEY, `\u{1F9E0}  ${bar}${modelText}`);
}

export default function pizzaStatusExtension(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		updateStatus(ctx);
	});

	pi.on("turn_start", async (_event, ctx) => {
		updateStatus(ctx);
	});

	pi.on("turn_end", async (_event, ctx) => {
		updateStatus(ctx);
	});

	pi.on("model_select", async (_event, ctx) => {
		updateStatus(ctx);
	});
}
