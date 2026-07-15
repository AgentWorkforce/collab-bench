// Core logic for running a single collab-bench cell end-to-end: spawn 3
// workers into the cell's existing channel, poll until the count
// finishes/stalls/times out, release the workers, then grade the transcript.
// Shared by scripts/run-cell.mjs (single-cell CLI) and scripts/run-matrix.mjs
// (sequential full-matrix runner).

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");

const POLL_INTERVAL_MS = 5000;
const STALL_TIMEOUT_MS = 60_000; // no new message for 60s => stalled
const HARD_TIMEOUT_MS = 10 * 60_000; // give up after 10 minutes regardless

function loadMatrix() {
  return JSON.parse(readFileSync(path.join(ROOT, "configs/matrix.generated.json"), "utf8"));
}

function loadChannelMap() {
  return JSON.parse(readFileSync(path.join(ROOT, "configs/cell-channels.json"), "utf8"));
}

function taskFor(channel, effort) {
  return (
    `For this task, deliberately operate at ${effort} reasoning effort. ` +
    `You are one of three agents assigned to the "${channel}" channel. ` +
    `Together you must count from 1 to 100, one number per turn: post your number as a message ` +
    `IN THE "${channel}" CHANNEL (use that exact channel name when posting — not "general" or any other channel). ` +
    `Post the next number in sequence, then wait for one of the other two agents to post before you post again. ` +
    `Do not post two numbers in a row yourself, don't skip or repeat numbers, and don't do anything else beyond ` +
    `posting numbers in "${channel}" — no extra coordination messages needed. Stop once 100 has been posted.`
  );
}

function fetchMessages(channel) {
  const raw = execFileSync("agent-relay", ["message", "list", channel, "--limit", "500"], { encoding: "utf8" });
  const jsonStart = raw.indexOf("[");
  return JSON.parse(raw.slice(jsonStart));
}

export async function runCell(cellId, { log = () => {} } = {}) {
  const matrix = loadMatrix();
  const channelMap = loadChannelMap();

  const cell = matrix.cells.find((c) => c.id === cellId);
  if (!cell) throw new Error(`Unknown cell id: ${cellId}`);
  const channel = channelMap[cellId];
  if (!channel) throw new Error(`No channel mapping for cell ${cellId}`);

  const workerSuffix = channel.replace(/^bench-/, "");
  const workerNames = cell.agents.map((_, i) => `${workerSuffix}-a${i + 1}`);

  log(`Spawning 3 workers for cell ${cellId} into #${channel}...`);
  cell.agents.forEach((agent, i) => {
    execFileSync(
      "agent-relay",
      [
        "node", "agent", "spawn", "claude",
        "--name", workerNames[i],
        "--channels", channel,
        "--model", agent.model,
        "--task", taskFor(channel, agent.effort),
      ],
      { encoding: "utf8" }
    );
    log(`  spawned ${workerNames[i]} (${agent.model}, ${agent.effort} effort)`);
  });

  const startedAt = Date.now();
  let lastMessageAt = startedAt;
  let lastCount = 0;

  log("Polling channel for completion/stall/timeout...");
  while (true) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const messages = fetchMessages(channel);
    if (messages.length > lastCount) {
      lastCount = messages.length;
      lastMessageAt = Date.now();
    }
    const maxNum = messages
      .map((m) => Number(m.text))
      .filter((n) => Number.isInteger(n))
      .reduce((a, b) => Math.max(a, b), 0);

    if (maxNum >= 100) {
      log("Reached 100 — done.");
      break;
    }
    if (Date.now() - lastMessageAt > STALL_TIMEOUT_MS) {
      log(`Stalled — no new messages for ${STALL_TIMEOUT_MS / 1000}s. Stopping.`);
      break;
    }
    if (Date.now() - startedAt > HARD_TIMEOUT_MS) {
      log(`Hard timeout after ${HARD_TIMEOUT_MS / 1000}s. Stopping.`);
      break;
    }
    log(`  ...max=${maxNum}, messages=${messages.length}`);
  }

  log("Releasing workers...");
  for (const name of workerNames) {
    try {
      execFileSync("agent-relay", ["node", "agent", "release", name], { encoding: "utf8" });
      log(`  released ${name}`);
    } catch (e) {
      log(`  failed to release ${name}: ${e.message}`);
    }
  }

  log("Grading...");
  const gradeOut = execFileSync("node", [path.join(__dirname, "../grade-cell.mjs"), cellId], { encoding: "utf8" });
  return JSON.parse(gradeOut);
}
