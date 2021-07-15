/* eslint-disable @typescript-eslint/naming-convention */
import {IBeaconParamsUnparsed as altairDevnet1} from "../config/types";

/* eslint-disable max-len */

// https://github.com/eth2-clients/eth2-networks/blob/master/shared/altair-devnet-0/config.yaml
export const beaconParams: altairDevnet1 = {
  // Genesis
  MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: 10000,
  MIN_GENESIS_TIME: 1626264000,
  GENESIS_FORK_VERSION: "0x19504700",
  GENESIS_DELAY: 86400,

  // Altair
  ALTAIR_FORK_VERSION: "0x01000001",
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
  DEPOSIT_CONTRACT_ADDRESS: "0x5004957f885F5A5408e6Ff50B338435aD3fE4E17",
};

export const depositContractDeployBlock = 5110538;
export const genesisFileUrl =
  "https://github.com/eth2-clients/eth2-networks/raw/ffd194b93a1e69dc73e94e6f51ffc77efc86cd2c/shared/altair-devnet-1/genesis.ssz";
export const bootnodesFileUrl =
  "https://raw.githubusercontent.com/eth2-clients/eth2-networks/ffd194b93a1e69dc73e94e6f51ffc77efc86cd2c/shared/altair-devnet-1/bootstrap_nodes.txt";

export const bootEnrs = [
  // EF bootnode
  // /ip4/18.192.182.103/udp/9000/p2p/16Uiu2HAmVHXRwinNmyfyN9jVTR7wbKuGd8dEkSLX3iTQThpMNAXi
  "enr:-Ku4QJTSfjugOE_5xyEDYceUlHTd8QiP1QF5q4o6APwk9V7QXV6POQKfhXixhLNMI-_-tGRRorbzR_vMAFe_vQT5XWYBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpCFITryGVBHAP__________gmlkgnY0gmlwhBLAtmeJc2VjcDI1NmsxoQP3FwrhFYB60djwRjAoOjttq6du94DtkQuaN99wvgqaIYN1ZHCCIyg",
];
