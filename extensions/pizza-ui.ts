import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { VERSION as PI_VERSION } from "@mariozechner/pi-coding-agent";
import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "..", "package.json"), "utf-8"),
);

const VERSION: string = pkg.version;

// ── ANSI color palette ───────────────────────────────────────
const R = "\x1b[0m";
const B = "\x1b[1m";
const fg = (n: number) => `\x1b[38;5;${n}m`;
const bg = (n: number) => `\x1b[48;5;${n}m`;
const BG_OFF = "\x1b[49m";

const CRUST = fg(208);
const CHEESE_BG = bg(220);
const PEP = fg(196);
const PEPPER = fg(46);
const DRIP = fg(228);
const SAUCE = fg(160);
const CLR_P = B + fg(51);
const CLR_I = B + fg(199);
const CLR_Z1 = B + fg(226);
const CLR_Z2 = B + fg(46);
const CLR_A = B + fg(171);
const BORDER_CLR = B + fg(93);
const TAG_PI = B + fg(51);
const TAG_TXT = fg(245);
const KEY_CLR = B + fg(81);
const DESC_CLR = fg(252);
const DIV_CLR = fg(240);

// ── Pizza art colorizer ──────────────────────────────────────
function colorizePizza(line: string): string {
  let out = "";
  let curFg = "";
  let bgOn = false;
  for (const ch of line) {
    let clr = "";
    let wantBg = false;
    if ("█▄▀".includes(ch)) clr = CRUST;
    else if (ch === "░") { clr = SAUCE; wantBg = true; }
    else if (ch === "●") { clr = PEP; wantBg = true; }
    else if ("▬▮".includes(ch)) { clr = PEPPER; wantBg = true; }
    else if ("╽┃│╷╵".includes(ch)) clr = DRIP;
    else {
      if (bgOn) { out += BG_OFF; bgOn = false; }
      out += ch;
      continue;
    }
    if (wantBg && !bgOn) { out += CHEESE_BG; bgOn = true; }
    else if (!wantBg && bgOn) { out += BG_OFF; bgOn = false; }
    if (clr !== curFg) {
      out += clr;
      curFg = clr;
    }
    out += ch;
  }
  if (bgOn) out += BG_OFF;
  return out + R;
}

// ── String helpers ──────────────────────────────────────────
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function padRight(s: string, width: number): string {
  const vis = stripAnsi(s).length;
  return vis < width ? s + " ".repeat(width - vis) : s;
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
  const model = ctx.model?.name ?? ctx.model?.id ?? "default";
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
  const dot = " " + DIV_CLR + "·" + R + " ";
  const parts: string[] = [];

  const isNew = meta.reason === "new" || (meta.reason === "startup" && meta.messageCount === 0);
  if (isNew) {
    parts.push(KEY_CLR + "New session" + R);
  } else if (meta.reason === "fork") {
    parts.push(KEY_CLR + "Forked" + R);
  } else if (meta.reason === "reload") {
    parts.push(KEY_CLR + "Reloaded" + R);
  } else {
    parts.push(KEY_CLR + "Resumed" + R);
  }

  if (meta.name) {
    parts.push(TAG_TXT + `"${meta.name}"` + R);
  } else if (meta.topic && !isNew) {
    parts.push(TAG_TXT + `"${meta.topic}"` + R);
  }

  if (meta.messageCount > 0) {
    parts.push(DESC_CLR + `${meta.messageCount} msgs` + R);
  }

  if (meta.lastActive && !isNew) {
    parts.push(DESC_CLR + relativeTime(meta.lastActive) + R);
  }

  parts.push(TAG_PI + meta.model + R);

  return parts.join(dot);
}

// ── Static data ─────────────────────────────────────────────

const PIZZA_ART = [
  "        ▄████████████▄     ", //  0  crust top
  "       █░░░░●░░░░░●░░░█    ", //  1
  "      █░░●░░░░░▮░░░░●░░█   ", //  2  ─┐
  "     █░░░░▬░░░●░░░░░░░●░█  ", //  3   │
  "     █░░●░░░░▮░░░●░░▬░░░█  ", //  4   │ text
  "      █░░░░●░░░░░▬░░░●░█   ", //  5  ─┘
  "       █░░░▮░░░●░░░░░░█    ", //  6
  "        ▀████████████▀     ", //  7  crust bottom + tagline
  "          ╷   ┃╷   ╽       ", //  8  drips
  "              ╵            ", //  9
];

