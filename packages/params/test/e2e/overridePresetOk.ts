import assert from "node:assert";

/* eslint import/order: "off" */
// This script is should be run in an e2e !!
// It demostrates how to properly change the Lodestar preset safely

// 1. Import from @lodestar/params/setPreset only
import {setActivePreset, PresetName} from "../../src/setPreset.js";
// eslint-disable-next-line @typescript-eslint/naming-convention
setActivePreset(PresetName.minimal, {SLOTS_PER_EPOCH: 2});

// 2. Import from any other @lodestar/params paths

const {SLOTS_PER_EPOCH, BASE_REWARD_FACTOR} = await import("../../src/index.js");

assert.equal(SLOTS_PER_EPOCH, 2, "SLOTS_PER_EPOCH should have overriden preset value");
assert.equal(BASE_REWARD_FACTOR, 64, "BASE_REWARD_FACTOR should have preset value");
assert.equal(process.env.LODESTAR_PRESET, undefined, "LODESTAR_PRESET ENV must not be set");
