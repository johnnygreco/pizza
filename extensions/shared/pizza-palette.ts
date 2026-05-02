/**
 * Pizza palette loader.
 *
 * The JSON theme file is the single source of truth for every color Pizza
 * prints. Pi's own color keys live in the `colors` section (52 tokens the Pi
 * runtime renders); Pizza's chrome (banner art, PIZZA letters, status meter,
 * editor borders) is carried in the same file as `pizza.*` entries inside
 * `vars`. Pi tolerates them because it never resolves unused vars, and Pizza
 * parses the file at runtime to materialize its palette.
 *
 * Flipping the active Pi theme flips Pizza too: one JSON per look, one switch.
 * This module owns the palette side of that story; the Pi side is driven by
 * `ctx.ui.setTheme()`, and `syncActivePalette()` mirrors it back into Pizza.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ── Raw ANSI helpers (not themed) ───────────────────────────
export const ANSI_RESET = "\x1b[0m";
export const ANSI_BOLD = "\x1b[1m";
export const ANSI_BG_OFF = "\x1b[49m";

export const fg256 = (n: number): string => `\x1b[38;5;${n}m`;
export const bg256 = (n: number): string => `\x1b[48;5;${n}m`;
export const fgRgb = (r: number, g: number, b: number): string =>
  `\x1b[38;2;${r};${g};${b}m`;

// ── Theme interface ─────────────────────────────────────────
export interface PizzaTheme {
  name: string;

  // Pizza art (banner)
  crust: string;
  cheese: string;
  cheeseBg: string;
  pepperoni: string;
  pepper: string;
  sauce: string;
  drip: string;

  // PIZZA word art letters
  letterP: string;
  letterI: string;
  letterZ1: string;
  letterZ2: string;
  letterA: string;

  // Banner / help chrome
  border: string;
  tagPi: string;
  tagText: string;
  key: string;
  desc: string;
  divider: string;
  section: string;

  // Status bar
  meterLow: string;
  meterMid: string;
  meterHigh: string;
  marquee: string;
  dim: string;

  // Editor
  bashBorder: string;
  normalBorder: string;
}

type TokenKey = Exclude<keyof PizzaTheme, "name">;

// Tokens rendered bold. Purely a styling choice, independent of the theme.
const BOLD_TOKENS: ReadonlySet<TokenKey> = new Set<TokenKey>([
  "letterP",
  "letterI",
  "letterZ1",
  "letterZ2",
  "letterA",
  "border",
  "tagPi",
  "key",
  "section",
]);

// Tokens that emit a background escape instead of a foreground one.
const BG_TOKENS: ReadonlySet<TokenKey> = new Set<TokenKey>(["cheeseBg"]);

// When a theme JSON has no `pizza.<token>` var, derive the color from one of
// Pi's own `colors.*` entries so Pizza still renders sensibly on themes that
// don't know about it (pi's built-in `dark` / `light`, user custom themes).
const FALLBACK_FROM_PI_COLOR: Record<TokenKey, string> = {
  crust: "border",
  cheese: "toolTitle",
  cheeseBg: "selectedBg",
  pepperoni: "error",
  pepper: "success",
  sauce: "borderMuted",
  drip: "toolTitle",

  letterP: "accent",
  letterI: "accent",
  letterZ1: "accent",
  letterZ2: "accent",
  letterA: "muted",

  border: "border",
  tagPi: "accent",
  tagText: "muted",
  key: "warning",
  desc: "text",
  divider: "borderMuted",
  section: "accent",

  meterLow: "success",
  meterMid: "warning",
  meterHigh: "error",
  marquee: "accent",
  dim: "dim",

  bashBorder: "bashMode",
  normalBorder: "dim",
};

const TOKEN_KEYS: readonly TokenKey[] = Object.keys(FALLBACK_FROM_PI_COLOR) as TokenKey[];

// ── Color mode ──────────────────────────────────────────────
type ColorMode = "truecolor" | "ansi256";

function detectColorMode(): ColorMode {
  const env = process.env.COLORTERM?.toLowerCase() ?? "";
  if (env.includes("truecolor") || env.includes("24bit")) return "truecolor";
  return "ansi256";
}

// ── Hex / var resolution (mirrors pi's resolver) ────────────
type Primitive = string | number;

function resolveVarRefs(
  value: Primitive,
  vars: Record<string, Primitive>,
  visited = new Set<string>(),
): Primitive {
  if (typeof value === "number") return value;
  if (value === "" || value.startsWith("#")) return value;
  if (visited.has(value)) return ""; // circular — fall back to default
  if (!(value in vars)) return "";
  visited.add(value);
  return resolveVarRefs(vars[value], vars, visited);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function hexTo256(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  // 6x6x6 color cube (indexes 16..231)
  const q = (c: number) =>
    c < 48 ? 0 : c < 115 ? 1 : Math.floor((c - 35) / 40);
  return 16 + 36 * q(r) + 6 * q(g) + q(b);
}

function fgAnsi(color: Primitive, mode: ColorMode): string {
  if (color === "") return "\x1b[39m";
  if (typeof color === "number") return `\x1b[38;5;${color}m`;
  if (color.startsWith("#")) {
    if (mode === "truecolor") {
      const { r, g, b } = hexToRgb(color);
      return `\x1b[38;2;${r};${g};${b}m`;
    }
    return `\x1b[38;5;${hexTo256(color)}m`;
  }
  return "\x1b[39m";
}

function bgAnsi(color: Primitive, mode: ColorMode): string {
  if (color === "") return "\x1b[49m";
  if (typeof color === "number") return `\x1b[48;5;${color}m`;
  if (color.startsWith("#")) {
    if (mode === "truecolor") {
      const { r, g, b } = hexToRgb(color);
      return `\x1b[48;2;${r};${g};${b}m`;
    }
    return `\x1b[48;5;${hexTo256(color)}m`;
  }
  return "\x1b[49m";
}

// ── JSON → PizzaTheme ───────────────────────────────────────
interface ThemeJson {
  name: string;
  vars?: Record<string, Primitive>;
  colors?: Record<string, Primitive>;
}

export function buildPizzaTheme(json: ThemeJson, mode: ColorMode = detectColorMode()): PizzaTheme {
  const vars = json.vars ?? {};
  const colors = json.colors ?? {};
  const name = json.name;

  const theme: Partial<PizzaTheme> = { name };

  for (const key of TOKEN_KEYS) {
    const varName = `pizza.${key}`;
    let leaf: Primitive;

    if (varName in vars) {
      leaf = resolveVarRefs(vars[varName], vars);
    } else {
      const piColorKey = FALLBACK_FROM_PI_COLOR[key];
      const piValue = colors[piColorKey];
      leaf = piValue != null ? resolveVarRefs(piValue, vars) : "";
    }

    const ansi = BG_TOKENS.has(key) ? bgAnsi(leaf, mode) : fgAnsi(leaf, mode);
    const bold = BOLD_TOKENS.has(key) ? ANSI_BOLD : "";
    theme[key] = bold + ansi;
  }

  return theme as PizzaTheme;
}

export function loadPizzaThemeFromPath(jsonPath: string, mode?: ColorMode): PizzaTheme {
  const raw = readFileSync(jsonPath, "utf-8");
  const json = JSON.parse(raw) as ThemeJson;
  return buildPizzaTheme(json, mode ?? detectColorMode());
}

// ── Bundled themes ──────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLED_DIR = join(__dirname, "themes");

export const DEFAULT_PIZZA_THEME = "pizzeria";

function discoverBundledNames(): string[] {
  try {
    return readdirSync(BUNDLED_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -".json".length));
  } catch {
    return [DEFAULT_PIZZA_THEME];
  }
}

interface Registration {
  path: string;
  theme: PizzaTheme;
}

// Pi loads each extension (pizza-ui, pizza-status, pizza-editor) through its
// own jiti instance with `moduleCache: false`, so each extension would
// otherwise get its own private copy of this module's state. That would
// silently desync the active theme and theme-change listeners across
// extensions (e.g. pizza-ui flips the theme, but pizza-status never hears
// about it because its listener set lives in a different module copy).
//
// Hanging the mutable state off globalThis keeps all copies pointing at the
// same registry, active name, and listener set. Pure helpers and constants
// can stay module-local — only mutable state needs to cross the boundary.
interface PizzaThemeSharedState {
  registry: Map<string, Registration>;
  activeName: string;
  listeners: Set<() => void>;
}

const GLOBAL_KEY = "__pizzaThemeSharedState__";

const sharedState: PizzaThemeSharedState =
  ((globalThis as any)[GLOBAL_KEY] as PizzaThemeSharedState | undefined) ??
  ((globalThis as any)[GLOBAL_KEY] = {
    registry: new Map<string, Registration>(),
    activeName: DEFAULT_PIZZA_THEME,
    listeners: new Set<() => void>(),
  });

function registerBundled(): void {
  // Pi loads each extension through its own jiti instance, so this module is
  // imported multiple times per startup. Skip re-scanning once the shared
  // registry has been populated by an earlier copy.
  if (sharedState.registry.size > 0) return;
  for (const n of discoverBundledNames()) {
    const path = join(BUNDLED_DIR, `${n}.json`);
    try {
      sharedState.registry.set(n, { path, theme: loadPizzaThemeFromPath(path) });
    } catch {
      // Swallow — tests or dev environments may not have files on disk.
    }
  }
}
registerBundled();

/**
 * Register a theme file at an arbitrary path. Called from `syncActivePalette`
 * so Pizza can follow every theme Pi knows about — bundled, user, or custom —
 * whenever `/theme` (or Ctrl+Q) flips Pi.
 */
