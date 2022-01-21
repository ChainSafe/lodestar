import {Phase0Preset} from "./phase0";
import {AltairPreset} from "./altair";
import {BellatrixPreset} from "./bellatrix";

export type BeaconPreset = Phase0Preset & AltairPreset & BellatrixPreset;
