import {Phase0Preset} from "./phase0.js";
import {AltairPreset} from "./altair.js";
import {BellatrixPreset} from "./bellatrix.js";
import {CapellaPreset} from "./capella.js";
import {EIP4844Preset} from "./eip4844.js";

export type BeaconPreset = Phase0Preset & AltairPreset & BellatrixPreset & CapellaPreset & EIP4844Preset;
