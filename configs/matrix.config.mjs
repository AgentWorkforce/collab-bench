// v1 matrix config for collab-bench.
// Team size is fixed at 3 (the "count to 100" wedge task). The two axes we vary
// are model and reasoning effort, and agents within a team are allowed to differ
// (mixed combos) rather than all sharing the same axis value.

export const teamSize = 3;

export const task = "count-to-100";

export const axes = {
  model: ["claude-sonnet-5", "claude-opus-4-8", "claude-haiku-4-5-20251001"],
  reasoningEffort: ["low", "medium", "high"],
};

// A full (model x effort)^teamSize cross product is combinatorially too large to
// run for v1 (e.g. 9 values^3 = 729 cells). Instead, generate a curated set of
// cells that isolates each axis, plus a handful of fully-mixed cells:
//
// - homogeneousBaselines: all 3 agents share the same (model, effort) pair.
//   One cell per (model, effort) combination — the control group.
// - modelMixed: effort held constant, model varied per agent slot.
// - effortMixed: model held constant, effort varied per agent slot.
// - fullyMixedSampleCount: N cells where both axes vary independently per slot.
export const strategy = {
  homogeneousBaselines: true,
  modelMixed: { effort: "medium" },
  effortMixed: { model: "claude-sonnet-5" },
  fullyMixedSampleCount: 5,
};
