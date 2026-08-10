import { describe, expect, it } from "vitest";
import { selectChatDisplayTranscriptEntries } from "./session-transcript-display.fs.js";

type Entry = Record<string, unknown>;

function select(entries: Entry[]): Entry[] {
  return selectChatDisplayTranscriptEntries({ entries, recordOf: (entry) => entry });
}

describe("selectChatDisplayTranscriptEntries", () => {
  it("includes sessions_yield side continuations without changing the active leaf", () => {
    const entries: Entry[] = [
      { type: "message", id: "user", parentId: null, message: { role: "user" } },
      {
        type: "custom_message",
        id: "yield-root",
        parentId: "user",
        customType: "openclaw.sessions_yield",
      },
      {
        type: "message",
        id: "progress",
        parentId: "yield-root",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "first report" },
            { type: "toolCall", name: "sessions_yield" },
          ],
        },
      },
      {
        type: "custom_message",
        id: "yield-next",
        parentId: "progress",
        customType: "openclaw.sessions_yield",
      },
      {
        type: "message",
        id: "cli-gap-fill",
        parentId: "yield-next",
        message: { role: "assistant", content: "first report", api: "cli" },
      },
      {
        type: "leaf",
        id: "restore-yield-root",
        parentId: "cli-gap-fill",
        targetId: "yield-root",
        appendParentId: "cli-gap-fill",
        appendMode: "side",
      },
    ];

    expect(select(entries).map((entry) => entry.id)).toEqual([
      "user",
      "yield-root",
      "progress",
      "yield-next",
    ]);
  });

  it("does not expose unrelated side branches", () => {
    const entries: Entry[] = [
      { type: "message", id: "user", parentId: null, message: { role: "user" } },
      {
        type: "message",
        id: "internal-side",
        parentId: "user",
        message: { role: "assistant", content: "internal rewrite" },
      },
      {
        type: "leaf",
        id: "restore-user",
        parentId: "internal-side",
        targetId: "user",
        appendParentId: "internal-side",
        appendMode: "side",
      },
    ];

    expect(select(entries).map((entry) => entry.id)).toEqual(["user"]);
  });
});
