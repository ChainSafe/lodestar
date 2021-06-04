/* eslint-disable @typescript-eslint/naming-convention */
/**
 * @module params
 */

import {IPhase0Preset} from "./phase0";
import {IAltairPreset} from "./altair";

export type IBeaconPreset = IPhase0Preset & IAltairPreset;