const PIZZA_LETTERS: { lines: string[]; clr: string }[] = [
  { lines: ["╔═══╗ ", "║   ║ ", "╠═══╝ ", "║     ", "╩     "], clr: CLR_P },
  { lines: ["═╦═ ", " ║  ", " ║  ", " ║  ", "═╩═ "], clr: CLR_I },
  { lines: ["╔═════╗ ", "    ╔═╝ ", "  ╔═╝   ", "╔═╝     ", "╚═════╝ "], clr: CLR_Z1 },
  { lines: ["╔═════╗ ", "    ╔═╝ ", "  ╔═╝   ", "╔═╝     ", "╚═════╝ "], clr: CLR_Z2 },
  { lines: ["╔═══╗", "║   ║", "╠═══╣", "║   ║", "╩   ╩"], clr: CLR_A },
];

// Two-column shortcut grid: [left_key, left_desc, right_key, right_desc]
const SHORTCUTS: [string, string, string, string][] = [
  ["esc",   "interrupt",  "s+tab",   "cycle thinking"],
  ["^c",    "clear",      "^p",      "cycle models"],
  ["^c×2",  "exit",       "^l",      "select model"],
  ["^d",    "exit (∅)",   "^o",      "expand tools"],
  ["^z",    "suspend",    "^t",      "expand thinking"],
  ["^k",    "del→end",    "^g",      "ext. editor"],
  ["^v",    "paste img",  "a+enter", "queue follow-up"],
  ["a+up",  "edit q'd",   "drop",    "files to attach"],
];

const COMMANDS: [string, string][] = [
  ["/", "commands"],
  ["!", "bash"],
  ["!!", "bash (no ctx)"],
];

// ── Column builders ─────────────────────────────────────────

function buildLeftColumn(): string[] {
  const pizza = PIZZA_ART.map(colorizePizza);
  const GAP = "  ";
  const TEXT_ROW = 2;

  const textLines: string[] = [];
  for (let row = 0; row < 5; row++) {
    let line = "";
    for (const { lines, clr } of PIZZA_LETTERS) {
      line += clr + lines[row] + R;
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
        pizza[i] + GAP + TAG_PI + "Pi " + R + TAG_TXT + "with toppings" + R,
      );
    } else {
      content.push(pizza[i]);
    }
  }
  return content;
}

function buildRightColumn(): string[] {
  const lkW = Math.max(...SHORTCUTS.map((s) => s[0].length));
  const ldW = Math.max(...SHORTCUTS.map((s) => s[1].length));
  const rkW = Math.max(...SHORTCUTS.map((s) => s[2].length));
  const rdW = Math.max(...SHORTCUTS.map((s) => s[3].length));

  const lines: string[] = [];
  for (const [lk, ld, rk, rd] of SHORTCUTS) {
    lines.push(
      KEY_CLR + lk.padEnd(lkW) + R + " " +
      DESC_CLR + ld.padEnd(ldW) + R + "   " +
      KEY_CLR + rk.padEnd(rkW) + R + " " +
      DESC_CLR + rd.padEnd(rdW) + R,
    );
  }

  // Separator
  const rowW = lkW + 1 + ldW + 3 + rkW + 1 + rdW;
  lines.push(DIV_CLR + "─".repeat(rowW) + R);

  // Commands
  let cmdLine = "";
  for (let i = 0; i < COMMANDS.length; i++) {
    if (i > 0) cmdLine += "   ";
    cmdLine += KEY_CLR + COMMANDS[i][0] + R + " " + DESC_CLR + COMMANDS[i][1] + R;
  }
  lines.push(cmdLine);

  return lines;
}

// ── Banner assembly ─────────────────────────────────────────

function buildTopBorder(totalW: number): string {
  const titleVis = `── pizza v${VERSION} ── pi v${PI_VERSION} `;
  const fill = Math.max(0, totalW - 2 - titleVis.length);
  return (
    BORDER_CLR + "╭── " + R +
    TAG_PI + "pizza " + R +
    TAG_TXT + "v" + VERSION + R + " " +
    BORDER_CLR + "── " + R +
    TAG_TXT + "pi v" + PI_VERSION + R + " " +
    BORDER_CLR + "─".repeat(fill) + "╮" + R
  );
}

