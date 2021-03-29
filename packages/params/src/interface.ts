/* eslint-disable @typescript-eslint/naming-convention */
/**
 * @module params
 */

import {IPhase0Params} from "./phase0";
import {IAltairParams} from "./altair";
import {IPhase1Params} from "./phase1";

export type IBeaconParams = IPhase0Params & IAltairParams & IPhase1Params;
