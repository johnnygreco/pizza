import { describe, expect, it } from "vitest";
import {
  formatTodoId,
  normalizeTodoId,
  validateTodoId,
  isTodoClosed,
  sortTodos,
  filterTodos,
  parseFrontMatter,
  findJsonObjectEnd,
  splitFrontMatter,
  parseTodoContent,
  serializeTodo,
} from "../../extensions/todos.ts";

describe("formatTodoId", () => {
  it("adds TODO- prefix", () => {
    expect(formatTodoId("deadbeef")).toBe("TODO-deadbeef");
  });
});

describe("normalizeTodoId", () => {
  it("strips TODO- prefix", () => {
    expect(normalizeTodoId("TODO-deadbeef")).toBe("deadbeef");
  });

  it("strips # prefix", () => {
    expect(normalizeTodoId("#TODO-deadbeef")).toBe("deadbeef");
  });

  it("is case-insensitive for prefix", () => {
    expect(normalizeTodoId("todo-DEADBEEF")).toBe("DEADBEEF");
  });

  it("trims whitespace", () => {
    expect(normalizeTodoId("  deadbeef  ")).toBe("deadbeef");
  });

  it("passes through raw hex", () => {
    expect(normalizeTodoId("abcd1234")).toBe("abcd1234");
  });
});

describe("validateTodoId", () => {
  it("accepts valid 8-char hex", () => {
    expect(validateTodoId("deadbeef")).toEqual({ id: "deadbeef" });
  });

  it("accepts with TODO- prefix", () => {
    expect(validateTodoId("TODO-DEADBEEF")).toEqual({ id: "deadbeef" });
  });

  it("rejects non-hex characters", () => {
    const result = validateTodoId("ghijklmn");
    expect(result).toHaveProperty("error");
  });

  it("rejects wrong length", () => {
    const result = validateTodoId("abc");
    expect(result).toHaveProperty("error");
  });

  it("rejects empty string", () => {
    const result = validateTodoId("");
    expect(result).toHaveProperty("error");
  });
});

describe("isTodoClosed", () => {
  it("returns true for 'closed'", () => {
    expect(isTodoClosed("closed")).toBe(true);
  });

  it("returns true for 'done'", () => {
    expect(isTodoClosed("done")).toBe(true);
  });

  it("returns false for 'open'", () => {
    expect(isTodoClosed("open")).toBe(false);
  });

  it("returns false for 'in-progress'", () => {
    expect(isTodoClosed("in-progress")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isTodoClosed("Closed")).toBe(true);
    expect(isTodoClosed("DONE")).toBe(true);
  });
});

describe("sortTodos", () => {
  const makeTodo = (overrides: Partial<{ id: string; status: string; assigned_to_session: string; created_at: string }>) => ({
    id: overrides.id ?? "00000001",
    title: "test",
    tags: [],
    status: overrides.status ?? "open",
    created_at: overrides.created_at ?? "2026-01-01T00:00:00.000Z",
    assigned_to_session: overrides.assigned_to_session,
  });

  it("puts open before closed", () => {
    const todos = [
      makeTodo({ id: "a", status: "closed" }),
      makeTodo({ id: "b", status: "open" }),
    ];
    const sorted = sortTodos(todos);
    expect(sorted[0].id).toBe("b");
    expect(sorted[1].id).toBe("a");
  });

  it("puts assigned before unassigned (within open)", () => {
    const todos = [
      makeTodo({ id: "a", status: "open" }),
      makeTodo({ id: "b", status: "open", assigned_to_session: "s1" }),
    ];
    const sorted = sortTodos(todos);
    expect(sorted[0].id).toBe("b");
    expect(sorted[1].id).toBe("a");
  });

  it("sorts by created_at within same category", () => {
    const todos = [
      makeTodo({ id: "b", created_at: "2026-01-02T00:00:00.000Z" }),
      makeTodo({ id: "a", created_at: "2026-01-01T00:00:00.000Z" }),
    ];
    const sorted = sortTodos(todos);
    expect(sorted[0].id).toBe("a");
    expect(sorted[1].id).toBe("b");
  });

  it("does not mutate original array", () => {
    const todos = [
      makeTodo({ id: "a", status: "closed" }),
      makeTodo({ id: "b", status: "open" }),
    ];
    sortTodos(todos);
    expect(todos[0].id).toBe("a");
  });
});

describe("filterTodos", () => {
  const makeTodo = (overrides: Partial<{ id: string; title: string; tags: string[]; status: string }>) => ({
    id: overrides.id ?? "00000001",
    title: overrides.title ?? "test",
    tags: overrides.tags ?? [],
    status: overrides.status ?? "open",
    created_at: "2026-01-01T00:00:00.000Z",
    assigned_to_session: undefined,
  });

  it("returns all todos for empty query", () => {
    const todos = [makeTodo({ id: "a" }), makeTodo({ id: "b" })];
    expect(filterTodos(todos, "")).toEqual(todos);
  });

  it("filters by title", () => {
    const todos = [
      makeTodo({ id: "a", title: "fix login bug" }),
      makeTodo({ id: "b", title: "add tests" }),
    ];
    const result = filterTodos(todos, "login");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a");
  });

  it("filters by tag", () => {
    const todos = [
      makeTodo({ id: "a", tags: ["qa"] }),
      makeTodo({ id: "b", tags: ["feature"] }),
    ];
    const result = filterTodos(todos, "qa");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a");
  });

  it("filters by id", () => {
    const todos = [
      makeTodo({ id: "deadbeef" }),
      makeTodo({ id: "abcd1234" }),
    ];
    const result = filterTodos(todos, "deadbeef");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("deadbeef");
  });
});

