// This script is should be run in an e2e !!
// It demostrates how NOT to change the Lodestar preset

// 1. Import from not only @lodestar/params/setPreset will trigger an error
import {SLOTS_PER_EPOCH} from "../../lib/index.js";
import {setActivePreset, PresetName} from "../../lib/setPreset.js";
// This line should throw
// eslint-disable-next-line @typescript-eslint/naming-convention
setActivePreset(PresetName.minimal, {SLOTS_PER_EPOCH: 2});

SLOTS_PER_EPOCH;
