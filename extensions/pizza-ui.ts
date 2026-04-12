import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "..", "package.json"), "utf-8"),
);

const VERSION: string = pkg.version;

export default function pizzaUiExtension(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) {
      return;
    }

    const repo = basename(ctx.cwd);
    ctx.ui.setTitle(`pizza \u00B7 ${repo}`);
    ctx.ui.setStatus("pizza", `\u{1F355} pizza v${VERSION}`);
    ctx.ui.setWidget(
      "pizza.banner",
      [`\u{1F355} pizza v${VERSION}`, "Pi with toppings"],
      { placement: "aboveEditor" },
    );
  });

  pi.on("turn_start", async (_event, ctx) => {
    if (!ctx.hasUI) {
      return;
    }

    const model = ctx.model?.name ?? ctx.model?.id;
    const parts = [`\u{1F355} v${VERSION}`];
    if (model) {
      parts.push(model);
    }
    parts.push("...");
    ctx.ui.setStatus("pizza", parts.join(" \u00B7 "));
  });

  pi.on("model_select", async (event, ctx) => {
    if (!ctx.hasUI) {
      return;
    }

    const model = event.model?.name ?? event.model?.id;
    const parts = [`\u{1F355} v${VERSION}`];
    if (model) {
      parts.push(model);
    }
    ctx.ui.setStatus("pizza", parts.join(" \u00B7 "));
  });

  pi.on("turn_end", async (_event, ctx) => {
    if (!ctx.hasUI) {
      return;
    }

    const model = ctx.model?.name ?? ctx.model?.id;
    const usage = ctx.getContextUsage();
    const parts = [`\u{1F355} v${VERSION}`];
    if (model) {
      parts.push(model);
    }
    if (usage?.percent != null) {
      parts.push(`ctx ${usage.percent}%`);
    }
    ctx.ui.setStatus("pizza", parts.join(" \u00B7 "));
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