function buildBotBorder(totalW: number): string {
  return BORDER_CLR + "╰" + "─".repeat(totalW - 2) + "╯" + R;
}

function fullWidthRow(content: string, totalW: number): string {
  const innerW = totalW - 4;
  return (
    BORDER_CLR + "│" + R + " " +
    padRight(content, innerW) + " " +
    BORDER_CLR + "│" + R
  );
}

function buildBanner(viewWidth: number, meta: SessionMeta): string[] {
  const leftLines = buildLeftColumn();
  const rightLines = buildRightColumn();
  const leftW = Math.max(...leftLines.map((l) => stripAnsi(l).length));
  const rightW = Math.max(...rightLines.map((l) => stripAnsi(l).length));

  // Two-column row: │ left │ right │ = leftW + rightW + 7
  const minTwoCol = leftW + rightW + 7;

  if (viewWidth >= minTwoCol) {
    return assembleTwoCol(leftLines, leftW, rightLines, viewWidth, meta);
  }
  return assembleStacked(leftLines, leftW, rightLines, rightW, viewWidth, meta);
}

function assembleTwoCol(
  leftLines: string[],
  leftW: number,
  rightLines: string[],
  totalW: number,
  meta: SessionMeta,
): string[] {
  const rW = totalW - leftW - 7;
  const rows: string[] = [buildTopBorder(totalW)];

  // Top padding
  rows.push(fullWidthRow("", totalW));

  // Two-column content
  const maxRows = Math.max(leftLines.length, rightLines.length);
  for (let i = 0; i < maxRows; i++) {
    const l = i < leftLines.length ? leftLines[i] : "";
    const r = i < rightLines.length ? rightLines[i] : "";
    rows.push(
      BORDER_CLR + "│" + R + " " +
      padRight(l, leftW) + " " +
      BORDER_CLR + "│" + R + " " +
      padRight(r, rW) + " " +
      BORDER_CLR + "│" + R,
    );
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
): string[] {
  const contentW = Math.max(leftW, rightW);
  const totalW = Math.max(contentW + 4, viewWidth);
  const inner = totalW - 4;

  const rows: string[] = [buildTopBorder(totalW)];

  // Top padding
  rows.push(fullWidthRow("", totalW));

  for (const l of leftLines) {
    rows.push(fullWidthRow(l, totalW));
  }

  rows.push(BORDER_CLR + "├" + "─".repeat(totalW - 2) + "┤" + R);

  for (const r of rightLines) {
    rows.push(fullWidthRow(r, totalW));
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
  private cache?: { width: number; lines: string[] };

  constructor(meta: SessionMeta) {
    this.meta = meta;
  }

  render(width: number): string[] {
    if (!this.cache || this.cache.width !== width) {
      this.cache = { width, lines: buildBanner(width, this.meta) };
    }
    return this.cache.lines;
  }

  invalidate(): void {
    this.cache = undefined;
  }
}

// ── Extension entry point ────────────────────────────────────
export default function pizzaUiExtension(pi: ExtensionAPI): void {
  pi.on("session_start", async (event, ctx) => {
    if (!ctx.hasUI) return;

    ctx.ui.setTitle(`pizza \u00B7 ${basename(ctx.cwd)}`);
    const meta = extractSessionMeta(event, ctx);
    ctx.ui.setHeader((_tui, _theme) => new PizzaHeader(meta));
  });

  pi.registerCommand("pizza", {
    description: "Show Pizza configuration and status",
    handler: async (_args, ctx) => {
      const model = ctx.model?.name ?? ctx.model?.id ?? "default";
      const usage = ctx.getContextUsage();
      const lines = [
        `\u{1F355} pizza v${VERSION}`,
        `Model: ${model}`,
        `CWD: ${ctx.cwd}`,
      ];
      if (usage?.percent != null) {
        lines.push(`Context: ${usage.percent}%`);
      }
      if (ctx.hasUI) {
        ctx.ui.notify(lines.join("\n"), "info");
      } else {
        console.log(lines.join("\n"));
      }
    },
  });
}
