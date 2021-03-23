import {params} from "@chainsafe/lodestar-params/mainnet";

import {createIBeaconConfig} from "../";

export const config = createIBeaconConfig(params);
export const mainnetConfig = config;
