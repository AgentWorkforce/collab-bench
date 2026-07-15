import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { teamSize, task, axes, strategy } from "../configs/matrix.config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, "../configs/matrix.generated.json");

// All multisets of size `k` drawn from `list`, order-independent (agents are
// interchangeable slots; turn order is assigned by the task runner, not here).
function combosWithReplacement(list, k) {
  if (k === 0) return [[]];
  const [head, ...rest] = list;
  const withHead = combosWithReplacement(list, k - 1).map((c) => [head, ...c]);
  const withoutHead = rest.length ? combosWithReplacement(rest, k) : [];
  return [...withHead, ...withoutHead];
}

function isHomogeneous(combo) {
  return combo.every((v) => v === combo[0]);
}

function cellKey(agents) {
  return JSON.stringify(
    [...agents].sort((a, b) =>
      `${a.model}:${a.effort}`.localeCompare(`${b.model}:${b.effort}`)
    )
  );
}

const cells = [];
const seen = new Set();

function addCell(id, agents, axesVaried) {
  const key = cellKey(agents);
  if (seen.has(key)) return;
  seen.add(key);
  cells.push({ id, task, teamSize, axesVaried, agents });
}

if (strategy.homogeneousBaselines) {
  for (const model of axes.model) {
    for (const effort of axes.reasoningEffort) {
      const agents = Array.from({ length: teamSize }, () => ({ model, effort }));
      addCell(`baseline_${model}_${effort}`, agents, []);
    }
  }
}

if (strategy.modelMixed) {
  const effort = strategy.modelMixed.effort;
  for (const combo of combosWithReplacement(axes.model, teamSize)) {
    if (isHomogeneous(combo)) continue;
    const agents = combo.map((model) => ({ model, effort }));
    addCell(`model_mixed_${combo.join("+")}_${effort}`, agents, ["model"]);
  }
}

if (strategy.effortMixed) {
  const model = strategy.effortMixed.model;
  for (const combo of combosWithReplacement(axes.reasoningEffort, teamSize)) {
    if (isHomogeneous(combo)) continue;
    const agents = combo.map((effort) => ({ model, effort }));
    addCell(`effort_mixed_${model}_${combo.join("+")}`, agents, ["reasoningEffort"]);
  }
}

if (strategy.fullyMixedSampleCount) {
  let attempts = 0;
  let added = 0;
  while (added < strategy.fullyMixedSampleCount && attempts < strategy.fullyMixedSampleCount * 20) {
    attempts++;
    const agents = Array.from({ length: teamSize }, () => ({
      model: axes.model[Math.floor(Math.random() * axes.model.length)],
      effort: axes.reasoningEffort[Math.floor(Math.random() * axes.reasoningEffort.length)],
    }));
    const before = cells.length;
    addCell(`fully_mixed_${added}`, agents, ["model", "reasoningEffort"]);
    if (cells.length > before) added++;
  }
}

const output = {
  generatedFrom: "configs/matrix.config.mjs",
  task,
  teamSize,
  axes,
  cellCount: cells.length,
  cells,
};

await writeFile(outPath, JSON.stringify(output, null, 2) + "\n");
console.log(`Wrote ${cells.length} cells to ${path.relative(process.cwd(), outPath)}`);
