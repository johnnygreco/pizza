import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { VERSION } from "../config.js";

/**
 * Shipped extension: adds pizza identity to the UI status bar
 * and provides a /status command for version info.
 */
export default function status(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.hasUI) {
      ctx.ui.setStatus("pizza", `\u{1F355} v${VERSION}`);
    }
  });

  pi.registerCommand("status", {
    description: "Show pizza harness version and status",
    handler: async (_args, ctx) => {
      ctx.ui.notify(`\u{1F355} pizza v${VERSION}`, "info");
    },
  });
}
