import { describe, expect, it } from "vitest";
import {
  parseCommand,
  isSafeSessionId,
  isSafeAlias,
  stripSenderInfo,
  parseSenderInfo,
  formatSenderInfo,
  normalizeMode,
  normalizeWaitUntil,
  extractTextContent,
} from "../../extensions/control.ts";

describe("parseCommand", () => {
  it("parses valid send command", () => {
    const result = parseCommand('{"type":"send","message":"hello"}');
    expect(result.command).toEqual({ type: "send", message: "hello" });
    expect(result.error).toBeUndefined();
  });

  it("parses valid get_message command", () => {
    const result = parseCommand('{"type":"get_message"}');
    expect(result.command).toEqual({ type: "get_message" });
  });

  it("parses valid subscribe command", () => {
    const result = parseCommand('{"type":"subscribe","event":"turn_end"}');
    expect(result.command).toEqual({ type: "subscribe", event: "turn_end" });
  });

  it("returns error for invalid JSON", () => {
    const result = parseCommand("not json");
    expect(result.error).toBeDefined();
    expect(result.command).toBeUndefined();
  });

  it("returns error for null", () => {
    const result = parseCommand("null");
    expect(result.error).toBe("Invalid command");
  });

  it("returns error for missing type", () => {
    const result = parseCommand('{"message":"hello"}');
    expect(result.error).toBe("Missing command type");
  });

  it("returns error for non-string type", () => {
    const result = parseCommand('{"type":123}');
    expect(result.error).toBe("Missing command type");
  });
});

describe("isSafeSessionId", () => {
  it("accepts valid UUIDs", () => {
    expect(isSafeSessionId("abc-123-def")).toBe(true);
  });

  it("rejects path traversal", () => {
    expect(isSafeSessionId("../etc/passwd")).toBe(false);
  });

  it("rejects forward slashes", () => {
    expect(isSafeSessionId("foo/bar")).toBe(false);
  });

  it("rejects backslashes", () => {
    expect(isSafeSessionId("foo\\bar")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isSafeSessionId("")).toBe(false);
  });

  it("accepts simple strings", () => {
    expect(isSafeSessionId("my-session")).toBe(true);
  });
});

describe("isSafeAlias", () => {
  it("accepts simple names", () => {
    expect(isSafeAlias("my-session")).toBe(true);
  });

  it("rejects path traversal", () => {
    expect(isSafeAlias("..")).toBe(false);
  });

  it("rejects slashes", () => {
    expect(isSafeAlias("foo/bar")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isSafeAlias("")).toBe(false);
  });
});

describe("stripSenderInfo", () => {
  it("removes sender_info tags", () => {
    const text = 'Hello <sender_info>{"sessionId":"abc"}</sender_info>';
    expect(stripSenderInfo(text)).toBe("Hello");
  });

  it("removes multiple sender_info tags", () => {
    const text = '<sender_info>a</sender_info> hello <sender_info>b</sender_info>';
    expect(stripSenderInfo(text)).toBe("hello");
  });

  it("leaves text without sender_info unchanged", () => {
    expect(stripSenderInfo("plain text")).toBe("plain text");
  });

  it("handles multiline sender_info", () => {
    const text = 'Hello\n<sender_info>\n{"id":"abc"}\n</sender_info>';
    expect(stripSenderInfo(text)).toBe("Hello");
  });
});

describe("parseSenderInfo", () => {
  it("parses JSON sender info", () => {
    const text = '<sender_info>{"sessionId":"abc-123","sessionName":"worker"}</sender_info>';
    const result = parseSenderInfo(text);
    expect(result).toEqual({ sessionId: "abc-123", sessionName: "worker" });
  });

  it("parses sender info with only sessionId", () => {
    const text = '<sender_info>{"sessionId":"abc-123"}</sender_info>';
    const result = parseSenderInfo(text);
    expect(result?.sessionId).toBe("abc-123");
  });

  it("parses legacy format", () => {
    const text = "<sender_info>session abc12345</sender_info>";
    const result = parseSenderInfo(text);
    expect(result?.sessionId).toBe("abc12345");
  });

  it("returns null for no sender_info", () => {
    expect(parseSenderInfo("plain text")).toBeNull();
  });

  it("returns null for empty sender_info", () => {
    expect(parseSenderInfo("<sender_info></sender_info>")).toBeNull();
  });

  it("returns null for whitespace-only sender_info", () => {
    expect(parseSenderInfo("<sender_info>   </sender_info>")).toBeNull();
  });
});

describe("formatSenderInfo", () => {
  it("formats name and id", () => {
    expect(formatSenderInfo({ sessionId: "abc", sessionName: "worker" })).toBe("worker (abc)");
  });

  it("formats name only", () => {
    expect(formatSenderInfo({ sessionName: "worker" })).toBe("worker");
  });

  it("formats id only", () => {
    expect(formatSenderInfo({ sessionId: "abc" })).toBe("abc");
  });

  it("returns null for null", () => {
    expect(formatSenderInfo(null)).toBeNull();
  });

  it("returns null for empty info", () => {
    expect(formatSenderInfo({})).toBeNull();
  });
});

describe("normalizeMode", () => {
  it("normalizes steer", () => {
    expect(normalizeMode("steer")).toBe("steer");
  });

  it("normalizes follow_up", () => {
    expect(normalizeMode("follow_up")).toBe("follow_up");
  });

  it("normalizes follow-up variant", () => {
    expect(normalizeMode("follow-up")).toBe("follow_up");
  });

  it("normalizes followup variant", () => {
    expect(normalizeMode("followup")).toBe("follow_up");
  });

  it("is case-insensitive", () => {
    expect(normalizeMode("STEER")).toBe("steer");
    expect(normalizeMode("Follow_Up")).toBe("follow_up");
  });

  it("trims whitespace", () => {
    expect(normalizeMode("  steer  ")).toBe("steer");
  });

  it("returns null for unknown mode", () => {
    expect(normalizeMode("unknown")).toBeNull();
  });
});

describe("normalizeWaitUntil", () => {
  it("normalizes turn_end", () => {
    expect(normalizeWaitUntil("turn_end")).toBe("turn_end");
  });

  it("normalizes turn-end variant", () => {
    expect(normalizeWaitUntil("turn-end")).toBe("turn_end");
  });

  it("normalizes message_processed", () => {
    expect(normalizeWaitUntil("message_processed")).toBe("message_processed");
  });

  it("normalizes message-processed variant", () => {
    expect(normalizeWaitUntil("message-processed")).toBe("message_processed");
  });

  it("is case-insensitive", () => {
    expect(normalizeWaitUntil("TURN_END")).toBe("turn_end");
  });

  it("returns null for unknown", () => {
    expect(normalizeWaitUntil("unknown")).toBeNull();
  });
});

describe("extractTextContent", () => {
  it("returns string content directly", () => {
    expect(extractTextContent("hello")).toBe("hello");
  });

  it("extracts text from content array", () => {
    const content = [
      { type: "text" as const, text: "hello" },
      { type: "text" as const, text: "world" },
    ];
    expect(extractTextContent(content)).toBe("hello\nworld");
  });

  it("filters out non-text content", () => {
    const content = [
      { type: "text" as const, text: "hello" },
      { type: "image" as const },
      { type: "text" as const, text: "world" },
    ];
    expect(extractTextContent(content)).toBe("hello\nworld");
  });

  it("returns empty string for empty array", () => {
    expect(extractTextContent([])).toBe("");
  });
});
