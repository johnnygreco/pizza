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
  reason: string;
  name?: string;
  model: string;
  messageCount: number;
  lastActive?: Date;
  topic?: string;
}

type HeaderState = {
  header: PizzaHeader;
  reason: string;
};

const HEADER_STATES = new WeakMap<object, HeaderState>();

// The cycler flips Pi's theme mid-turn; turn_end won't fire until the next
// LLM response, so rebuild the cached banner as soon as the palette changes.
// Register once at module load; session_start points the listener at the
// latest ctx.
let latestCtxForHeader: any | undefined;
onPizzaThemeChange(() => {
  if (latestCtxForHeader) setOrUpdateHeader(latestCtxForHeader);
});

// ── Resources (skills / prompts / extensions / themes) ──────
// Collected once per header rebuild and passed into buildBanner so the pinned
// banner can summarize what Pi loaded at boot — and, when expanded, list the
// names grouped by source. Expansion is a module-level flag because there's
// one visual banner across the process; per-session toggling wouldn't map to
// anything users can see differently.

interface ResourceList {
  skills: string[];
  prompts: string[];
  extensions: string[]; // commands with source === "extension"
  themes: string[];
}

let resourcesExpanded = false;

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

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
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

function extractSessionMeta(event: any, ctx: any): SessionMeta {
  const entries: any[] = ctx.sessionManager?.getEntries?.() ?? [];
  const model = formatModelLabel(ctx.model) ?? "default";
  const name = ctx.sessionManager?.getSessionName?.();

  const msgEntries = entries.filter((e: any) => e.type === "message");
  const messageCount = msgEntries.length;

  let lastActive: Date | undefined;
  if (entries.length > 0) {
    const ts = entries[entries.length - 1].timestamp;
    if (ts) lastActive = new Date(ts);
  }

  let topic: string | undefined;
  const firstUser = msgEntries.find((e: any) => e.message?.role === "user");
  if (firstUser) {
    const raw = extractText(firstUser.message.content);
    if (raw) topic = truncate(raw, 40);
  }

  return { reason: event?.reason ?? "startup", name, model, messageCount, lastActive, topic };
}

function formatSessionMeta(meta: SessionMeta): string {
  const theme = getPizzaTheme();
  const dot = " " + theme.divider + "·" + R + " ";
  const parts: string[] = [];

  const isNew = meta.reason === "new" || (meta.reason === "startup" && meta.messageCount === 0);
  if (isNew) {
    parts.push(theme.key + "New session" + R);
  } else if (meta.reason === "fork") {
    parts.push(theme.key + "Forked" + R);
  } else if (meta.reason === "reload") {
    parts.push(theme.key + "Reloaded" + R);
  } else {
    parts.push(theme.key + "Resumed" + R);
  }

  if (meta.name) {
    parts.push(theme.tagText + `"${meta.name}"` + R);
  } else if (meta.topic && !isNew) {
    parts.push(theme.tagText + `"${meta.topic}"` + R);
  }

  if (meta.messageCount > 0) {
    parts.push(theme.desc + `${meta.messageCount} msgs` + R);
  }

  if (meta.lastActive && !isNew) {
    parts.push(theme.desc + relativeTime(meta.lastActive) + R);
  }

  parts.push(theme.tagPi + meta.model + R);

  return parts.join(dot);
}

// ── Static data ─────────────────────────────────────────────

