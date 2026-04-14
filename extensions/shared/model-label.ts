type ModelLike = {
  id?: string;
  name?: string;
  provider?: string;
};

const PROVIDER_LABELS: Record<string, string> = {
  "amazon-bedrock": "Amazon Bedrock",
  anthropic: "Anthropic",
  bedrock: "Bedrock",
  gemini: "Gemini",
  google: "Google",
  openai: "OpenAI",
  "openai-codex": "OpenAI Codex",
  openrouter: "OpenRouter",
  xai: "xAI",
};

function titleCaseWord(word: string): string {
  if (!word) return word;
  if (word.length <= 3) return word.toUpperCase();
  return word[0].toUpperCase() + word.slice(1);
}

export function humanizeProvider(provider: string | undefined): string {
  const raw = provider?.trim();
  if (!raw) return "";

  const normalized = raw.toLowerCase();
  const known = PROVIDER_LABELS[normalized];
  if (known) return known;

  return raw
    .split(/[-_/]+/)
    .filter(Boolean)
    .map(titleCaseWord)
    .join(" ");
}

export function stripModelSourcePrefix(name: string | undefined): string {
  const raw = name?.trim();
  if (!raw) return "";

  const match = raw.match(/^([A-Z][A-Za-z .+-]{1,30}):\s+(.+)$/);
  if (!match) return raw;
  return match[2].trim();
}

export function formatModelLabel(model: ModelLike | undefined): string | undefined {
  if (!model) return undefined;

  const provider = humanizeProvider(model.provider);
  const baseName = stripModelSourcePrefix(model.name) || model.id?.trim() || "";

  if (provider && baseName) return `${provider}: ${baseName}`;
  if (provider) return provider;
  return baseName || undefined;
}
