import {config as chainConfig} from "@chainsafe/lodestar-config/default";
import {createIBeaconConfig} from "@chainsafe/lodestar-config";
import {ZERO_HASH} from "../../src/constants";

/** default config with ZERO_HASH as genesisValidatorsRoot */
export const config = createIBeaconConfig(chainConfig, ZERO_HASH);
