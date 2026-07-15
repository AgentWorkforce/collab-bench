// Runs ONE collab-bench cell end-to-end and prints its grade.
//
// Usage: node scripts/run-cell.mjs <cellId>

import { runCell } from "./lib/run-cell-core.mjs";

const cellId = process.argv[2];
if (!cellId) {
  console.error("Usage: node scripts/run-cell.mjs <cellId>");
  process.exit(1);
}

const result = await runCell(cellId, { log: (msg) => console.log(msg) });
console.log(JSON.stringify(result, null, 2));
