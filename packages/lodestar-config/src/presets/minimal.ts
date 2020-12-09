import {params} from "@chainsafe/lodestar-params/minimal";
import {types} from "@chainsafe/lodestar-types/lib/ssz/presets/minimal";

import {IBeaconConfig} from "../interface";

export const config: IBeaconConfig = {params, types};
export const minimalConfig = config;
