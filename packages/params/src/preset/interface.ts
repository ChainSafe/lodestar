/* eslint-disable @typescript-eslint/naming-convention */
/**
 * @module params
 */

import {IPhase0Preset} from "./phase0";
import {IAltairPreset} from "./altair";
import {IBellatrixPreset} from "./bellatrix";

export type IBeaconPreset = IPhase0Preset & IAltairPreset & IBellatrixPreset;
