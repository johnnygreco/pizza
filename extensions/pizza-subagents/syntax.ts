export interface SubagentInvocation {
  agent: string;
  prompt: string;
}

const PREFIX_SUBAGENT_INVOCATION_RE = /^\s*:([a-zA-Z0-9][a-zA-Z0-9_-]{0,63})(?:[ \t]+([\s\S]*))?$/;

export function parseSubagentInvocation(input: string): SubagentInvocation | undefined {
  const match = input.match(PREFIX_SUBAGENT_INVOCATION_RE);
  if (!match) return undefined;
  return {
    agent: match[1].toLowerCase(),
    prompt: match[2] ?? "",
  };
}

export function isSubagentListInvocation(invocation: SubagentInvocation): boolean {
  return ["subagents", "agents"].includes(invocation.agent) && ["", "list"].includes(invocation.prompt.trim().toLowerCase());
}

export function getSubagentAutocompletePrefix(lineBeforeCursor: string): { prefix: string; query: string } | undefined {
  const match = lineBeforeCursor.match(/(^|\n)(\s*):([a-zA-Z0-9_-]*)$/);
  if (!match) return undefined;
  const query = match[3] ?? "";
  return {
    prefix: `:${query}`,
    query: query.toLowerCase(),
  };
}
