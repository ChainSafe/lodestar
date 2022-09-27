/* eslint import/order: "off" */
// This script is should be run in an e2e !!
// It demostrates how to properly change the Lodestar preset safely

// 1. Import from @lodestar/params/setPreset only
import {setCustomPreset, PresetName} from "../../src/setPreset.js";
// eslint-disable-next-line @typescript-eslint/naming-convention
setCustomPreset(PresetName.minimal, {SLOTS_PER_EPOCH: 2});

// 2. Import from any other @lodestar/params paths
import {expect} from "chai";

const {SLOTS_PER_EPOCH, BASE_REWARD_FACTOR} = await import("../../src/index.js");

expect(SLOTS_PER_EPOCH).to.equal(2, "SLOTS_PER_EPOCH should have overriden preset value");
expect(BASE_REWARD_FACTOR).to.equal(64, "BASE_REWARD_FACTOR should have preset value");
expect(process.env.LODESTAR_PRESET).to.equal(undefined, "LODESTAR_PRESET ENV must not be set");
