import {
  isSessionTranscriptLeafControl,
  mergeSessionTranscriptTreePaths,
  scanSessionTranscriptTree,
  selectSessionTranscriptTreePathNodes,
} from "../config/sessions/transcript-tree.js";

type TranscriptRecord = Record<string, unknown>;

const SESSIONS_YIELD_CONTEXT_CUSTOM_TYPE = "openclaw.sessions_yield";

function isRecord(value: unknown): value is TranscriptRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSessionsYieldContext(record: unknown): boolean {
  return (
    isRecord(record) &&
    record.type === "custom_message" &&
    record.customType === SESSIONS_YIELD_CONTEXT_CUSTOM_TYPE
  );
}

function readAssistantText(record: TranscriptRecord): string {
  const message = isRecord(record.message) ? record.message : undefined;
  if (message?.role !== "assistant") {
    return "";
  }
  if (typeof message.content === "string") {
    return message.content.trim();
  }
  if (!Array.isArray(message.content)) {
    return "";
  }
  return message.content
    .flatMap((block) => {
      if (!isRecord(block)) {
        return [];
      }
      return (block.type === "text" || block.type === "output_text") &&
        typeof block.text === "string"
        ? [block.text]
        : [];
    })
    .join("")
    .trim();
}

function assistantCallsSessionsYield(record: TranscriptRecord): boolean {
  const message = isRecord(record.message) ? record.message : undefined;
  if (message?.role !== "assistant" || !Array.isArray(message.content)) {
    return false;
  }
  return message.content.some((block) => {
    if (!isRecord(block)) {
      return false;
    }
    const name = block.name ?? block.toolName;
    return (block.type === "toolCall" || block.type === "tool_use") && name === "sessions_yield";
  });
}

function dropSessionsYieldCliGapFills<T>(
  entries: readonly T[],
  recordOf: (entry: T) => TranscriptRecord,
): T[] {
  let yieldedText = "";
  return entries.filter((entry) => {
    const record = recordOf(entry);
    const message = isRecord(record.message) ? record.message : undefined;
    if (message?.role === "user") {
      yieldedText = "";
      return true;
    }
    const text = readAssistantText(record);
    if (assistantCallsSessionsYield(record)) {
      yieldedText = text;
      return true;
    }
    if (message?.role === "assistant" && message.api === "cli" && text && text === yieldedText) {
      yieldedText = "";
      return false;
    }
    return true;
  });
}

/**
 * Select the active transcript plus user-visible sessions_yield continuations.
 *
 * Yield continuations use side append cursors so they stay out of future model
 * context. Chat history is a display surface, however, and must retain those
 * progress turns after a terminal history reconciliation.
 */
export function selectChatDisplayTranscriptEntries<T>(params: {
  entries: readonly T[];
  recordOf: (entry: T) => TranscriptRecord;
}): T[] {
  const records = params.entries.map(params.recordOf);
  const tree = scanSessionTranscriptTree(records);
  if (!tree.hasExplicitLeafUpdate) {
    return [...params.entries];
  }

  const activePath = selectSessionTranscriptTreePathNodes(tree, tree.leafId);
  if (tree.hasInvalidLeafControl) {
    return activePath.flatMap((node) => {
      const entry = params.entries[node.index];
      return entry === undefined ? [] : [entry];
    });
  }

  const paths = [activePath];
  for (const node of tree.nodes) {
    if (!isSessionTranscriptLeafControl(node.entry) || node.appendMode !== "side") {
      continue;
    }
    const sidePath = selectSessionTranscriptTreePathNodes(tree, node.appendParentId);
    const targetIndex = sidePath.findIndex((candidate) => candidate.id === node.leafId);
    const sideSuffix = targetIndex >= 0 ? sidePath.slice(targetIndex + 1) : sidePath;
    if (sideSuffix.some((candidate) => isSessionsYieldContext(candidate.entry))) {
      paths.push(sidePath);
    }
  }

  const selected = mergeSessionTranscriptTreePaths(paths).flatMap((node) => {
    const entry = params.entries[node.index];
    return entry === undefined ? [] : [entry];
  });
  return dropSessionsYieldCliGapFills(selected, params.recordOf);
}
