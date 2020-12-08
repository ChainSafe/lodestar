/**
 * @module sszTypes/presets/mainnet
 */
import {params} from "@chainsafe/lodestar-params/mainnet";

import {createIBeaconSSZTypes} from "../generators";
import {IBeaconSSZTypes} from "../interface";

export const types: IBeaconSSZTypes = createIBeaconSSZTypes(params);
