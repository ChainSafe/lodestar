/**
 * @module sszTypes/presets/mainnet
 */
import {params} from "@chainsafe/lodestar-params/mainnet";

import {createIBeaconSSZTypes, IBeaconSSZTypes} from "../IBeaconSSZTypes";

export const types: IBeaconSSZTypes = createIBeaconSSZTypes(params);
