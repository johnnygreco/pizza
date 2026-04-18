import { createJiti } from "@mariozechner/jiti";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANSI_BOLD,
  DEFAULT_PIZZA_THEME,
  buildPizzaTheme,
  getActivePizzaThemeName,
  getPizzaTheme,
  hasPizzaTheme,
  listPizzaThemes,
  onPizzaThemeChange,
  registerPizzaThemePath,
  setActivePizzaTheme,
} from "../../extensions/shared/pizza-theme.ts";

describe("pizza-theme registry", () => {
  beforeEach(() => {
    setActivePizzaTheme(DEFAULT_PIZZA_THEME);
  });

  afterEach(() => {
    setActivePizzaTheme(DEFAULT_PIZZA_THEME);
  });

  it("ships retro-pizzeria as the default theme", () => {
    expect(DEFAULT_PIZZA_THEME).toBe("retro-pizzeria");
    expect(listPizzaThemes()).toContain("retro-pizzeria");
  });

  it("ships cyberpunk-pizzeria as a second theme", () => {
    expect(listPizzaThemes()).toContain("cyberpunk-pizzeria");
  });

  it("returns the active theme when name is omitted", () => {
    expect(getPizzaTheme().name).toBe("retro-pizzeria");
    expect(getActivePizzaThemeName()).toBe("retro-pizzeria");
  });

  it("falls back to the default for unregistered getPizzaTheme lookups", () => {
    expect(getPizzaTheme("does-not-exist").name).toBe("retro-pizzeria");
  });

  it("setActivePizzaTheme is a no-op when the name isn't registered", () => {
    expect(setActivePizzaTheme("does-not-exist")).toBe("retro-pizzeria");
    expect(getActivePizzaThemeName()).toBe("retro-pizzeria");
  });

  it("activates cyberpunk-pizzeria when requested", () => {
    expect(setActivePizzaTheme("cyberpunk-pizzeria")).toBe("cyberpunk-pizzeria");
    expect(getPizzaTheme().name).toBe("cyberpunk-pizzeria");
  });

  it("every PizzaTheme slot is populated for both bundled themes", () => {
    for (const name of ["retro-pizzeria", "cyberpunk-pizzeria"]) {
      const theme = getPizzaTheme(name);
      for (const [key, value] of Object.entries(theme)) {
        expect(value, `${name}.${key} must be populated`).toBeTruthy();
      }
    }
  });

  it("hasPizzaTheme reflects the registry", () => {
    expect(hasPizzaTheme("retro-pizzeria")).toBe(true);
    expect(hasPizzaTheme("does-not-exist")).toBe(false);
  });
});

