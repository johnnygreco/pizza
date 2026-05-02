// Adapted from disler/pi-vs-claude-code's theme-cycler.ts.

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth } from "@mariozechner/pi-tui";
import { syncActivePalette } from "./shared/pizza-palette.ts";

const STATUS_KEY = "pizza.theme";
const SWATCH_KEY = "pizza.theme.swatch";
const SWATCH_TTL_MS = 3000;
const CYCLE_THEME_SHORTCUT = "ctrl+q";

function currentThemeName(ctx: ExtensionContext): string {
  return ctx.ui.theme.name!;
}

function updateStatus(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  ctx.ui.setStatus(STATUS_KEY, `\u{1F3A8} ${currentThemeName(ctx)}`);
}

export default function pizzaThemeExtension(pi: ExtensionAPI): void {
  let swatchTimer: ReturnType<typeof setTimeout> | null = null;

  function showSwatch(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;

    if (swatchTimer) {
      clearTimeout(swatchTimer);
      swatchTimer = null;
    }

    ctx.ui.setWidget(
      SWATCH_KEY,
      (_tui, theme) => ({
        invalidate() {},
        render(width: number): string[] {
          const block = "\u2588\u2588\u2588";
          const swatch =
            theme.fg("success", block) +
            " " +
            theme.fg("accent", block) +
            " " +
            theme.fg("warning", block) +
            " " +
            theme.fg("error", block) +
            " " +
            theme.fg("muted", block);
          const label =
            theme.fg("accent", " \u{1F3A8} ") +
            theme.fg("text", currentThemeName(ctx)) +
            "  " +
            swatch;
          const border = theme.fg("borderMuted", "\u2500".repeat(Math.max(0, width)));
          return [border, truncateToWidth("  " + label, width), border];
        },
      }),
      { placement: "belowEditor" },
    );

    swatchTimer = setTimeout(() => {
      ctx.ui.setWidget(SWATCH_KEY, undefined);
      swatchTimer = null;
    }, SWATCH_TTL_MS);
  }

  function applyAndAnnounce(
    ctx: ExtensionContext,
    name: string,
    successLabel: string,
  ): void {
    const result = ctx.ui.setTheme(name);
    if (!result.success) {
      ctx.ui.notify(`Failed to set theme: ${result.error ?? "unknown"}`, "error");
      return;
    }
    syncActivePalette(ctx);
    updateStatus(ctx);
    showSwatch(ctx);
    ctx.ui.notify(successLabel, "info");
  }

  function cycleTheme(ctx: ExtensionContext, direction: 1 | -1): void {
    if (!ctx.hasUI) return;

    const themes = ctx.ui.getAllThemes();
    if (themes.length === 0) {
      ctx.ui.notify("No themes available", "warning");
      return;
    }

    const current = currentThemeName(ctx);
    const currentIdx = themes.findIndex((t) => t.name === current);
    const from = currentIdx === -1 ? 0 : currentIdx;
    const index = (from + direction + themes.length) % themes.length;
    const target = themes[index];
    applyAndAnnounce(ctx, target.name, `${target.name} (${index + 1}/${themes.length})`);
  }

  pi.registerShortcut(CYCLE_THEME_SHORTCUT, {
    description: "Cycle theme",
    handler: async (ctx) => cycleTheme(ctx, 1),
  });

  pi.registerCommand("theme", {
    description: "Pick a theme, or /theme <name|next|prev> to switch directly",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) return;

      const arg = (args ?? "").trim();
      const themes = ctx.ui.getAllThemes();

      if (arg) {
        const match = themes.find((t) => t.name === arg);
        if (match) {
          applyAndAnnounce(ctx, match.name, `Theme: ${match.name}`);
          return;
        }
        if (arg === "next") {
          cycleTheme(ctx, 1);
          return;
        }
        if (arg === "prev") {
          cycleTheme(ctx, -1);
          return;
        }
        ctx.ui.notify(
          `Unknown theme: ${arg}. Use /theme, /theme next, /theme prev, or one of: ${themes.map((t) => t.name).join(", ")}`,
          "warning",
        );
        return;
      }

      const active = currentThemeName(ctx);
      const items = themes.map((t) => `${t.name}${t.name === active ? " (active)" : ""}`);

      const picked = await ctx.ui.select(
        `\u{1F3A8} Pick a theme (current: ${active})`,
        items,
      );
      if (picked === undefined) return;

      const name = picked.split(/\s/)[0];
      applyAndAnnounce(ctx, name, `Theme: ${name}`);
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    syncActivePalette(ctx);
    updateStatus(ctx);
  });

  pi.on("session_shutdown", async () => {
    if (swatchTimer) {
      clearTimeout(swatchTimer);
      swatchTimer = null;
    }
  });
}
