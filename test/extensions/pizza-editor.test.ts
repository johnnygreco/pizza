import { describe, expect, it } from "vitest";
import { isBashInput } from "../../extensions/pizza-editor.ts";

describe("pizza-editor", () => {
  it("detects bash mode from a leading bang after whitespace", () => {
    expect(isBashInput("!ls -la")).toBe(true);
    expect(isBashInput("   !pwd")).toBe(true);
    expect(isBashInput("say hi")).toBe(false);
  });
});