describe("buildPizzaTheme", () => {
  it("applies bold to letter/border/tag/key/section tokens", () => {
    const theme = buildPizzaTheme(
      {
        name: "t",
        vars: {
          "pizza.letterP": "#ff0000",
          "pizza.border": "#ff0000",
          "pizza.tagPi": "#ff0000",
          "pizza.key": "#ff0000",
          "pizza.section": "#ff0000",
          "pizza.tagText": "#ff0000",
          "pizza.desc": "#ff0000",
        },
        colors: {},
      },
      "ansi256",
    );
    expect(theme.letterP.startsWith(ANSI_BOLD)).toBe(true);
    expect(theme.border.startsWith(ANSI_BOLD)).toBe(true);
    expect(theme.tagPi.startsWith(ANSI_BOLD)).toBe(true);
    expect(theme.key.startsWith(ANSI_BOLD)).toBe(true);
    expect(theme.section.startsWith(ANSI_BOLD)).toBe(true);
    // Non-bold tokens don't get the bold prefix
    expect(theme.tagText.startsWith(ANSI_BOLD)).toBe(false);
    expect(theme.desc.startsWith(ANSI_BOLD)).toBe(false);
  });

  it("emits background escape for cheeseBg, foreground for others", () => {
    const theme = buildPizzaTheme(
      {
        name: "t",
        vars: {
          "pizza.cheeseBg": "#ff0000",
          "pizza.cheese": "#ff0000",
        },
        colors: {},
      },
      "truecolor",
    );
    expect(theme.cheeseBg).toContain("\x1b[48;2;255;0;0m");
    expect(theme.cheese).toContain("\x1b[38;2;255;0;0m");
  });

  it("resolves variable references (pizza.X → name → hex)", () => {
    const theme = buildPizzaTheme(
      {
        name: "t",
        vars: {
          coral: "#ff7f50",
          "pizza.crust": "coral",
        },
        colors: {},
      },
      "truecolor",
    );
    expect(theme.crust).toContain("\x1b[38;2;255;127;80m");
  });

  it("resolves 256-palette integer values verbatim", () => {
    const theme = buildPizzaTheme(
      {
        name: "t",
        vars: { "pizza.crust": 209 },
        colors: {},
      },
      "truecolor",
    );
    expect(theme.crust).toContain("\x1b[38;5;209m");
  });

  it("falls back to pi's color key when pizza.* var is missing", () => {
    const theme = buildPizzaTheme(
      {
        name: "t",
        vars: {},
        colors: {
          accent: "#abcdef",
          border: "#123456",
          error: "#ff0000",
          success: "#00ff00",
        },
      },
      "truecolor",
    );
    // letterP falls back to pi's `accent`
    expect(theme.letterP).toContain("\x1b[38;2;171;205;239m");
    // border falls back to pi's `border`
    expect(theme.border).toContain("\x1b[38;2;18;52;86m");
    // meterHigh falls back to pi's `error`
    expect(theme.meterHigh).toContain("\x1b[38;2;255;0;0m");
  });

  it("uses hex-to-256 approximation in ansi256 mode", () => {
    const theme = buildPizzaTheme(
      { name: "t", vars: { "pizza.crust": "#ff0000" }, colors: {} },
      "ansi256",
    );
    expect(theme.crust).toMatch(/\x1b\[38;5;\d+m/);
    expect(theme.crust).not.toContain("\x1b[38;2;");
  });

  it("tolerates circular var references by emitting default fg", () => {
    const theme = buildPizzaTheme(
      {
        name: "t",
        vars: { a: "b", b: "a", "pizza.crust": "a" },
        colors: {},
      },
      "truecolor",
    );
    expect(theme.crust).toContain("\x1b[39m");
  });
});

describe("onPizzaThemeChange", () => {
  beforeEach(() => {
    setActivePizzaTheme(DEFAULT_PIZZA_THEME);
  });

  afterEach(() => {
    setActivePizzaTheme(DEFAULT_PIZZA_THEME);
  });

  it("fires subscribers when the active theme actually changes", () => {
    const listener = vi.fn();
    const unsubscribe = onPizzaThemeChange(listener);

    setActivePizzaTheme("cyberpunk-pizzeria");
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it("does not fire subscribers for no-op calls", () => {
    const listener = vi.fn();
    const unsubscribe = onPizzaThemeChange(listener);

    setActivePizzaTheme(DEFAULT_PIZZA_THEME); // same name
    setActivePizzaTheme("does-not-exist"); // unregistered
    expect(listener).not.toHaveBeenCalled();

    unsubscribe();
  });

  it("stops firing after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = onPizzaThemeChange(listener);
    unsubscribe();

    setActivePizzaTheme("cyberpunk-pizzeria");
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("shared state across module instances", () => {
  // Pi loads each extension through its own `jiti` instance with
  // `moduleCache: false`, so module-local state (registry, active theme,
  // listeners) is not shared between extensions unless we explicitly route it
  // through `globalThis`. This test simulates that by loading pizza-theme
  // twice with no caching and verifying the two copies share state.

  const modulePath = resolve(
    fileURLToPath(new URL(".", import.meta.url)),
    "../../extensions/shared/pizza-theme.ts",
  );

  async function freshLoad(): Promise<
    typeof import("../../extensions/shared/pizza-theme.ts")
  > {
    const jiti = createJiti(import.meta.url, { moduleCache: false });
    return await jiti.import(modulePath);
  }

  beforeEach(() => {
    setActivePizzaTheme(DEFAULT_PIZZA_THEME);
  });

  afterEach(() => {
    setActivePizzaTheme(DEFAULT_PIZZA_THEME);
  });

  it("two uncached loads see the same active theme and notify each other's listeners", async () => {
    const modA = await freshLoad();
    const modB = await freshLoad();

    // Same starting point.
    expect(modA.getActivePizzaThemeName()).toBe(modB.getActivePizzaThemeName());

    const bListener = vi.fn();
    const unsubscribe = modB.onPizzaThemeChange(bListener);

    modA.setActivePizzaTheme("cyberpunk-pizzeria");

    // Subscriber in module B fires when module A flips the theme.
    expect(bListener).toHaveBeenCalledTimes(1);
    // Both modules observe the new active theme.
    expect(modA.getActivePizzaThemeName()).toBe("cyberpunk-pizzeria");
    expect(modB.getActivePizzaThemeName()).toBe("cyberpunk-pizzeria");
    // And both resolve the same palette for the active theme.
    expect(modA.getPizzaTheme().crust).toBe(modB.getPizzaTheme().crust);

    unsubscribe();
    modA.setActivePizzaTheme(DEFAULT_PIZZA_THEME);
  });
});

describe("registerPizzaThemePath", () => {
  it("returns null for missing files and leaves the registry unchanged", () => {
    const before = listPizzaThemes();
    const result = registerPizzaThemePath("nope", "/tmp/does-not-exist.json");
    expect(result).toBe(null);
    expect(listPizzaThemes()).toEqual(before);
  });
});
