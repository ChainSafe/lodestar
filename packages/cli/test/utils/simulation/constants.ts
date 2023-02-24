// Global variable __dirname no longer available in ES6 modules.
// Solutions: https://stackoverflow.com/questions/46745014/alternative-for-dirname-in-node-js-when-using-es6-modules
// eslint-disable-next-line @typescript-eslint/naming-convention
export const __dirname = path.dirname(fileURLToPath(import.meta.url));

import path from "node:path";
import {fileURLToPath} from "node:url";

export const FAR_FUTURE_EPOCH = 10 ** 12;
export const BN_P2P_BASE_PORT = 4000;
export const BN_REST_BASE_PORT = 5000;
export const KEY_MANAGER_BASE_PORT = 6000;
export const EXTERNAL_SIGNER_BASE_PORT = 7000;
export const EL_ETH_BASE_PORT = 8000;
export const EL_ENGINE_BASE_PORT = 9000;
export const EL_P2P_BASE_PORT = 9050;
export const SIM_TESTS_SECONDS_PER_SLOT = 4;
export const CLIQUE_SEALING_PERIOD = 5; // 5 seconds
export const ETH_TTD_INCREMENT = 2;
export const SIM_ENV_CHAIN_ID = 1234;
export const SIM_ENV_NETWORK_ID = 1234;
export const LODESTAR_BINARY_PATH = `${__dirname}/../../../bin/lodestar.js`;
export const MOCK_ETH1_GENESIS_HASH = "0xfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfb";
export const SHARED_JWT_SECRET = "0xdc6457099f127cf0bac78de8b297df04951281909db4f58b43def7c7151e765d";
export const SHARED_VALIDATOR_PASSWORD = "passwrod";
