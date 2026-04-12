import type { ModelRegistry, SettingsManager } from "@mariozechner/pi-coding-agent";
import type { Args, BuiltInToolName, ThinkingLevel } from "./args.js";
import { BUILT_IN_TOOLS, isValidThinkingLevel } from "./args.js";
import type { Diagnostic } from "./diagnostics.js";

export type RuntimeModel = ReturnType<ModelRegistry["getAll"]>[number];

export type ScopedModel = {
  model: RuntimeModel;
  thinkingLevel?: ThinkingLevel;
};

export type SessionOptions = {
  model?: RuntimeModel;
  thinkingLevel?: ThinkingLevel;
  scopedModels?: ScopedModel[];
  tools?: Array<(typeof BUILT_IN_TOOLS)[BuiltInToolName]>;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wildcardToRegExp(pattern: string): RegExp {
  return new RegExp(
    "^" + pattern.split("*").map(escapeRegExp).join(".*") + "$",
    "i",
  );
}

function parseThinkingSuffix(raw: string): {
  pattern: string;
  thinkingLevel?: ThinkingLevel;
} {
  const separator = raw.lastIndexOf(":");
  if (separator === -1) {
    return { pattern: raw };
  }

  const maybeThinking = raw.slice(separator + 1);
  if (!isValidThinkingLevel(maybeThinking)) {
    return { pattern: raw };
  }

  return {
    pattern: raw.slice(0, separator),
    thinkingLevel: maybeThinking,
  };
}

function parseModelPattern(raw: string): {
  provider?: string;
  pattern: string;
  thinkingLevel?: ThinkingLevel;
} {
  const { pattern, thinkingLevel } = parseThinkingSuffix(raw);
  const slashIndex = pattern.indexOf("/");
  if (slashIndex === -1) {
    return { pattern, thinkingLevel };
  }

  return {
    provider: pattern.slice(0, slashIndex),
    pattern: pattern.slice(slashIndex + 1),
    thinkingLevel,
  };
}

function scoreModelMatch(model: RuntimeModel, pattern: string): number {
  const haystacks = [
    model.id,
    `${model.provider}/${model.id}`,
    model.name,
  ].filter((value): value is string => Boolean(value));
  const lowerPattern = pattern.toLowerCase();

  for (const haystack of haystacks) {
    const lowerHaystack = haystack.toLowerCase();
    if (lowerHaystack === lowerPattern) {
      return 100;
    }
  }

  if (pattern.includes("*")) {
    const matcher = wildcardToRegExp(pattern);
    return haystacks.some((haystack) => matcher.test(haystack)) ? 80 : -1;
  }

  for (const haystack of haystacks) {
    const lowerHaystack = haystack.toLowerCase();
    if (lowerHaystack.startsWith(lowerPattern)) {
      return 60;
    }
    if (lowerHaystack.includes(lowerPattern)) {
      return 40;
    }
  }

  return -1;
}

function describeModel(model: RuntimeModel): string {
  return `${model.provider}/${model.id}`;
}

function findMatchingModels(
  allModels: RuntimeModel[],
  rawPattern: string,
  cliProvider?: string,
): {
  matches: ScopedModel[];
  error?: string;
} {
  const parsed = parseModelPattern(rawPattern);
  if (cliProvider && parsed.provider && cliProvider !== parsed.provider) {
    return {
      matches: [],
      error: `Conflicting model providers: --provider ${cliProvider} does not match ${parsed.provider}/${parsed.pattern}`,
    };
  }

  const provider = parsed.provider ?? cliProvider;
  const models = allModels
    .filter((model) => (provider ? model.provider === provider : true))
    .map((model) => ({
      model,
      score: scoreModelMatch(model, parsed.pattern),
    }))
    .filter((match) => match.score >= 0)
    .sort((left, right) => right.score - left.score);

  if (models.length === 0) {
    return {
      matches: [],
      error: provider
        ? `No model matched "${parsed.pattern}" for provider "${provider}"`
        : `No model matched "${rawPattern}"`,
    };
  }

  const highestScore = models[0].score;
  const topMatches = models.filter((match) => match.score === highestScore);
  return {
    matches: topMatches.map((match) => ({
      model: match.model,
      thinkingLevel: parsed.thinkingLevel,
    })),
  };
}

export function resolveCliModel(options: {
  cliProvider?: string;
  cliModel: string;
  modelRegistry: ModelRegistry;
}): {
  model?: RuntimeModel;
  thinkingLevel?: ThinkingLevel;
  warning?: string;
  error?: string;
} {
  const { matches, error } = findMatchingModels(
    options.modelRegistry.getAll(),
    options.cliModel,
    options.cliProvider,
  );
  if (error) {
    return { error };
  }

  if (matches.length > 1) {
    return {
      error: `Model "${options.cliModel}" is ambiguous. Matches: ${matches
        .map((match) => describeModel(match.model))
        .join(", ")}`,
    };
  }

  const [match] = matches;
  return {
    model: match.model,
    thinkingLevel: match.thinkingLevel,
  };
}

export function resolveModelScope(
  patterns: string[],
  modelRegistry: ModelRegistry,
): ScopedModel[] {
  const allModels = modelRegistry.getAll();
  const deduped = new Map<string, ScopedModel>();

  for (const pattern of patterns) {
    const { matches } = findMatchingModels(allModels, pattern);
    for (const match of matches) {
      deduped.set(describeModel(match.model), match);
    }
  }

  return Array.from(deduped.values());
}

export function buildSessionOptions(
  parsed: Args,
  scopedModels: ScopedModel[],
  hasExistingSession: boolean,
  modelRegistry: ModelRegistry,
  settingsManager: SettingsManager,
): {
  options: SessionOptions;
  diagnostics: Diagnostic[];
} {
  const options: SessionOptions = {};
  const diagnostics: Diagnostic[] = [];

  if (parsed.model) {
    const resolved = resolveCliModel({
      cliProvider: parsed.provider,
      cliModel: parsed.model,
      modelRegistry,
    });

    if (resolved.warning) {
      diagnostics.push({ type: "warning", message: resolved.warning });
    }
    if (resolved.error) {
      diagnostics.push({ type: "error", message: resolved.error });
    }
    if (resolved.model) {
      options.model = resolved.model;
      if (!parsed.thinking && resolved.thinkingLevel) {
        options.thinkingLevel = resolved.thinkingLevel;
      }
    }
  }

  if (!options.model && scopedModels.length > 0 && !hasExistingSession) {
    const savedProvider = settingsManager.getDefaultProvider();
    const savedModelId = settingsManager.getDefaultModel();
    const savedModel =
      savedProvider && savedModelId
        ? modelRegistry.find(savedProvider, savedModelId)
        : undefined;
    const savedInScope = savedModel
      ? scopedModels.find(
          (scopedModel) =>
            scopedModel.model.provider === savedModel.provider &&
            scopedModel.model.id === savedModel.id,
        )
      : undefined;
    const selectedScopedModel = savedInScope ?? scopedModels[0];
    options.model = selectedScopedModel.model;
    if (!parsed.thinking && selectedScopedModel.thinkingLevel) {
      options.thinkingLevel = selectedScopedModel.thinkingLevel;
    }
  }

  if (parsed.thinking) {
    options.thinkingLevel = parsed.thinking;
  }

  if (scopedModels.length > 0) {
    options.scopedModels = scopedModels;
  }

  if (parsed.noTools) {
    options.tools = parsed.tools?.map((tool) => BUILT_IN_TOOLS[tool]) ?? [];
  } else if (parsed.tools) {
    options.tools = parsed.tools.map((tool) => BUILT_IN_TOOLS[tool]);
  }

  return { options, diagnostics };
}

export function printModels(
  modelRegistry: ModelRegistry,
  searchPattern?: string,
): void {
  const matches = searchPattern
    ? resolveModelScope([searchPattern], modelRegistry).map((match) => match.model)
    : modelRegistry.getAll();

  if (matches.length === 0) {
    console.log("No matching models.");
    return;
  }

  for (const model of matches) {
    const auth = modelRegistry.hasConfiguredAuth(model) ? "auth" : "no-auth";
    const reasoning = model.reasoning ? "reasoning" : "no-reasoning";
    console.log(
      `${describeModel(model).padEnd(36)} ${auth.padEnd(8)} ${reasoning} ${model.name}`,
    );
  }
}
