/* eslint import/order: "off" */
// This script is should be run in an e2e !!
// It demostrates how to properly change the Lodestar preset safely

// 1. Import from @lodestar/params/setPreset only
import {setActivePreset, PresetName} from "../../src/setPreset.js";
setActivePreset(PresetName.minimal);

// 2. Import from any other @lodestar/params paths
import {expect} from "chai";

const {SLOTS_PER_EPOCH} = await import("../../src/index.js");

expect(SLOTS_PER_EPOCH).to.equal(8, "SLOTS_PER_EPOCH should have minimal preset value");
expect(process.env.LODESTAR_PRESET).to.equal(undefined, "LODESTAR_PRESET ENV must not be set");
