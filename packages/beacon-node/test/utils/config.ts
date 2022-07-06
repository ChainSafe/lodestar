import {config as chainConfig} from "@lodestar/config/default";
import {createIBeaconConfig} from "@lodestar/config";
import {ZERO_HASH} from "../../src/constants/index.js";

/** default config with ZERO_HASH as genesisValidatorsRoot */
export const config = createIBeaconConfig(chainConfig, ZERO_HASH);