export function registerPizzaThemePath(name: string, path: string): PizzaTheme | null {
  try {
    const theme = loadPizzaThemeFromPath(path);
    sharedState.registry.set(name, { path, theme });
    return theme;
  } catch {
    return null;
  }
}

export function listPizzaThemes(): string[] {
  return Array.from(sharedState.registry.keys()).sort();
}

export function hasPizzaTheme(name: string): boolean {
  return sharedState.registry.has(name);
}

/**
 * Subscribe to active-theme changes. Fires only when `setActivePizzaTheme`
 * actually swaps names (not on no-op calls). Returns an unsubscribe function.
 *
 * Extensions that bake theme colors into cached output (e.g. the status line
 * string handed to `ctx.ui.setStatus`) need this to know when to rebuild.
 * Extensions that look up `getPizzaTheme()` at render time don't.
 */
export function onPizzaThemeChange(fn: () => void): () => void {
  sharedState.listeners.add(fn);
  return () => {
    sharedState.listeners.delete(fn);
  };
}

export function getPizzaTheme(name?: string): PizzaTheme {
  const key = name ?? sharedState.activeName;
  return (
    sharedState.registry.get(key)?.theme ??
    sharedState.registry.get(DEFAULT_PIZZA_THEME)!.theme
  );
}

export function getActivePizzaThemeName(): string {
  return sharedState.activeName;
}

