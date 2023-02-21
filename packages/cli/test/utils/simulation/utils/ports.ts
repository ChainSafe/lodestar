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
  cl: {port: number; httpPort: number; keymanagerPort: number};
  el: {port: number; enginePort: number; httpPort: number};
} => ({
  cl: {
    port: BN_P2P_BASE_PORT + 1 + nodeIndex,
    httpPort: BN_REST_BASE_PORT + 1 + nodeIndex,
    keymanagerPort: KEY_MANAGER_BASE_PORT + 1 + nodeIndex,
  },
  el: {
    port: EL_P2P_BASE_PORT + 1 + nodeIndex,
    httpPort: EL_ETH_BASE_PORT + 1 + nodeIndex,
    enginePort: EL_ENGINE_BASE_PORT + 1 + nodeIndex,
  },
});
