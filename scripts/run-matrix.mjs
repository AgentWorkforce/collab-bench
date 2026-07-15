// Runs the full collab-bench matrix ONE CELL AT A TIME (not concurrently):
// spawn -> poll -> release -> grade, then move to the next cell. Writes
// results to configs/results.json incrementally after every cell so
// progress survives an interruption.
//
// Usage: node scripts/run-matrix.mjs [--only cellId1,cellId2,...]

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runCell } from "./lib/run-cell-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const resultsPath = path.join(ROOT, "configs/results.json");

const matrix = JSON.parse(readFileSync(path.join(ROOT, "configs/matrix.generated.json"), "utf8"));

const onlyFlagIdx = process.argv.indexOf("--only");
const onlyIds = onlyFlagIdx >= 0 ? process.argv[onlyFlagIdx + 1].split(",") : null;
const cellIds = (onlyIds ?? matrix.cells.map((c) => c.id));

let results = existsSync(resultsPath) ? JSON.parse(readFileSync(resultsPath, "utf8")) : [];
const alreadyDone = new Set(results.map((r) => r.cellId));

function saveResults() {
  writeFileSync(resultsPath, JSON.stringify(results, null, 2) + "\n");
}

for (const [i, cellId] of cellIds.entries()) {
  if (alreadyDone.has(cellId)) {
    console.log(`[${i + 1}/${cellIds.length}] ${cellId} — already graded, skipping.`);
    continue;
  }
  console.log(`[${i + 1}/${cellIds.length}] Running ${cellId}...`);
  try {
    const result = await runCell(cellId, { log: (msg) => console.log(`  ${msg}`) });
    results.push(result);
    saveResults();
    console.log(`[${i + 1}/${cellIds.length}] ${cellId} -> ${result.pass ? "PASS" : "FAIL"} (${result.failReasons.join("; ") || "-"})`);
  } catch (e) {
    console.log(`[${i + 1}/${cellIds.length}] ${cellId} -> ERROR: ${e.message}`);
    results.push({ cellId, pass: false, failReasons: [`runner error: ${e.message}`], metrics: null });
    saveResults();
  }
}

const passCount = results.filter((r) => r.pass).length;
console.log(`\nDone. ${passCount}/${results.length} cells passed. Results at configs/results.json`);
