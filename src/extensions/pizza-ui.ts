import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { APP_NAME, VERSION } from "../config.js";

const BANNER = `\u{1F355} ${APP_NAME} v${VERSION}`;

export default function pizzaUiExtension(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) {
      return;
    }

    ctx.ui.setTitle(APP_NAME);
    ctx.ui.setStatus(APP_NAME, BANNER);
    ctx.ui.setWidget(
      "pizza.banner",
      [BANNER, "Pi with toppings"],
      { placement: "aboveEditor" },
    );
  });

  pi.registerCommand("pizza", {
    description: "Show Pizza runtime information",
    handler: async (_args, ctx) => {
      if (ctx.hasUI) {
        ctx.ui.notify(BANNER, "info");
      }
    },
  });

  pi.registerCommand("status", {
    description: "Show Pizza version and status",
    handler: async (_args, ctx) => {
      if (ctx.hasUI) {
        ctx.ui.notify(BANNER, "info");
      }
    },
  });
}
