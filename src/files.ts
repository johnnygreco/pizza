import { access, readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import type { Args } from "./args.js";
import { expandHome } from "./config.js";

type InlineImage = {
  type: "image";
  mimeType: string;
  data: string;
};

const IMAGE_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};

export function resolveCliPath(cwd: string, value: string): string {
  return resolve(cwd, expandHome(value));
}

export async function readPipedStdin(): Promise<string | undefined> {
  if (process.stdin.isTTY) {
    return undefined;
  }

  return new Promise((resolveInput) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      resolveInput(data.trim() || undefined);
    });
    process.stdin.resume();
  });
}

export async function processFileArguments(
  fileArgs: string[],
  cwd = process.cwd(),
): Promise<{ text: string; images: InlineImage[] }> {
  let text = "";
  const images: InlineImage[] = [];

  for (const fileArg of fileArgs) {
    const absolutePath = resolveCliPath(cwd, fileArg);
    await access(absolutePath);

    const stats = await stat(absolutePath);
    if (stats.size === 0) {
      continue;
    }

    const mimeType = IMAGE_MIME_TYPES[extname(absolutePath).toLowerCase()];
    if (mimeType) {
      const content = await readFile(absolutePath);
      images.push({
        type: "image",
        mimeType,
        data: content.toString("base64"),
      });
      text += `<file name="${absolutePath}"></file>\n`;
      continue;
    }

    const content = await readFile(absolutePath, "utf-8");
    text += `<file name="${absolutePath}">\n${content}\n</file>\n`;
  }

  return { text, images };
}

export async function prepareInitialMessage(args: Args, cwd = process.cwd(), stdinContent?: string): Promise<{
  initialMessage: string | undefined;
  initialImages: InlineImage[] | undefined;
  remainingMessages: string[];
}> {
  const parts: string[] = [];
  let fileText = "";
  let fileImages: InlineImage[] = [];

  if (args.fileArgs.length > 0) {
    const processed = await processFileArguments(args.fileArgs, cwd);
    fileText = processed.text;
    fileImages = processed.images;
  }

  if (stdinContent !== undefined) {
    parts.push(stdinContent);
  }

  if (fileText) {
    parts.push(fileText);
  }

  let remainingMessages = args.messages;
  if (args.messages.length > 0) {
    const [first, ...rest] = args.messages;
    parts.push(first);
    remainingMessages = rest;
  }

  return {
    initialMessage: parts.length > 0 ? parts.join("") : undefined,
    initialImages: fileImages.length > 0 ? fileImages : undefined,
    remainingMessages,
  };
}
