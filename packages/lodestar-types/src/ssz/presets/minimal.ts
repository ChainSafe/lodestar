/**
 * @module sszTypes/presets/minimal
 */
import {params} from "@chainsafe/lodestar-params/minimal";

import {createIBeaconSSZTypes} from "../generators";
import {IBeaconSSZTypes} from "../interface";

export const types: IBeaconSSZTypes = createIBeaconSSZTypes(params);
