import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { VERSION as PI_VERSION } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { basename } from "node:path";
import {
  PIZZA_VERSION,
  getPiCompatibilitySummary,
  getPiCompatibilityWarning,
} from "./shared/pi-compat.ts";
import { formatModelLabel } from "./shared/model-label.ts";
import {
  ANSI_BG_OFF,
  ANSI_RESET,
  getActivePizzaThemeName,
  getPizzaTheme,
  onPizzaThemeChange,
  syncActivePalette,
} from "./shared/pizza-palette.ts";

const VERSION = PIZZA_VERSION;

export function maybeWarnAboutPiCompatibility(
  ctx: {
    hasUI?: boolean;
    ui?: { notify(message: string, level: "warning"): void };
  },
  currentPiVersion = PI_VERSION,
): void {
  const warning = getPiCompatibilityWarning(currentPiVersion);
  if (!warning) return;

  if (ctx.hasUI && ctx.ui) {
    ctx.ui.notify(warning, "warning");
    return;
  }

  console.warn(warning);
}

const R = ANSI_RESET;

// ── Pizza art colorizer ──────────────────────────────────────
function colorizePizza(line: string): string {
  const theme = getPizzaTheme();
  let out = "";
  let curFg = "";
  let bgOn = false;
  for (const ch of line) {
    let clr = "";
    let wantBg = false;
    if ("█▄▀".includes(ch)) clr = theme.crust;
    else if (ch === "░") { clr = theme.sauce; wantBg = true; }
    else if (ch === "●") { clr = theme.pepperoni; wantBg = true; }
    else if ("▬▮".includes(ch)) { clr = theme.pepper; wantBg = true; }
    else if ("╽┃│╷╵▁▂▃".includes(ch)) clr = theme.drip;
    else {
      if (bgOn) { out += ANSI_BG_OFF; bgOn = false; }
      out += ch;
      continue;
    }
    if (wantBg && !bgOn) { out += theme.cheeseBg; bgOn = true; }
    else if (!wantBg && bgOn) { out += ANSI_BG_OFF; bgOn = false; }
    if (clr !== curFg) {
      out += clr;
      curFg = clr;
    }
    out += ch;
  }
  if (bgOn) out += ANSI_BG_OFF;
  return out + R;
}

// ── String helpers ──────────────────────────────────────────

// Pad s with spaces up to `width` visible columns. Does NOT truncate overflow.
function padRight(s: string, width: number): string {
  const vis = visibleWidth(s);
  return vis < width ? s + " ".repeat(width - vis) : s;
}

// Fit s to exactly `width` visible columns — truncate with ellipsis if too
// long, pad with spaces if too short. Used for anything rendered inside the
// bordered banner, since pi-tui rejects rows whose visible width doesn't
// match the terminal width.
function fitExact(s: string, width: number): string {
  if (width <= 0) return "";
  return visibleWidth(s) <= width
    ? padRight(s, width)
    : truncateToWidth(s, width, "…", true);
}

// ── Session metadata ────────────────────────────────────────

interface SessionMeta {
  reason: "new" | "fork" | "reload" | "resume";
  name?: string;
  messageCount: number;
  turnCount: number;
  startedAt?: Date;
  topic?: string;
}

type HeaderState = {
  header: PizzaHeader;
  reason: SessionMeta["reason"];
};

const SESSION_STATUS_KEY = "pizza.hud.20.session";

const HEADER_STATES = new WeakMap<object, HeaderState>();
const SESSION_STARTED_AT = new WeakMap<object, Date>();

// The cycler flips Pi's theme mid-turn; turn_end won't fire until the next
// LLM response, so invalidate the cached banner immediately. We avoid forcing
// a render here because changing content above the transcript causes a full
// screen redraw in Pi's TUI.
let latestCtxForHeader: any | undefined;
onPizzaThemeChange(() => {
  if (!latestCtxForHeader) return;

  const sessionManager = latestCtxForHeader.sessionManager as object | undefined;
  const state = sessionManager ? HEADER_STATES.get(sessionManager) : undefined;
  state?.header.invalidate();
  updateSessionStatus(latestCtxForHeader);
});

// ── Resources (skills / prompts / extensions / themes) ──────
// Collected once per header rebuild and passed into buildBanner so the pinned
// banner can list the names grouped by source. The banner always shows the
// expanded sections; `/pizza resources` and `/pizza shortcuts` print the same
// formatted section content on demand without mutating header state.

