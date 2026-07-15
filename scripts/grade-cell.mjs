// Grades a single collab-bench cell run by reading its channel's message
// history and checking whether the 3 assigned agents counted 1..100 cleanly.
//
// Usage: node scripts/grade-cell.mjs <cellId> [--limit 500]
//
// Reads configs/matrix.generated.json for the cell's channel name and
// expected agents, then fetches messages via `agent-relay message list`.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const matrixPath = path.join(__dirname, "../configs/matrix.generated.json");

const [, , cellId, ...rest] = process.argv;
if (!cellId) {
  console.error("Usage: node scripts/grade-cell.mjs <cellId> [--limit N]");
  process.exit(1);
}
const limitFlagIdx = rest.indexOf("--limit");
const limit = limitFlagIdx >= 0 ? rest[limitFlagIdx + 1] : "500";

const matrix = JSON.parse(readFileSync(matrixPath, "utf8"));
const cell = matrix.cells.find((c) => c.id === cellId);
if (!cell) {
  console.error(`Unknown cell id: ${cellId}`);
  process.exit(1);
}

// Channel names follow the convention established when the 28 cells were
// created: "bench-" + a short hand slug per cell. This map must match
// whatever channel the runner actually used for this cell.
const CHANNEL_MAP_PATH = path.join(__dirname, "../configs/cell-channels.json");
const channelMap = JSON.parse(readFileSync(CHANNEL_MAP_PATH, "utf8"));
const channel = channelMap[cellId];
if (!channel) {
  console.error(`No channel mapping for cell ${cellId} in configs/cell-channels.json`);
  process.exit(1);
}

const expectedAgents = cell.agents.map((_, i) => `${channel.replace(/^bench-/, "")}-a${i + 1}`);

const raw = execFileSync(
  "agent-relay",
  ["message", "list", channel, "--limit", limit],
  { encoding: "utf8" }
);
const jsonStart = raw.indexOf("[");
const messages = JSON.parse(raw.slice(jsonStart))
  .map((m) => ({ text: m.text.trim(), agent: m.from.name, at: new Date(m.createdAt).getTime() }))
  .sort((a, b) => a.at - b.at);

const failReasons = [];
const perAgentCounts = {};
let expectedNext = 1;
let maxReached = 0;
let duplicates = 0;
let skips = 0;
let outOfOrderPosts = 0;
let consecutiveSameAgentViolations = 0;
let nonNumericMessages = 0;
let prevAgent = null;
let leakedToOtherChannel = false; // set true if we ever see an unexpected agent name posting here

for (const msg of messages) {
  perAgentCounts[msg.agent] = (perAgentCounts[msg.agent] || 0) + 1;

  if (!expectedAgents.includes(msg.agent)) {
    leakedToOtherChannel = true;
  }

  if (msg.agent === prevAgent) {
    consecutiveSameAgentViolations++;
  }
  prevAgent = msg.agent;

  const n = Number(msg.text);
  if (!Number.isInteger(n) || String(n) !== msg.text) {
    nonNumericMessages++;
    continue;
  }

  if (n === expectedNext) {
    expectedNext = n + 1;
    maxReached = n;
  } else if (n < expectedNext) {
    duplicates++;
  } else {
    skips += n - expectedNext;
    outOfOrderPosts++;
    expectedNext = n + 1;
    maxReached = n;
  }
}

const reachedGoal = maxReached === 100;
const participants = Object.keys(perAgentCounts);
const missingAgents = expectedAgents.filter((a) => !participants.includes(a));

if (!reachedGoal) failReasons.push(`did not reach 100 (max was ${maxReached})`);
if (duplicates > 0) failReasons.push(`${duplicates} duplicate/backwards number(s)`);
if (skips > 0) failReasons.push(`${skips} skipped number(s)`);
if (consecutiveSameAgentViolations > 0) failReasons.push(`${consecutiveSameAgentViolations} turn violation(s) (same agent posted twice in a row)`);
if (missingAgents.length > 0) failReasons.push(`agent(s) never participated: ${missingAgents.join(", ")}`);
if (leakedToOtherChannel) failReasons.push("messages from an unexpected agent name appeared in this channel");
if (nonNumericMessages > 0) failReasons.push(`${nonNumericMessages} non-numeric/extraneous message(s)`);

const wallClockSeconds = messages.length >= 2
  ? Math.round((messages[messages.length - 1].at - messages[0].at) / 1000)
  : null;

const result = {
  cellId,
  channel,
  task: cell.task,
  agents: cell.agents,
  pass: failReasons.length === 0,
  failReasons,
  metrics: {
    totalMessages: messages.length,
    maxNumberReached: maxReached,
    wallClockSeconds,
    perAgentMessageCounts: perAgentCounts,
    duplicates,
    skips,
    consecutiveSameAgentViolations,
    nonNumericMessages,
  },
};

console.log(JSON.stringify(result, null, 2));
