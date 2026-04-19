/**
 * Pizza Status Bar Extension
 *
 * Replaces Pi's default footer stats line and adds a retro pizza status bar.
 */

import type { ExtensionAPI, ExtensionContext, ReadonlyFooterDataProvider } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { formatModelLabel } from "./shared/model-label.ts";
import { ANSI_BOLD, ANSI_RESET, getPizzaTheme, onPizzaThemeChange } from "./shared/pizza-palette.ts";

const STATUS_KEY = "pizza.hud.10.status";
const METER_WIDTH = 20;
const AUTO_CONTEXT_SUFFIX = " (auto)";

type FooterTheme = {
	fg(color: string, text: string): string;
};

function clampPercent(percent: number): number {
	return Math.max(0, Math.min(100, Math.round(percent)));
}

function numberOrZero(value: unknown): number {
	const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
	return Number.isFinite(n) ? n : 0;
}

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function formatUsd(cost: number): string {
	if (!Number.isFinite(cost) || cost <= 0) return "$0.00";
	if (cost >= 1) return `$${cost.toFixed(2)}`;
	if (cost >= 0.1) return `$${cost.toFixed(3)}`;
	return `$${cost.toFixed(4)}`;
}

function trimTrailingZeros(text: string): string {
	return text.replace(/(\.\d*?[1-9])0+$/u, "$1").replace(/\.0+$/u, "");
}

function formatUsdRate(cost: number): string {
	if (!Number.isFinite(cost) || cost <= 0) return "$0";
	return `$${trimTrailingZeros(cost.toFixed(4))}`;
}

function extractCostTotal(usage: any): number {
	if (!usage) return 0;
	const direct = numberOrZero(usage.cost);
	if (direct > 0) return direct;
	return numberOrZero(usage?.cost?.total);
}

function getModelRateText(ctx: ExtensionContext): string | undefined {
	const modelCost = (ctx.model as any)?.cost;
	if (!modelCost) return undefined;

	const input = numberOrZero(modelCost.input);
	const output = numberOrZero(modelCost.output);
	const parts: string[] = [];

	if (input > 0) parts.push(`↑${formatUsdRate(input)}/1M`);
	if (output > 0) parts.push(`↓${formatUsdRate(output)}/1M`);

	return parts.length > 0 ? parts.join(" ") : undefined;
}

function sanitizeStatusText(text: string): string {
	return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

function getContextDisplay(ctx: ExtensionContext): { display: string; percent: number } {
	const usage = ctx.getContextUsage();
	const rawPercent = usage?.percent;
	const percent = rawPercent == null ? 0 : clampPercent(rawPercent);
	const percentLabel = rawPercent == null ? "?" : Number(rawPercent).toFixed(1);
	const contextWindow = numberOrZero(usage?.contextWindow ?? (ctx.model as any)?.contextWindow);
	const windowLabel = contextWindow > 0 ? formatTokens(contextWindow) : "?";
	return {
		display: `${percentLabel}%/${windowLabel}${AUTO_CONTEXT_SUFFIX}`,
		percent,
	};
}

function getSessionUsage(ctx: ExtensionContext): {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalCost: number;
} {
	let input = 0;
	let output = 0;
	let cacheRead = 0;
	let cacheWrite = 0;
	let totalCost = 0;

	for (const entry of ctx.sessionManager.getEntries()) {
		if ((entry as any)?.type !== "message") continue;
		const message = (entry as any)?.message;
		if (message?.role !== "assistant") continue;
		const usage = message?.usage;
		if (!usage) continue;
		input += numberOrZero(usage.input ?? usage.inputTokens);
		output += numberOrZero(usage.output ?? usage.outputTokens);
		cacheRead += numberOrZero(usage.cacheRead);
		cacheWrite += numberOrZero(usage.cacheWrite);
		totalCost += extractCostTotal(usage);
	}

	return { input, output, cacheRead, cacheWrite, totalCost };
}

function colorForPercent(percent: number): string {
	const theme = getPizzaTheme();
	if (percent >= 90) return theme.meterHigh;
	if (percent >= 70) return theme.meterMid;
	return theme.meterLow;
}

function buildProgressBar(percent: number): string {
	const filled = Math.floor((percent / 100) * METER_WIDTH);
	const color = colorForPercent(percent);
	let bar = "";
	for (let i = 0; i < METER_WIDTH; i++) {
		bar += i < filled ? `${color}\u2588${ANSI_RESET}` : `${color}\u2591${ANSI_RESET}`;
	}
	return bar;
}

function buildStatusLine(contextDisplay: string, percent: number, model?: string): string {
	const theme = getPizzaTheme();
	const marquee = "🍕";
	const percentText = `${ANSI_BOLD}${colorForPercent(percent)}${contextDisplay}${ANSI_RESET}`;
	const modelText = model ? `${theme.marquee}${model}${ANSI_RESET}` : "";
	const divider = `${theme.dim} \u00b7 ${ANSI_RESET}`;

	let line = `${marquee} ${buildProgressBar(percent)} ${percentText}`;
	if (modelText) {
		line += divider + modelText;
	}
	return line;
}

function buildStatsText(ctx: ExtensionContext): string {
	const usage = getSessionUsage(ctx);
	const parts: string[] = [];
	if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
	if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
	if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
	if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);

	const usingSubscription = ctx.model ? ctx.modelRegistry.isUsingOAuth(ctx.model) : false;
	parts.push(`${formatUsd(usage.totalCost)}${usingSubscription ? " (sub)" : ""}`);

	const modelRate = getModelRateText(ctx);
	if (modelRate) {
		parts.push(`· ${modelRate}`);
	}

	return parts.join(" ");
}

