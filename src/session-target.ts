import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import {
  SessionManager,
  type SessionInfo,
} from "@mariozechner/pi-coding-agent";
import type { Args } from "./args.js";
import { expandHome } from "./config.js";

function looksLikeSessionPath(value: string): boolean {
  return (
    value.includes("/") ||
    value.includes("\\") ||
    value.endsWith(".jsonl") ||
    value.startsWith("~")
  );
}

function resolveSessionPathInput(value: string): string {
  return expandHome(value);
}

async function pickSessionFromList(
  sessions: SessionInfo[],
): Promise<string | undefined> {
  if (sessions.length === 0) {
    return undefined;
  }

  const limitedSessions = sessions.slice(0, 20);
  console.log("Select a session to resume:");
  limitedSessions.forEach((session, index) => {
    console.log(
      `${String(index + 1).padStart(2, " ")}. ${session.id}  ${session.cwd}`,
    );
  });

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question("Enter number (blank to cancel): ");
    const selection = answer.trim();
    if (!selection) {
      return undefined;
    }

    const index = Number(selection) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= limitedSessions.length) {
      throw new Error(`Invalid selection "${selection}"`);
    }

    return limitedSessions[index].path;
  } finally {
    rl.close();
  }
}

type ResolvedSession = {
  path: string;
  isFromDifferentProject: boolean;
};

async function resolveSessionPath(
  sessionArg: string,
  cwd: string,
  sessionDir?: string,
): Promise<ResolvedSession> {
  if (looksLikeSessionPath(sessionArg)) {
    return { path: resolveSessionPathInput(sessionArg), isFromDifferentProject: false };
  }

  const localSessions = await SessionManager.list(cwd, sessionDir);
  const localMatches = localSessions.filter((session) =>
    session.id.startsWith(sessionArg),
  );
  if (localMatches.length === 1) {
    return { path: localMatches[0].path, isFromDifferentProject: false };
  }
  if (localMatches.length > 1) {
    throw new Error(
      `Session "${sessionArg}" is ambiguous in the current project: ${localMatches
        .map((session) => session.id)
        .join(", ")}`,
    );
  }

  const allSessions = await SessionManager.listAll();
  const globalMatches = allSessions.filter((session) =>
    session.id.startsWith(sessionArg),
  );
  if (globalMatches.length === 1) {
    return { path: globalMatches[0].path, isFromDifferentProject: true };
  }
  if (globalMatches.length > 1) {
    throw new Error(
      `Session "${sessionArg}" is ambiguous across projects: ${globalMatches
        .map((session) => session.id)
        .join(", ")}`,
    );
  }

  throw new Error(`No session found matching "${sessionArg}"`);
}

async function openSession(
  sessionPath: string,
  sessionDir: string | undefined,
  fallbackCwd: string,
): Promise<SessionManager> {
  const sessionManager = SessionManager.open(sessionPath, sessionDir);
  const savedCwd = sessionManager.getCwd();
  if (existsSync(savedCwd)) {
    return sessionManager;
  }

  console.error(
    `Warning: session's original directory no longer exists: ${savedCwd}`,
  );
  console.error(`  Falling back to current directory: ${fallbackCwd}`);
  return SessionManager.open(sessionPath, sessionDir, fallbackCwd);
}

export function validateForkFlags(parsed: Args): void {
  if (!parsed.fork) {
    return;
  }

  const conflictingFlags = [
    parsed.session ? "--session" : undefined,
    parsed.continue ? "--continue" : undefined,
    parsed.resume ? "--resume" : undefined,
    parsed.noSession ? "--no-session" : undefined,
  ].filter((flag): flag is string => Boolean(flag));

  if (conflictingFlags.length > 0) {
    throw new Error(
      `--fork cannot be combined with ${conflictingFlags.join(", ")}`,
    );
  }
}

export async function createInitialSessionManager(
  parsed: Args,
  cwd: string,
  sessionDir: string | undefined,
): Promise<SessionManager> {
  if (parsed.noSession) {
    return SessionManager.inMemory(cwd);
  }

  if (parsed.fork) {
    const resolved = await resolveSessionPath(parsed.fork, cwd, sessionDir);
    return SessionManager.forkFrom(resolved.path, cwd, sessionDir);
  }

  if (parsed.session) {
    const resolved = await resolveSessionPath(parsed.session, cwd, sessionDir);
    if (resolved.isFromDifferentProject) {
      throw new Error(
        `Session "${parsed.session}" belongs to a different project. ` +
          `Use --fork ${parsed.session} to fork it into this project instead.`,
      );
    }
    return openSession(resolved.path, sessionDir, cwd);
  }

  if (parsed.resume) {
    const sessions = await SessionManager.list(cwd, sessionDir);
    const selectedPath = await pickSessionFromList(sessions);
    if (!selectedPath) {
      process.exit(0);
    }
    return openSession(selectedPath, sessionDir, cwd);
  }

  if (parsed.continue) {
    return SessionManager.continueRecent(cwd, sessionDir);
  }

  return SessionManager.create(cwd, sessionDir);
}