/**
 * Switch the active Pizza theme. If the name isn't registered, the call is a
 * no-op and the current active name is returned (prevents surprise fallback
 * while the matching Pi theme is still loading).
 */
export function setActivePizzaTheme(name: string): string {
  if (sharedState.registry.has(name) && name !== sharedState.activeName) {
    sharedState.activeName = name;
    for (const fn of sharedState.listeners) fn();
  }
  return sharedState.activeName;
}

/**
 * Re-parse the JSON for the named theme. Call after a file edit so the next
 * render reflects the change without restarting.
 */
export function reloadPizzaTheme(name: string): PizzaTheme | null {
  const entry = sharedState.registry.get(name);
  if (!entry) return null;
  try {
    const theme = loadPizzaThemeFromPath(entry.path);
    sharedState.registry.set(name, { path: entry.path, theme });
    return theme;
  } catch {
    return null;
  }
}

export function paint(token: string, text: string): string {
  return `${token}${text}${ANSI_RESET}`;
}

interface PaletteSyncContext {
  hasUI?: boolean;
  ui?: {
    theme?: { name?: string };
    getAllThemes?: () => Array<{ name: string; path?: string }>;
  };
}

/**
 * Mirror Pi's active theme into Pizza. Returns true iff the active palette
 * actually changed, so callers can short-circuit cache invalidation.
 */
export function syncActivePalette(ctx: PaletteSyncContext): boolean {
  const piThemeName = ctx?.ui?.theme?.name;

  const allThemes = ctx?.ui?.getAllThemes?.() ?? [];
  for (const { name, path } of allThemes) {
    if (path && !hasPizzaTheme(name)) {
      registerPizzaThemePath(name, path);
    }
  }

  const target =
    piThemeName && hasPizzaTheme(piThemeName) ? piThemeName : DEFAULT_PIZZA_THEME;
  if (target === getActivePizzaThemeName()) return false;
  setActivePizzaTheme(target);
  return true;
}
