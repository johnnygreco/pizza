import {
  type ExtensionAPI,
  type KeybindingsManager,
  CustomEditor,
} from "@mariozechner/pi-coding-agent";
import type { EditorTheme, TUI } from "@mariozechner/pi-tui";

const R = "\x1b[0m";
const PIZZA_ORANGE = "\x1b[38;5;209m";

export function isBashInput(text: string): boolean {
  return text.trimStart().startsWith("!");
}

function pizzaOrange(text: string): string {
  return `${PIZZA_ORANGE}${text}${R}`;
}

class PizzaEditor extends CustomEditor {
  private readonly normalBorderColor: (text: string) => string;
  private readonly bashBorderColor: (text: string) => string;

  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    colors: {
      normalBorderColor: (text: string) => string;
      bashBorderColor: (text: string) => string;
    },
  ) {
    super(tui, theme, keybindings);
    this.normalBorderColor = colors.normalBorderColor;
    this.bashBorderColor = colors.bashBorderColor;
  }

  override render(width: number): string[] {
    const bashMode = isBashInput(this.getText());
    const previousBorderColor = this.borderColor;
    this.borderColor = bashMode ? this.bashBorderColor : this.normalBorderColor;
    const rendered = super.render(width);
    this.borderColor = previousBorderColor;
    return rendered;
  }
}

export default function pizzaEditorExtension(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      const editorTheme: EditorTheme = {
        ...theme,
        borderColor: (text) => ctx.ui.theme.fg("dim", text),
      };
      return new PizzaEditor(tui, editorTheme, keybindings, {
        normalBorderColor: (text) => ctx.ui.theme.fg("dim", text),
        bashBorderColor: pizzaOrange,
      });
    });
  });
}