// Neutral grey for the pwd/stats line directly under the message box — kept
// theme-independent so the chrome around the editor reads as chrome, not decor.
const GREY = "\x1b[38;5;244m";
const grey = (text: string): string => `${GREY}${text}${ANSI_RESET}`;

function normalizeInlineStatus(text: string): string {
	return sanitizeStatusText(text).replace(/^\s*•\s*/u, "").replace(/^\s*🎨\s*/u, "").trim();
}

function buildInlineMetaText(statuses: ReadonlyMap<string, string>): string {
	const parts: string[] = [];

	const sessionText = statuses.get("pizza.hud.20.session");
	if (sessionText) parts.push(normalizeInlineStatus(sessionText));

	return parts.join("");
}

function buildSplitStatusLine(left: string, right: string, width: number, theme: FooterTheme): string {
	const leftWidth = visibleWidth(left);
	if (!right) {
		return truncateToWidth(left, width, theme.fg("dim", "..."));
	}

	if (leftWidth >= width) {
		return truncateToWidth(left, width, theme.fg("dim", "..."));
	}

	const minGap = 2;
	const rightWidth = visibleWidth(right);
	if (leftWidth + minGap + rightWidth <= width) {
		return left + " ".repeat(width - leftWidth - rightWidth) + right;
	}

	const availableForRight = width - leftWidth - minGap;
	if (availableForRight >= 12) {
		const truncatedRight = truncateToWidth(right, availableForRight, theme.fg("dim", "..."));
		return left + " ".repeat(Math.max(minGap, width - leftWidth - visibleWidth(truncatedRight))) + truncatedRight;
	}

	return truncateToWidth(left, width, theme.fg("dim", "..."));
}

function buildPwdLine(ctx: ExtensionContext, width: number, _theme: FooterTheme, footerData: ReadonlyFooterDataProvider): string {
	let pwd = ctx.cwd;
	const home = process.env.HOME || process.env.USERPROFILE;
	if (home && pwd.startsWith(home)) {
		pwd = `~${pwd.slice(home.length)}`;
	}

	const branch = footerData.getGitBranch();
	if (branch) {
		pwd += ` (${branch})`;
	}

	const sessionName = ctx.sessionManager.getSessionName();
	if (sessionName) {
		pwd += ` • ${sessionName}`;
	}

	const stats = buildStatsText(ctx);
	if (!stats) {
		return truncateToWidth(grey(pwd), width, grey("..."));
	}

	const statsWidth = visibleWidth(stats);
	if (statsWidth >= width) {
		return grey(truncateToWidth(stats, width, "..."));
	}

	const pwdWidth = visibleWidth(pwd);
	if (pwdWidth + 1 + statsWidth <= width) {
		const gap = " ".repeat(width - pwdWidth - statsWidth);
		return grey(pwd) + gap + grey(stats);
	}

	const maxPwdWidth = Math.max(0, width - statsWidth - 1);
	if (maxPwdWidth <= 0) {
		return grey(truncateToWidth(stats, width, "..."));
	}

	const truncatedPwd = truncateToWidth(pwd, maxPwdWidth, "...");
	const gap = " ".repeat(Math.max(1, width - visibleWidth(truncatedPwd) - statsWidth));
	return grey(truncatedPwd) + gap + grey(stats);
}

function buildFooterLines(
	ctx: ExtensionContext,
	width: number,
	theme: FooterTheme,
	footerData: ReadonlyFooterDataProvider,
): string[] {
	const lines = [buildPwdLine(ctx, width, theme, footerData)];
	const extensionStatuses = Array.from(footerData.getExtensionStatuses().entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([key, text]) => [key, sanitizeStatusText(text)] as const);

	const statusMap = new Map(extensionStatuses);
	const primaryHud = statusMap.get(STATUS_KEY);
	const inlineMeta = buildInlineMetaText(statusMap);
	const auxEntries = extensionStatuses.filter(
		([key]) => key !== STATUS_KEY && key !== "pizza.hud.20.session" && key !== "pizza.theme",
	);

	if (primaryHud) {
		lines.push("");
		lines.push(buildSplitStatusLine(primaryHud, inlineMeta, width, theme));
	}

	if (auxEntries.length > 0) {
		lines.push(
			truncateToWidth(
				auxEntries.map(([, text]) => text).join(" "),
				width,
				theme.fg("dim", "..."),
			),
		);
	}
	return lines;
}

function installFooter(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	ctx.ui.setFooter((tui, theme, footerData) => {
		const dispose = footerData.onBranchChange(() => tui.requestRender());
		return {
			dispose,
			invalidate() {},
			render(width: number): string[] {
				return buildFooterLines(ctx, width, theme, footerData);
			},
		};
	});
}

function updateStatus(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	const model = formatModelLabel(ctx.model);
	const { display, percent } = getContextDisplay(ctx);
	ctx.ui.setStatus(STATUS_KEY, buildStatusLine(display, percent, model));
}

// The status line is a cached ANSI string in pi's state, so flipping the
// pizza theme doesn't recolor it until we call setStatus again. Register once
// at module load; session_start points the listener at the latest ctx.
let latestCtxForStatus: ExtensionContext | undefined;
onPizzaThemeChange(() => {
	if (latestCtxForStatus) updateStatus(latestCtxForStatus);
});

export default function pizzaStatusExtension(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		latestCtxForStatus = ctx;
		installFooter(ctx);
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
