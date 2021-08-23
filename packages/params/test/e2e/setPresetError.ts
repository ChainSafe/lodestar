// This script is should be run in an e2e !!
// It demostrates how to properly change the Lodestar preset safely

// 1. Import from not only @chainsafe/lodestar-params/setPreset will trigger an error
import {SLOTS_PER_EPOCH} from "../../lib";
import {setActivePreset, PresetName} from "../../setPreset";
// This line should throw
setActivePreset(PresetName.minimal);

SLOTS_PER_EPOCH;
