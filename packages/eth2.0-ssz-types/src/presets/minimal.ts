/**
 * @module sszTypes/presets/minimal
 */
import * as params from "@chainsafe/eth2.0-params/lib/presets/minimal";

import {createIBeaconSSZTypes} from "../generators";
import {IBeaconSSZTypes} from "../interface";

export const types: IBeaconSSZTypes = createIBeaconSSZTypes(params);