const PIZZA_ART = [
  "        ▄████████████▄     ", //  0  crust top
  "       ██░░░●░░░░░●░░██    ", //  1
  "      ██░●░░░░░▮░░░░●░██   ", //  2  ─┐
  "     ██░░░▬░░░●░░░░░░░●██  ", //  3   │
  "     ██░●░░░░▮░░░●░░▬░░██  ", //  4   │ text
  "      ██░░░●░░░░░▬░░░●██   ", //  5  ─┘
  "       ██░░▮░░░●░░░░░██    ", //  6
  "        ▀████████████▀     ", //  7  crust bottom + tagline
  "            ╷┃╷  ╽ ╷       ", //  8  drips
  "         ╵  ┃╵  │          ", //  9  drips
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

function buildRightColumn(): string[] {
  const theme = getPizzaTheme();
  const lkW = Math.max(...SHORTCUTS.map((s) => s[0].length));
  const ldW = Math.max(...SHORTCUTS.map((s) => s[1].length));
  const rkW = Math.max(...SHORTCUTS.map((s) => s[2].length));
  const rdW = Math.max(...SHORTCUTS.map((s) => s[3].length));
  const rowW = lkW + 1 + ldW + 3 + rkW + 1 + rdW;

  const lines: string[] = [buildSectionRule(rowW, "shortcuts")];
  for (const [lk, ld, rk, rd] of SHORTCUTS) {
    lines.push(
      theme.key + lk.padEnd(lkW) + R + " " +
      theme.desc + ld.padEnd(ldW) + R + "   " +
      theme.key + rk.padEnd(rkW) + R + " " +
      theme.desc + rd.padEnd(rdW) + R,
    );
  }

  // Separator
  lines.push(buildSectionRule(rowW, "prefixes"));

  // Commands
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

function fullWidthRow(content: string, totalW: number): string {
  const theme = getPizzaTheme();
  const innerW = Math.max(0, totalW - 4);
  return (
    theme.border + "│" + R + " " +
    fitExact(content, innerW) + " " +
    theme.border + "│" + R
  );
}

const CENTER_PAD = "  ";
const TWO_COL_OVERHEAD = 5 + CENTER_PAD.length * 2;

function buildBanner(
  viewWidth: number,
  meta: SessionMeta,
  resources: ResourceList,
  expanded: boolean,
): string[] {
  const leftLines = buildLeftColumn();
  const rightLines = buildRightColumn();
  const leftW = Math.max(...leftLines.map((l) => visibleWidth(l)));
  const rightW = Math.max(...rightLines.map((l) => visibleWidth(l)));

  // Two-column row: │ left  │  right │
  const minTwoCol = leftW + rightW + TWO_COL_OVERHEAD;

  if (viewWidth >= minTwoCol) {
    return assembleTwoCol(leftLines, leftW, rightLines, viewWidth, meta, resources, expanded);
  }
  return assembleStacked(leftLines, leftW, rightLines, rightW, viewWidth, meta, resources, expanded);
}

// ── Resources section ───────────────────────────────────────

function buildResourcesLines(
  resources: ResourceList,
  expanded: boolean,
  innerW: number,
): string[] {
  const theme = getPizzaTheme();
  const dot = " " + theme.divider + "·" + R + " ";
  const arrow = expanded ? "▾" : "▸";
  const heading =
    theme.section + arrow + " resources" + R;

  if (!expanded) {
    const counts: Array<[string, number]> = [
      ["skills", resources.skills.length],
      ["prompts", resources.prompts.length],
      ["ext", resources.extensions.length],
      ["themes", resources.themes.length],
    ];
    const body = counts
      .map(([label, n]) => theme.key + label + R + " " + theme.desc + n + R)
      .join(dot);
    const hint = theme.dim + "(/pizza resources)" + R;
    return [`${heading}  ${body}  ${hint}`];
  }

  const lines: string[] = [heading];
  const labelW = 10; // widest label + colon = "extensions:"
  const categories: Array<[string, string[]]> = [
    ["skills", resources.skills],
    ["prompts", resources.prompts],
    ["ext", resources.extensions],
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
    // -1 accounts for the leading-space indent fullWidthRow adds on each row.
    const remaining = Math.max(8, innerW - headerVis - 1);
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

function assembleTwoCol(
  leftLines: string[],
  leftW: number,
  rightLines: string[],
  totalW: number,
  meta: SessionMeta,
  resources: ResourceList,
  expanded: boolean,
): string[] {
  const theme = getPizzaTheme();
  const rW = totalW - leftW - TWO_COL_OVERHEAD;
  const rows: string[] = [buildTopBorder(totalW)];

  // Top padding
  rows.push(fullWidthRow("", totalW));

  // Two-column content
  const maxRows = Math.max(leftLines.length, rightLines.length);
  for (let i = 0; i < maxRows; i++) {
    const l = i < leftLines.length ? leftLines[i] : "";
    const r = i < rightLines.length ? rightLines[i] : "";
    rows.push(
      theme.border + "│" + R + " " +
      fitExact(l, leftW) + CENTER_PAD +
      theme.border + "│" + R + CENTER_PAD +
      fitExact(r, rW) + " " +
      theme.border + "│" + R,
    );
  }

  // Resources section (full width)
  rows.push(fullWidthRow("", totalW));
  const innerW = Math.max(0, totalW - 4);
  for (const line of buildResourcesLines(resources, expanded, innerW)) {
    rows.push(fullWidthRow(" " + line, totalW));
  }

  // Padding before session meta
  rows.push(fullWidthRow("", totalW));

  // Session metadata (full width)
  rows.push(fullWidthRow(" " + formatSessionMeta(meta), totalW));

  rows.push(buildBotBorder(totalW));
  return rows;
}

function assembleStacked(
  leftLines: string[],
  leftW: number,
  rightLines: string[],
  rightW: number,
  viewWidth: number,
  meta: SessionMeta,
  resources: ResourceList,
  expanded: boolean,
): string[] {
  const theme = getPizzaTheme();
  const contentW = Math.max(leftW, rightW);
  const totalW = Math.max(contentW + 4, viewWidth);

  const rows: string[] = [buildTopBorder(totalW)];

  // Top padding
  rows.push(fullWidthRow("", totalW));

  for (const l of leftLines) {
    rows.push(fullWidthRow(l, totalW));
  }

  rows.push(theme.border + "├" + "─".repeat(totalW - 2) + "┤" + R);

  for (const r of rightLines) {
    rows.push(fullWidthRow(r, totalW));
  }

  // Resources section (full width)
  rows.push(fullWidthRow("", totalW));
  const innerW = Math.max(0, totalW - 4);
  for (const line of buildResourcesLines(resources, expanded, innerW)) {
    rows.push(fullWidthRow(" " + line, totalW));
  }

  // Padding before session meta
  rows.push(fullWidthRow("", totalW));

  // Session metadata
  rows.push(fullWidthRow(" " + formatSessionMeta(meta), totalW));

  rows.push(buildBotBorder(totalW));
  return rows;
}

// ── Header component ────────────────────────────────────────

class PizzaHeader {
  private meta: SessionMeta;
  private resources: ResourceList;
  private expanded: boolean;
  private cache?: { width: number; expanded: boolean; lines: string[] };
  private requestRender?: () => void;

  constructor(meta: SessionMeta, resources: ResourceList, expanded: boolean) {
    this.meta = meta;
    this.resources = resources;
    this.expanded = expanded;
  }

  attach(tui: { requestRender?: () => void } | undefined): void {
    this.requestRender = tui?.requestRender?.bind(tui);
  }

  render(width: number): string[] {
    if (!this.cache || this.cache.width !== width || this.cache.expanded !== this.expanded) {
      this.cache = {
        width,
        expanded: this.expanded,
        lines: buildBanner(width, this.meta, this.resources, this.expanded),
      };
    }
    return this.cache.lines;
  }

  invalidate(): void {
    this.cache = undefined;
  }

  update(meta: SessionMeta, resources: ResourceList, expanded: boolean): void {
    this.meta = meta;
    this.resources = resources;
    this.expanded = expanded;
    this.invalidate();
    this.requestRender?.();
  }
}

function setOrUpdateHeader(ctx: any, reason?: string): void {
  if (!ctx?.hasUI) return;

  const sessionManager = ctx.sessionManager as object | undefined;
  if (!sessionManager) return;

  const existing = HEADER_STATES.get(sessionManager);
  const effectiveReason = reason ?? existing?.reason ?? "startup";
  const meta = extractSessionMeta({ reason: effectiveReason }, ctx);
  const resources = collectResources(ctx);

  if (existing) {
    existing.reason = effectiveReason;
    existing.header.update(meta, resources, resourcesExpanded);
    return;
  }

  const header = new PizzaHeader(meta, resources, resourcesExpanded);
  HEADER_STATES.set(sessionManager, { header, reason: effectiveReason });
  ctx.ui.setHeader((tui: { requestRender?: () => void }, _theme: unknown) => {
    header.attach(tui);
    return header;
  });
}

// ── Extension entry point ────────────────────────────────────
export default function pizzaUiExtension(pi: ExtensionAPI): void {
  piApi = pi;

  pi.on("session_start", async (event, ctx) => {
    maybeWarnAboutPiCompatibility(ctx, PI_VERSION);
    if (!ctx.hasUI) return;

    latestCtxForHeader = ctx;
    syncActivePalette(ctx);
    ctx.ui.setTitle(`pizza \u00B7 ${basename(ctx.cwd)}`);
    setOrUpdateHeader(ctx, event?.reason);
  });

  pi.on("turn_end", async (_event, ctx) => {
    if (syncActivePalette(ctx)) {
      const state = HEADER_STATES.get(ctx.sessionManager as object);
      state?.header.invalidate();
    }
    setOrUpdateHeader(ctx);
  });

  pi.on("model_select", async (_event, ctx) => {
    setOrUpdateHeader(ctx);
  });

  pi.registerCommand("pizza", {
    description:
      "Show Pizza status, or run `resources` to expand/collapse the resources section",
    handler: async (args, ctx) => {
      const tokens = (args ?? "").trim().split(/\s+/).filter(Boolean);
      if (tokens[0] === "resources") {
        runResourcesCommand(tokens.slice(1), ctx);
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

function runResourcesCommand(tokens: string[], ctx: any): void {
  const arg = tokens[0]?.toLowerCase();
  const prev = resourcesExpanded;
  if (arg === "expand" || arg === "open") resourcesExpanded = true;
  else if (arg === "collapse" || arg === "close") resourcesExpanded = false;
  else resourcesExpanded = !resourcesExpanded;

  setOrUpdateHeader(ctx);
  if (prev !== resourcesExpanded) {
    emit(
      ctx,
      [`Resources ${resourcesExpanded ? "expanded" : "collapsed"}`],
      "info",
    );
  }
}

