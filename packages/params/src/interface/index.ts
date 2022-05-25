import {Phase0Preset} from "./phase0.js";
import {AltairPreset} from "./altair.js";
import {BellatrixPreset} from "./bellatrix.js";

export type BeaconPreset = Phase0Preset & AltairPreset & BellatrixPreset;