interface ResourceList {
  skills: string[];
  prompts: string[];
  extensions: string[]; // commands with source === "extension"
  themes: string[];
}

// `pi` (ExtensionAPI) is captured at registration so we can read getCommands()
// during event handling. Only ExtensionAPI exposes getCommands — ExtensionContext
// does not — so reaching it through `ctx` at render time would always be empty.
let piApi: { getCommands?: () => Array<{ name: string; source: string }> } | undefined;

function collectResources(ctx: any): ResourceList {
  const commands: Array<{ name: string; source: string }> =
    piApi?.getCommands?.() ?? [];
  const bySource = (s: string) =>
    commands
      .filter((c) => c.source === s)
      .map((c) => c.name)
      .sort();
  const themeEntries: Array<{ name: string }> = ctx?.ui?.getAllThemes?.() ?? [];
  const themes = themeEntries.map((t) => t.name).sort();
  return {
    skills: bySource("skill").map((n) => n.replace(/^skill:/, "")),
    prompts: bySource("prompt"),
    extensions: bySource("extension"),
    themes,
  };
}

function parseTimestamp(value: unknown): Date | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function minDate(a: Date | undefined, b: Date | undefined): Date | undefined {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() <= b.getTime() ? a : b;
}

function formatElapsed(date: Date): string {
  const diffMs = Math.max(0, Date.now() - date.getTime());
  const totalMinutes = Math.floor(diffMs / 60000);
  if (totalMinutes < 1) return "<1m";
  if (totalMinutes < 60) return `${totalMinutes}m`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) {
    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
  }

  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours === 0 ? `${days}d` : `${days}d ${remHours}h`;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join(" ");
  }
  return "";
}

function truncate(s: string, maxLen: number): string {
  const line = s.split("\n")[0].trim();
  if (line.length <= maxLen) return line;
  return line.slice(0, maxLen - 1) + "…";
}

function normalizeSessionReason(
  reason: string | undefined,
  messageCount: number,
): SessionMeta["reason"] {
  if (reason === "new" || reason === "fork" || reason === "reload" || reason === "resume") {
    return reason;
  }
  return messageCount === 0 ? "new" : "resume";
}

function extractSessionMeta(reason: string | undefined, ctx: any): SessionMeta {
  const entries: any[] = ctx.sessionManager?.getEntries?.() ?? [];
  const name = ctx.sessionManager?.getSessionName?.();
  const sessionManager = ctx.sessionManager as object | undefined;
  const trackedStart = sessionManager ? SESSION_STARTED_AT.get(sessionManager) : undefined;

  const msgEntries = entries.filter((e: any) => e.type === "message");
  const messageCount = msgEntries.length;
  const turnCount = msgEntries.filter((e: any) => e.message?.role === "user").length;

  const firstEntryWithTimestamp = entries
    .map((entry: any) => parseTimestamp(entry?.timestamp))
    .find((date): date is Date => Boolean(date));
  const startedAt = minDate(trackedStart, firstEntryWithTimestamp);

  let topic: string | undefined;
  const firstUser = msgEntries.find((e: any) => e.message?.role === "user");
  if (firstUser) {
    const raw = extractText(firstUser.message.content);
    if (raw) topic = truncate(raw, 40);
  }

  return {
    reason: normalizeSessionReason(reason, messageCount),
    name,
    messageCount,
    turnCount,
    startedAt,
    topic,
  };
}

function formatSessionMeta(meta: SessionMeta): string {
  const theme = getPizzaTheme();
  const dot = " " + theme.divider + "·" + R + " ";
  const parts: string[] = [];

  if (meta.reason === "fork") {
    parts.push(theme.key + "Forked" + R);
  } else if (meta.reason === "reload") {
    parts.push(theme.key + "Reloaded" + R);
  } else if (meta.reason === "resume") {
    parts.push(theme.key + "Resumed" + R);
  }

  if (meta.name) {
    parts.push(theme.tagText + `"${meta.name}"` + R);
  } else if (meta.topic && meta.reason !== "new") {
    parts.push(theme.tagText + `"${meta.topic}"` + R);
  }

  return parts.join(dot);
}

