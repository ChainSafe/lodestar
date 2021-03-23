/**
 * @module sszTypes/presets/minimal
 */
import {params} from "@chainsafe/lodestar-params/minimal";

import {createIBeaconSSZTypes, IBeaconSSZTypes} from "../IBeaconSSZTypes";

export const types: IBeaconSSZTypes = createIBeaconSSZTypes(params);
