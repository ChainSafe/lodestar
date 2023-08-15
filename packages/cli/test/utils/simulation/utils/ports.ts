import {
  BN_P2P_BASE_PORT,
  BN_REST_BASE_PORT,
  KEY_MANAGER_BASE_PORT,
  EL_P2P_BASE_PORT,
  EL_ETH_BASE_PORT,
  EL_ENGINE_BASE_PORT,
} from "../constants.js";

export const getNodePorts = (
  nodeIndex: number
): {
  beacon: {port: number; httpPort: number};
  validator: {keymanagerPort: number};
  execution: {port: number; enginePort: number; httpPort: number};
} => ({
  beacon: {
    port: BN_P2P_BASE_PORT + 1 + nodeIndex,
    httpPort: BN_REST_BASE_PORT + 1 + nodeIndex,
  },
  validator: {
    keymanagerPort: KEY_MANAGER_BASE_PORT + 1 + nodeIndex,
  },
  execution: {
    port: EL_P2P_BASE_PORT + 1 + nodeIndex,
    httpPort: EL_ETH_BASE_PORT + 1 + nodeIndex,
    enginePort: EL_ENGINE_BASE_PORT + 1 + nodeIndex,
  },
});