function formatLiveSessionStatus(meta: SessionMeta): string {
  const theme = getPizzaTheme();
  const dot = " " + theme.divider + "·" + R + " ";
  const parts: string[] = [];

  if (meta.reason === "fork") {
    parts.push(theme.key + "Forked" + R);
  } else if (meta.reason === "reload") {
    parts.push(theme.key + "Reloaded" + R);
  } else if (meta.reason === "resume") {
    parts.push(theme.key + "Resumed" + R);
  }

  if (meta.name) {
    parts.push(theme.tagText + `"${meta.name}"` + R);
  } else if (meta.topic) {
    parts.push(theme.tagText + `"${meta.topic}"` + R);
  }

  parts.push(theme.desc + pluralize(meta.messageCount, "msg") + R);
  parts.push(theme.desc + pluralize(meta.turnCount, "turn") + R);
  if (meta.startedAt) {
    parts.push(theme.desc + `${formatElapsed(meta.startedAt)} running` + R);
  }

  if (parts.length === 0) return "";

  return theme.section + "•" + R + " " + parts.join(dot);
}

// ── Static data ─────────────────────────────────────────────

const PIZZA_ART = [
  "   ▄████████████▄     ", //  0  crust top
  "  ██░░░●░░░░░●░░██    ", //  1
  " ██░●░░░░░▮░░░░●░██   ", //  2  ─┐
  "██░░░▬░░░●░░░░░░░●██  ", //  3   │
  "██░●░░░░▮░░░●░░▬░░██  ", //  4   │ text
  " ██░░░●░░░░░▬░░░●██   ", //  5  ─┘
  "  ██░░▮░░░●░░░░░██    ", //  6
  "   ▀████████████▀     ", //  7  crust bottom + tagline
  "       ╷┃╷  ╽ ╷       ", //  8  drips
  "    ╵  ┃╵  │          ", //  9  drips
];

type LetterToken = "letterP" | "letterI" | "letterZ1" | "letterZ2" | "letterA";
const PIZZA_LETTERS: { lines: string[]; token: LetterToken }[] = [
  { lines: ["╔═══╗ ", "║   ║ ", "╠═══╝ ", "║     ", "╩     "], token: "letterP" },
  { lines: ["═╦═ ", " ║  ", " ║  ", " ║  ", "═╩═ "], token: "letterI" },
  { lines: ["╔═════╗ ", "    ╔═╝ ", "  ╔═╝   ", "╔═╝     ", "╚═════╝ "], token: "letterZ1" },
  { lines: ["╔═════╗ ", "    ╔═╝ ", "  ╔═╝   ", "╔═╝     ", "╚═════╝ "], token: "letterZ2" },
  { lines: ["╔═══╗", "║   ║", "╠═══╣", "║   ║", "╩   ╩"], token: "letterA" },
];

// Two-column shortcut grid: [left_key, left_desc, right_key, right_desc]
const SHORTCUTS: [string, string, string, string][] = [
  ["Esc",        "interrupt",      "Shift+Tab", "cycle thinking"],
  ["Ctrl+C",     "clear editor",   "Ctrl+P",    "cycle models"],
  ["Ctrl+C x2",  "quit",           "Ctrl+L",    "model picker"],
  ["Ctrl+D",     "exit if empty",  "Ctrl+O",    "toggle tools"],
  ["Ctrl+Z",     "suspend",        "Ctrl+T",    "toggle thinking"],
  ["Ctrl+K",     "delete to end",  "Ctrl+G",    "external editor"],
  ["Ctrl+V",     "paste image",    "Alt+Enter", "queue follow-up"],
  ["Alt+Up",     "restore queued", "Drag+drop", "attach files"],
];

const COMMANDS: [string, string][] = [
  ["/", "commands"],
  ["!", "bash"],
  ["!!", "bash (no ctx)"],
];

// ── Column builders ─────────────────────────────────────────

function buildLeftColumn(): string[] {
  const theme = getPizzaTheme();
  const pizza = PIZZA_ART.map(colorizePizza);
  const GAP = "  ";
  const TEXT_ROW = 2;

  const textLines: string[] = [];
  for (let row = 0; row < 5; row++) {
    let line = "";
    for (const { lines, token } of PIZZA_LETTERS) {
      line += theme[token] + lines[row] + R;
    }
    textLines.push(line);
  }

  const content: string[] = [];
  for (let i = 0; i < pizza.length; i++) {
    const ti = i - TEXT_ROW;
    if (ti >= 0 && ti < textLines.length) {
      content.push(pizza[i] + GAP + textLines[ti]);
    } else if (i === 7) {
      content.push(
        pizza[i] + GAP + theme.tagPi + "Pi " + R + theme.tagText + "with extra toppings" + R,
      );
    } else {
      content.push(pizza[i]);
    }
  }
  return content;
}

