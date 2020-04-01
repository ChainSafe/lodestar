/**
 * @module sszTypes/presets/minimal
 */
import {params} from "@chainsafe/lodestar-params/lib/presets/minimal";

import {createIBeaconSSZTypes} from "../generators";
import {IBeaconSSZTypes} from "../interface";

export const types: IBeaconSSZTypes = createIBeaconSSZTypes(params);
