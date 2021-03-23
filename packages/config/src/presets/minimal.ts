import {params} from "@chainsafe/lodestar-params/minimal";

import {createIBeaconConfig} from "../";

export const config = createIBeaconConfig(params);
export const minimalConfig = config;