function buildSectionRule(width: number, label: string): string {
  const theme = getPizzaTheme();
  const text = ` ${label.toUpperCase()} `;
  if (width <= text.length) {
    return theme.section + text.slice(0, width) + R;
  }
  const left = Math.floor((width - text.length) / 2);
  const right = width - text.length - left;
  return (
    theme.divider + "─".repeat(left) + R +
    theme.section + text + R +
    theme.divider + "─".repeat(right) + R
  );
}

function buildCommandsLine(rowW: number): string {
  const theme = getPizzaTheme();
  const segments = COMMANDS.map(
    ([key, desc]) => theme.key + key + R + " " + theme.desc + desc + R,
  );
  const visibleSegments = COMMANDS.map(([key, desc]) => `${key} ${desc}`);
  const contentW = visibleSegments.reduce((sum, segment) => sum + segment.length, 0);
  const gaps = Math.max(1, segments.length - 1);
  const totalGap = Math.max(3 * gaps, rowW - contentW);
  const baseGap = Math.floor(totalGap / gaps);
  const extraGap = totalGap % gaps;

  let line = "";
  for (let i = 0; i < segments.length; i++) {
    if (i > 0) {
      line += " ".repeat(baseGap + (i <= extraGap ? 1 : 0));
    }
    line += segments[i];
  }
  return line;
}

function buildShortcutsPanel(): string[] {
  const theme = getPizzaTheme();
  const lkW = Math.max(...SHORTCUTS.map((s) => s[0].length));
  const ldW = Math.max(...SHORTCUTS.map((s) => s[1].length));
  const rkW = Math.max(...SHORTCUTS.map((s) => s[2].length));
  const rdW = Math.max(...SHORTCUTS.map((s) => s[3].length));
  const rowW = lkW + 1 + ldW + 3 + rkW + 1 + rdW;
  const heading = theme.section + "▾ shortcuts + prefixes" + R;

  const lines: string[] = [heading, buildSectionRule(rowW, "shortcuts")];
  for (const [lk, ld, rk, rd] of SHORTCUTS) {
    lines.push(
      theme.key + lk.padEnd(lkW) + R + " " +
      theme.desc + ld.padEnd(ldW) + R + "   " +
      theme.key + rk.padEnd(rkW) + R + " " +
      theme.desc + rd.padEnd(rdW) + R,
    );
  }

  lines.push(buildSectionRule(rowW, "prefixes"));
  lines.push(buildCommandsLine(rowW));

  return lines;
}

// ── Banner assembly ─────────────────────────────────────────

function buildTopBorder(totalW: number): string {
  const theme = getPizzaTheme();
  const titleVis = `── pizza v${VERSION} ── pi v${PI_VERSION} `;
  const fill = Math.max(0, totalW - 2 - titleVis.length);
  return (
    theme.border + "╭── " + R +
    theme.tagPi + "pizza " + R +
    theme.tagText + "v" + VERSION + R + " " +
    theme.border + "── " + R +
    theme.tagText + "pi v" + PI_VERSION + R + " " +
    theme.border + "─".repeat(fill) + "╮" + R
  );
}

function buildBotBorder(totalW: number): string {
  const theme = getPizzaTheme();
  return theme.border + "╰" + "─".repeat(totalW - 2) + "╯" + R;
}

const ROW_PAD = "   ";
const ROW_PAD_VIS = ROW_PAD.length;

function fullWidthRow(content: string, totalW: number): string {
  const theme = getPizzaTheme();
  const innerW = Math.max(0, totalW - 2 - ROW_PAD_VIS * 2);
  return (
    theme.border + "│" + R + ROW_PAD +
    fitExact(content, innerW) + ROW_PAD +
    theme.border + "│" + R
  );
}

const PANEL_SEP_VIS = ROW_PAD_VIS + 1 + ROW_PAD_VIS;
const RESOURCE_PANEL_MAX_WIDTH = 85;

// ── Resources section ───────────────────────────────────────

