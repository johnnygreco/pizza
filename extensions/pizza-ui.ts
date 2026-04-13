import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
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

const CRUST = fg(130);
const CHEESE_BG = bg(220);
const PEP = fg(196);
const PEPPER = fg(28);
const DRIP = fg(228);
const SAUCE = fg(160);
const PI_CLR = B + fg(40);
const ZZA_CLR = B + fg(220);
const TAG_CLR = fg(248);

// ── Pizza art colorizer ──────────────────────────────────────
// Maps art characters to pizza colors:
//   █▄▀ -> crust   ░ -> sauce-cheese (red fg + yellow bg)
//   ● -> pepperoni   ▬▮ -> green pepper   ╽┃│╷╵ -> drip
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

// ── Banner builder ───────────────────────────────────────────
// Widget limit is 10 lines, so the banner must fit in exactly 10.
function buildBanner(): string[] {
  // Top-down pizza pie (each line is 27 visible chars):
  //   crust ring (█▄▀), sauce-cheese (░), pepperoni (●), green pepper (▬▮)
  const pizza = [
    "        ▄████████████▄     ", //  0  crust top
    "       █░░░░●░░░░░●░░░█    ", //  1
    "      █░░●░░░░░▮░░░░●░░█   ", //  2  ─┐
    "     █░░░░▬░░░●░░░░░░░●░█  ", //  3   │
    "     █░░●░░░░▮░░░●░░▬░░░█  ", //  4   │ text
    "      █░░░░●░░░░░▬░░░●░█   ", //  5  ─┘
    "       █░░░▮░░░●░░░░░░█    ", //  6
    "        ▀████████████▀     ", //  7  crust bottom
    "          ╷   ┃╷   ╽       ", //  8  drips
    "              ╵            ", //  9
  ].map(colorizePizza);

  // "Pi" in bold TMNT-green block letters (5 lines x 10 cols)
  const piLines = [
    "██████  ██",
    "██   ██ ██",
    "██████  ██",
    "██      ██",
    "██      ██",
  ];

  // "zza" in bold gold block letters (5 lines x 23 cols)
  const zzaLines = [
    "███████ ███████  █████ ",
    "   ███     ███  ██   ██",
    "  ███     ███   ███████",
    " ███     ███    ██   ██",
    "███████ ███████ ██   ██",
  ];

  const GAP = "   ";
  const TEXT_ROW = 2; // text block starts at pizza row 2

  const lines: string[] = [];
  for (let i = 0; i < pizza.length; i++) {
    const ti = i - TEXT_ROW;
    if (ti >= 0 && ti < piLines.length) {
      lines.push(
        pizza[i] +
          GAP +
          PI_CLR +
          piLines[ti] +
          R +
          "  " +
          ZZA_CLR +
          zzaLines[ti] +
          R,
      );
    } else if (i === 7) {
      lines.push(
        pizza[i] + GAP + PI_CLR + "Pi " + R + TAG_CLR + "with toppings" + R,
      );
    } else {
      lines.push(pizza[i]);
    }
  }

  return lines;
}

// ── Extension entry point ────────────────────────────────────
export default function pizzaUiExtension(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    ctx.ui.setTitle(`pizza \u00B7 ${basename(ctx.cwd)}`);
    ctx.ui.setWidget("pizza.banner", buildBanner(), {
      placement: "aboveEditor",
    });
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
