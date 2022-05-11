// This script is should be run in an e2e !!
// It demostrates how to properly change the Lodestar preset safely

// 1. Import from @chainsafe/lodestar-params/setPreset only
import {setActivePreset, PresetName} from "../../lib/setPreset.js";
setActivePreset(PresetName.minimal);

// 2. Import from any other @chainsafe/lodestar-params paths
import {expect} from "chai";

const {SLOTS_PER_EPOCH} = await import("../../lib/index.js");

expect(SLOTS_PER_EPOCH).to.equal(8, "SLOTS_PER_EPOCH should have minimal preset value");
expect(process.env.LODESTAR_PRESET).to.equal(undefined, "LODESTAR_PRESET ENV must not be set");
