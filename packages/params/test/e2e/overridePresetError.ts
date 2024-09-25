// This script is should be run in an e2e !!
// It demonstrates how NOT to change the Lodestar preset

// 1. Import from not only @lodestar/params/setPreset will trigger an error
import "../../lib/index.js";
import {setActivePreset, PresetName} from "../../lib/setPreset.js";
// This line should throw
setActivePreset(PresetName.minimal, {SLOTS_PER_EPOCH: 2});
