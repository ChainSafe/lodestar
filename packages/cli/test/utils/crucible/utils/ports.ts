import {
  BN_P2P_BASE_PORT,
  BN_REST_BASE_PORT,
  EL_ENGINE_BASE_PORT,
  EL_ETH_BASE_PORT,
  EL_P2P_BASE_PORT,
  KEY_MANAGER_BASE_PORT,
} from "../constants.js";

export const getNodePorts = (
  nodeIndex: number
): {
  beacon: {p2pPort: number; httpPort: number};
  validator: {keymanagerPort: number};
  execution: {p2pPort: number; enginePort: number; httpPort: number};
} => ({
  beacon: {
    // Stride by 2 to leave room for the QUIC port (p2pPort + 1)
    p2pPort: BN_P2P_BASE_PORT + 1 + nodeIndex * 2,
    httpPort: BN_REST_BASE_PORT + 1 + nodeIndex,
  },
  validator: {
    keymanagerPort: KEY_MANAGER_BASE_PORT + 1 + nodeIndex,
  },
  execution: {
    p2pPort: EL_P2P_BASE_PORT + 1 + nodeIndex,
    httpPort: EL_ETH_BASE_PORT + 1 + nodeIndex,
    enginePort: EL_ENGINE_BASE_PORT + 1 + nodeIndex,
  },
});