function buildResourcesLines(
  resources: ResourceList,
  valueW: number,
): string[] {
  const theme = getPizzaTheme();
  const heading =
    theme.section + "▾ resources" + R;

  const lines: string[] = [heading];
  const labelW = 12; // widest label + colon = "extensions:"
  const categories: Array<[string, string[]]> = [
    ["skills", resources.skills],
    ["prompts", resources.prompts],
    ["extensions", resources.extensions],
    ["themes", resources.themes],
  ];
  for (const [label, items] of categories) {
    const header =
      "  " + theme.key + (label + ":").padEnd(labelW) + R + " " +
      theme.dim + "(" + items.length + ")" + R + " ";
    const headerVis = visibleWidth(header);
    if (items.length === 0) {
      lines.push(header + theme.dim + "—" + R);
      continue;
    }
    const remaining = Math.max(8, valueW);
    const continuationIndent = " ".repeat(headerVis);

    const wrappedBodies: string[] = [];
    let current = "";
    for (const item of items) {
      const candidate = current.length === 0 ? item : current + ", " + item;
      if (visibleWidth(candidate) <= remaining) {
        current = candidate;
      } else {
        if (current.length > 0) wrappedBodies.push(current);
        current = item;
      }
    }
    if (current.length > 0) wrappedBodies.push(current);

    for (let i = 0; i < wrappedBodies.length; i++) {
      const prefix = i === 0 ? header : continuationIndent;
      lines.push(prefix + theme.desc + wrappedBodies[i] + R);
    }
  }
  return lines;
}

function getResourcesHeaderWidth(resources: ResourceList): number {
  const theme = getPizzaTheme();
  const labelW = 12;
  return Math.max(
    ...(["skills", "prompts", "extensions", "themes"] as const).map((label) => {
      const items = resources[label];
      const header =
        "  " + theme.key + (label + ":").padEnd(labelW) + R + " " +
        theme.dim + "(" + items.length + ")" + R + " ";
      return visibleWidth(header);
    }),
  );
}

type BannerPanel = {
  key: "logo" | "shortcuts" | "resources";
  lines: string[];
  width: number;
};

type PlacedPanel = BannerPanel & { clampedWidth: number };

function maxLineWidth(lines: string[]): number {
  if (lines.length === 0) return 0;
  return Math.max(...lines.map((line) => visibleWidth(line)));
}

function groupPanelsIntoRows(panels: BannerPanel[], innerW: number): PlacedPanel[][] {
  if (panels.length === 0) return [];
  if (innerW <= 0) {
    return panels.map((panel) => [{ ...panel, clampedWidth: 0 }]);
  }

  const rows: PlacedPanel[][] = [];
  let currentRow: PlacedPanel[] = [];
  let used = 0;

  for (const panel of panels) {
    const clampedWidth = Math.min(panel.width, innerW);
    const needed = currentRow.length === 0 ? clampedWidth : PANEL_SEP_VIS + clampedWidth;

    if (currentRow.length > 0 && used + needed > innerW) {
      rows.push(currentRow);
      currentRow = [{ ...panel, clampedWidth }];
      used = clampedWidth;
      continue;
    }

    currentRow.push({ ...panel, clampedWidth });
    used += needed;
  }

  if (currentRow.length > 0) rows.push(currentRow);
  return rows;
}

function pluralize(count: number, singular: string, pluralForm?: string): string {
  const noun = count === 1 ? singular : (pluralForm ?? `${singular}s`);
  return `${count} ${noun}`;
}

function getShortcutsPanelLines(): string[] {
  return buildShortcutsPanel();
}

function getShortcutsPanelWidth(innerW?: number): number {
  const width = maxLineWidth(getShortcutsPanelLines());
  return innerW == null ? width : Math.min(innerW, width);
}

function getResourcesPanelLines(resources: ResourceList, panelW?: number): string[] {
  return buildResourcesLines(resources, panelW ?? RESOURCE_PANEL_MAX_WIDTH);
}

