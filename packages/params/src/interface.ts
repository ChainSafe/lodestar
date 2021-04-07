/* eslint-disable @typescript-eslint/naming-convention */
/**
 * @module params
 */

import {IPhase0Params} from "./phase0";
import {IAltairParams} from "./altair";

export type IBeaconParams = IPhase0Params & IAltairParams;
