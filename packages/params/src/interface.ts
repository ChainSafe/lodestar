/* eslint-disable @typescript-eslint/naming-convention */
/**
 * @module params
 */

import {IPhase0Params} from "./phase0";
import {ILightclientParams} from "./lightclient";
import {IPhase1Params} from "./phase1";

export type IBeaconParams = IPhase0Params & ILightclientParams & IPhase1Params;