function buildPanels(
  logoLines: string[],
  innerW: number,
  resources: ResourceList,
): BannerPanel[] {
  const shortcutLines = getShortcutsPanelLines();
  const resourceHeaderWidth = getResourcesHeaderWidth(resources);
  const resourceValueWidth = Math.max(
    8,
    Math.min(RESOURCE_PANEL_MAX_WIDTH, innerW - resourceHeaderWidth),
  );
  const resourceLines = getResourcesPanelLines(resources, resourceValueWidth);

  return [
    { key: "logo", lines: logoLines, width: maxLineWidth(logoLines) },
    { key: "shortcuts", lines: shortcutLines, width: maxLineWidth(shortcutLines) },
    { key: "resources", lines: resourceLines, width: maxLineWidth(resourceLines) },
  ];
}

function renderPanelRow(panels: PlacedPanel[], totalW: number): string[] {
  const theme = getPizzaTheme();
  const separator = ROW_PAD + theme.border + "│" + R + ROW_PAD;
  const maxRows = Math.max(...panels.map((panel) => panel.lines.length));

  const rows: string[] = [];
  for (let i = 0; i < maxRows; i++) {
    const content = panels
      .map((panel) => {
        // Vertically center the logo only — other panels read like a list
        // (heading + items) and should stay top-aligned.
        const topPad =
          panel.key === "logo"
            ? Math.floor((maxRows - panel.lines.length) / 2)
            : 0;
        const idx = i - topPad;
        const line = idx >= 0 && idx < panel.lines.length ? panel.lines[idx] : "";
        return fitExact(line, panel.clampedWidth);
      })
      .join(separator);
    rows.push(fullWidthRow(content, totalW));
  }
  return rows;
}

function buildGroupSeparatorRow(totalW: number): string {
  const theme = getPizzaTheme();
  return theme.border + "├" + "─".repeat(Math.max(0, totalW - 2)) + "┤" + R;
}

function buildBanner(
  viewWidth: number,
  meta: SessionMeta,
  resources: ResourceList,
): string[] {
  const totalW = Math.max(4, viewWidth);
  const innerW = Math.max(0, totalW - 2 - ROW_PAD_VIS * 2);

  const logoLines = buildLeftColumn();
  const panels = buildPanels(logoLines, innerW, resources);
  const panelRows = groupPanelsIntoRows(panels, innerW);
  const rows: string[] = [buildTopBorder(totalW), fullWidthRow("", totalW)];

  for (let i = 0; i < panelRows.length; i++) {
    rows.push(...renderPanelRow(panelRows[i], totalW));
    if (i < panelRows.length - 1) {
      rows.push(fullWidthRow("", totalW));
      rows.push(buildGroupSeparatorRow(totalW));
      rows.push(fullWidthRow("", totalW));
    }
  }

  rows.push(fullWidthRow("", totalW));
  const sessionMeta = formatSessionMeta(meta);
  if (sessionMeta) {
    rows.push(fullWidthRow(" " + sessionMeta, totalW));
  }
  rows.push(buildBotBorder(totalW));
  return rows;
}

// ── Header component ────────────────────────────────────────

class PizzaHeader {
  private meta: SessionMeta;
  private resources: ResourceList;
  private cache?: {
    width: number;
    lines: string[];
  };
  private requestRender?: () => void;

  constructor(meta: SessionMeta, resources: ResourceList) {
    this.meta = meta;
    this.resources = resources;
  }

  attach(tui: { requestRender?: () => void } | undefined): void {
    this.requestRender = tui?.requestRender?.bind(tui);
  }

  render(width: number): string[] {
    if (
      !this.cache ||
      this.cache.width !== width
    ) {
      this.cache = {
        width,
        lines: buildBanner(width, this.meta, this.resources),
      };
    }
    return this.cache.lines;
  }

  invalidate(): void {
    this.cache = undefined;
  }

  update(meta: SessionMeta, resources: ResourceList): void {
    this.meta = meta;
    this.resources = resources;
    this.invalidate();
    this.requestRender?.();
  }
}

function setOrUpdateHeader(ctx: any, reason?: string): void {
  if (!ctx?.hasUI) return;

  const sessionManager = ctx.sessionManager as object | undefined;
  if (!sessionManager) return;

  const existing = HEADER_STATES.get(sessionManager);
  const meta = extractSessionMeta(reason ?? existing?.reason, ctx);
  const resources = collectResources(ctx);

  if (existing) {
    existing.reason = meta.reason;
    existing.header.update(meta, resources);
    return;
  }

  const header = new PizzaHeader(meta, resources);
  HEADER_STATES.set(sessionManager, { header, reason: meta.reason });
  ctx.ui.setHeader((tui: { requestRender?: () => void }, _theme: unknown) => {
    header.attach(tui);
    return header;
  });
}

