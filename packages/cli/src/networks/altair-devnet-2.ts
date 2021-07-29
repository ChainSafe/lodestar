/* eslint-disable @typescript-eslint/naming-convention */
import {IBeaconParamsUnparsed as altairDevnet2} from "../config/types";

/* eslint-disable max-len */

// https://github.com/eth2-clients/eth2-networks/blob/master/shared/altair-devnet-0/config.yaml
export const beaconParams: altairDevnet2 = {
  // Genesis
  MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: 13000,
  MIN_GENESIS_TIME: 1627473600,
  GENESIS_FORK_VERSION: "0x19504701",
  GENESIS_DELAY: 86400,

  // Altair
  ALTAIR_FORK_VERSION: "0x01000002",
  ALTAIR_FORK_EPOCH: 10,

  // Time parameters
  SECONDS_PER_SLOT: 12,
  SECONDS_PER_ETH1_BLOCK: 14,
  MIN_VALIDATOR_WITHDRAWABILITY_DELAY: 256,
  SHARD_COMMITTEE_PERIOD: 256,
  ETH1_FOLLOW_DISTANCE: 2048,

  // Validator cycle
  INACTIVITY_SCORE_BIAS: 4,
  INACTIVITY_SCORE_RECOVERY_RATE: 16,
  EJECTION_BALANCE: 16000000000,
  MIN_PER_EPOCH_CHURN_LIMIT: 4,
  CHURN_LIMIT_QUOTIENT: 65536,

  // Deposit contract
  DEPOSIT_CHAIN_ID: 5,
  DEPOSIT_NETWORK_ID: 5,
  DEPOSIT_CONTRACT_ADDRESS: "0xF40eb070317e56F243ea1968882d2938D4125a69",
};

export const depositContractDeployBlock = 5208017;
export const genesisFileUrl =
  "https://github.com/eth2-clients/eth2-networks/raw/51ee6ac4cef7ab8c208ae3466e00f694515bfcb2/shared/altair-devnet-2/genesis.ssz";
export const bootnodesFileUrl =
  "https://raw.githubusercontent.com/eth2-clients/eth2-networks/51ee6ac4cef7ab8c208ae3466e00f694515bfcb2/shared/altair-devnet-2/bootstrap_nodes.txt";

export const bootEnrs = [
  // EF bootnode
  // # /ip4/18.184.200.173/udp/9000/p2p/16Uiu2HAm8KdBVKsRWCGa2T5wpMjCVnYqvYDiN2CFJeEmmo3t3MbU
  "enr:-Ku4QLEvQ0IJnMGeZn1RsiPXvIho0LH8_XmHzq9FiF1uuwAdcFxt94-qfoT7VrBxU3-Nt7t-R3luvFhJlcCQI6VDV0oBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpCKO0zOGVBHAf__________gmlkgnY0gmlwhBK4yK2Jc2VjcDI1NmsxoQK_m0f1DzDc9Cjrspm36zuRa7072HSiMGYWLsKiVSbP34N1ZHCCIyg",
];
