/* eslint import/order: "off" */
// This script is should be run in an e2e !!
// It demostrates how to properly change the Lodestar preset safely

// 1. Import from @lodestar/params/setPreset only
import {setActivePreset, PresetName} from "../../src/setPreset.js";
setActivePreset(PresetName.minimal);

// 2. Import from any other @lodestar/params paths
import assert from "node:assert";

const {SLOTS_PER_EPOCH} = await import("../../src/index.js");

assert.equal(SLOTS_PER_EPOCH, 8, "SLOTS_PER_EPOCH should have minimal preset value");
assert.equal(process.env.LODESTAR_PRESET, undefined, "LODESTAR_PRESET ENV must not be set");
