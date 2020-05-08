/**
 * @module sszTypes/presets/schlesi
 */
import {params} from "@chainsafe/lodestar-params/lib/presets/schlesi";

import {createIBeaconSSZTypes} from "../generators";
import {IBeaconSSZTypes} from "../interface";

export const types: IBeaconSSZTypes = createIBeaconSSZTypes(params);