function updateSessionStatus(ctx: any, reason?: string): void {
  if (!ctx?.hasUI || !ctx?.ui?.setStatus) return;

  const sessionManager = ctx.sessionManager as object | undefined;
  const existing = sessionManager ? HEADER_STATES.get(sessionManager) : undefined;
  const meta = extractSessionMeta(reason ?? existing?.reason, ctx);

  if (existing) {
    existing.reason = meta.reason;
  }

  ctx.ui.setStatus(SESSION_STATUS_KEY, formatLiveSessionStatus(meta));
}

// ── Extension entry point ────────────────────────────────────
export default function pizzaUiExtension(pi: ExtensionAPI): void {
  piApi = pi;

  pi.on("session_start", async (event, ctx) => {
    maybeWarnAboutPiCompatibility(ctx, PI_VERSION);
    if (!ctx.hasUI) return;

    latestCtxForHeader = ctx;
    const sessionManager = ctx.sessionManager as object | undefined;
    if (sessionManager && !SESSION_STARTED_AT.has(sessionManager)) {
      SESSION_STARTED_AT.set(sessionManager, new Date());
    }
    syncActivePalette(ctx);
    ctx.ui.setTitle(`pizza \u00B7 ${basename(ctx.cwd)}`);
    setOrUpdateHeader(ctx, event?.reason);
    updateSessionStatus(ctx, event?.reason);
  });

  pi.on("turn_end", async (_event, ctx) => {
    if (syncActivePalette(ctx)) {
      const state = HEADER_STATES.get(ctx.sessionManager as object);
      state?.header.invalidate();
    }
    updateSessionStatus(ctx);
  });

  pi.registerCommand("pizza", {
    description:
      "Show Pizza status, or print the resources/shortcuts banner sections",
    handler: async (args, ctx) => {
      const tokens = (args ?? "").trim().split(/\s+/).filter(Boolean);
      const cmd = tokens[0]?.toLowerCase();

      if (cmd === "resources") {
        runResourcesCommand(tokens.slice(1), ctx);
        return;
      }
      if (cmd === "shortcuts") {
        runShortcutsCommand(tokens.slice(1), ctx);
        return;
      }
      if (cmd === "help" || cmd === "-h" || cmd === "--help") {
        emit(ctx, pizzaCommandHelpLines(), "info");
        return;
      }
      if (cmd && cmd.length > 0) {
        emit(ctx, [`Unknown /pizza subcommand: ${cmd}`, ...pizzaCommandHelpLines()], "warning");
        return;
      }

      const model = formatModelLabel(ctx.model) ?? "default";
      const usage = ctx.getContextUsage();
      const lines = [
        `\u{1F355} pizza v${VERSION}`,
        `Pi: ${getPiCompatibilitySummary(PI_VERSION)}`,
        `Model: ${model}`,
        `CWD: ${ctx.cwd}`,
        `Theme: ${getActivePizzaThemeName()}`,
        "Banner: resources + shortcuts inline",
      ];
      if (usage?.percent != null) {
        lines.push(`Context: ${usage.percent}%`);
      }
      emit(ctx, lines, "info");
    },
  });
}

function emit(ctx: any, lines: string[], level: "info" | "warning"): void {
  const msg = lines.join("\n");
  if (ctx?.hasUI && ctx.ui) ctx.ui.notify(msg, level);
  else console.log(msg);
}

function pizzaCommandHelpLines(): string[] {
  return [
    "Usage:",
    "  /pizza",
    "  /pizza resources",
    "  /pizza shortcuts",
  ];
}

function runResourcesCommand(tokens: string[], ctx: any): void {
  if (tokens.length > 0) {
    emit(ctx, [
      `/pizza resources does not take arguments`,
      "Try: /pizza resources",
    ], "warning");
    return;
  }

  emit(ctx, getResourcesPanelLines(collectResources(ctx)), "info");
}

function runShortcutsCommand(tokens: string[], ctx: any): void {
  if (tokens.length > 0) {
    emit(ctx, [
      `/pizza shortcuts does not take arguments`,
      "Try: /pizza shortcuts",
    ], "warning");
    return;
  }

  emit(ctx, getShortcutsPanelLines(), "info");
}