describe("findJsonObjectEnd", () => {
  it("finds end of simple object", () => {
    expect(findJsonObjectEnd('{"a":1}')).toBe(6);
  });

  it("finds end of nested object", () => {
    expect(findJsonObjectEnd('{"a":{"b":2}}')).toBe(12);
  });

  it("handles strings with braces", () => {
    expect(findJsonObjectEnd('{"a":"{"}')).toBe(8);
  });

  it("handles escaped quotes in strings", () => {
    expect(findJsonObjectEnd('{"a":"\\""}')).toBe(9);
  });

  it("returns -1 for unterminated object", () => {
    expect(findJsonObjectEnd('{"a":1')).toBe(-1);
  });

  it("returns -1 for empty string", () => {
    expect(findJsonObjectEnd("")).toBe(-1);
  });
});

describe("splitFrontMatter", () => {
  it("splits JSON front matter from body", () => {
    const content = '{"id":"abc"}\n\nSome body text.';
    const result = splitFrontMatter(content);
    expect(result.frontMatter).toBe('{"id":"abc"}');
    expect(result.body).toBe("Some body text.");
  });

  it("handles content with no body", () => {
    const content = '{"id":"abc"}\n';
    const result = splitFrontMatter(content);
    expect(result.frontMatter).toBe('{"id":"abc"}');
    expect(result.body).toBe("");
  });

  it("handles content not starting with {", () => {
    const content = "Just some text";
    const result = splitFrontMatter(content);
    expect(result.frontMatter).toBe("");
    expect(result.body).toBe("Just some text");
  });

  it("handles unterminated JSON", () => {
    const content = '{"id":"abc';
    const result = splitFrontMatter(content);
    expect(result.frontMatter).toBe("");
    expect(result.body).toBe('{"id":"abc');
  });
});

describe("parseFrontMatter", () => {
  it("parses valid JSON front matter", () => {
    const fm = JSON.stringify({
      id: "deadbeef",
      title: "Fix bug",
      tags: ["qa"],
      status: "open",
      created_at: "2026-01-01T00:00:00.000Z",
    });
    const result = parseFrontMatter(fm, "fallback");
    expect(result.id).toBe("deadbeef");
    expect(result.title).toBe("Fix bug");
    expect(result.tags).toEqual(["qa"]);
    expect(result.status).toBe("open");
  });

  it("uses fallback id for empty string", () => {
    const result = parseFrontMatter("", "fallback");
    expect(result.id).toBe("fallback");
    expect(result.title).toBe("");
    expect(result.status).toBe("open");
  });

  it("uses fallback id when id is missing from JSON", () => {
    const result = parseFrontMatter('{"title":"test"}', "fallback");
    expect(result.id).toBe("fallback");
  });

  it("filters non-string tags", () => {
    const fm = JSON.stringify({ tags: ["valid", 123, null, "also-valid"] });
    const result = parseFrontMatter(fm, "fallback");
    expect(result.tags).toEqual(["valid", "also-valid"]);
  });

  it("handles malformed JSON gracefully", () => {
    const result = parseFrontMatter("{invalid json}", "fallback");
    expect(result.id).toBe("fallback");
    expect(result.status).toBe("open");
  });
});

describe("parseTodoContent", () => {
  it("parses complete todo file", () => {
    const content = `{
  "id": "deadbeef",
  "title": "Test todo",
  "tags": ["test"],
  "status": "open",
  "created_at": "2026-01-01T00:00:00.000Z"
}

This is the body.`;

    const result = parseTodoContent(content, "deadbeef");
    expect(result.id).toBe("deadbeef");
    expect(result.title).toBe("Test todo");
    expect(result.body).toBe("This is the body.");
  });

  it("handles todo with no body", () => {
    const content = '{"id":"abc","title":"No body","tags":[],"status":"open","created_at":"2026-01-01T00:00:00.000Z"}\n';
    const result = parseTodoContent(content, "abc");
    expect(result.body).toBe("");
  });
});

describe("serializeTodo", () => {
  it("round-trips with parseTodoContent", () => {
    const todo = {
      id: "deadbeef",
      title: "Test round trip",
      tags: ["test"],
      status: "open",
      created_at: "2026-01-01T00:00:00.000Z",
      body: "Some notes here.",
    };
    const serialized = serializeTodo(todo);
    const parsed = parseTodoContent(serialized, "deadbeef");
    expect(parsed.id).toBe(todo.id);
    expect(parsed.title).toBe(todo.title);
    expect(parsed.tags).toEqual(todo.tags);
    expect(parsed.status).toBe(todo.status);
    expect(parsed.body.trim()).toBe(todo.body);
  });

  it("omits undefined assigned_to_session", () => {
    const todo = {
      id: "deadbeef",
      title: "Test",
      tags: [],
      status: "open",
      created_at: "2026-01-01T00:00:00.000Z",
      body: "",
    };
    const serialized = serializeTodo(todo);
    expect(serialized).not.toContain("assigned_to_session");
  });

  it("includes assigned_to_session when set", () => {
    const todo = {
      id: "deadbeef",
      title: "Test",
      tags: [],
      status: "open",
      created_at: "2026-01-01T00:00:00.000Z",
      assigned_to_session: "session-1",
      body: "",
    };
    const serialized = serializeTodo(todo);
    expect(serialized).toContain("session-1");
  });

  it("handles empty body", () => {
    const todo = {
      id: "deadbeef",
      title: "Test",
      tags: [],
      status: "open",
      created_at: "2026-01-01T00:00:00.000Z",
      body: "",
    };
    const serialized = serializeTodo(todo);
    expect(serialized.endsWith("}\n")).toBe(true);
  });
});
