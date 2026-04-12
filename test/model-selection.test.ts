import { describe, expect, it } from "vitest";
import { AuthStorage, ModelRegistry, SettingsManager } from "@mariozechner/pi-coding-agent";
import {
  buildSessionOptions,
  resolveCliModel,
  resolveModelScope,
} from "../src/model-selection.js";

describe("model selection", () => {
  it("resolves an explicit provider/model reference", () => {
    const registry = ModelRegistry.inMemory(AuthStorage.inMemory());
    const resolved = resolveCliModel({
      cliModel: "openai/gpt-4o",
      modelRegistry: registry,
    });

    expect(resolved.error).toBeUndefined();
    expect(resolved.model?.provider).toBe("openai");
    expect(resolved.model?.id).toBe("gpt-4o");
  });

  it("builds model scope from wildcard patterns", () => {
    const registry = ModelRegistry.inMemory(AuthStorage.inMemory());
    const scopedModels = resolveModelScope(["openai/*"], registry);

    expect(scopedModels.length).toBeGreaterThan(0);
    expect(scopedModels.every((entry) => entry.model.provider === "openai")).toBe(
      true,
    );
  });

  it("maps no-tools and explicit tools into session options", () => {
    const registry = ModelRegistry.inMemory(AuthStorage.inMemory());
    const settings = SettingsManager.inMemory();
    const result = buildSessionOptions(
      {
        messages: [],
        fileArgs: [],
        unknownFlags: new Map(),
        diagnostics: [],
        noTools: true,
        tools: ["read", "ls"],
      },
      [],
      false,
      registry,
      settings,
    );

    expect(result.options.tools).toHaveLength(2);
  });
});
