/* eslint-disable @typescript-eslint/naming-convention */
import {IBeaconParamsUnparsed} from "../config/types";

/* eslint-disable max-len */

// https://github.com/eth2-clients/eth2-networks/blob/master/teku/yeerongpilly/config.yaml
export const beaconParams: IBeaconParamsUnparsed = {
  // Genesis
  MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: 128,
  MIN_GENESIS_TIME: 1621504614,
  GENESIS_FORK_VERSION: "0x00004105",
  GENESIS_DELAY: 1100642,

  // Altair
  ALTAIR_FORK_VERSION: "0x01004105",
  ALTAIR_FORK_EPOCH: 20,

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
  DEPOSIT_CONTRACT_ADDRESS: "0x2cc88381fe23027743c1f85512bffb383acca7c7",
};

export const depositContractDeployBlock = 4823811;
export const genesisFileUrl =
  "https://raw.githubusercontent.com/eth2-clients/eth2-networks/master/teku/yeerongpilly/genesis.ssz";
export const bootnodesFileUrl =
  "https://raw.githubusercontent.com/eth2-clients/eth2-networks/master/teku/yeerongpilly/boot_enr.yaml";

export const bootEnrs = [
  // /ip4/3.22.225.182/tcp/9000/p2p/16Uiu2HAm38TaD1PioNnaF6c9rKD1BLy5tYXGk4W9KxKaymJ7M1Z8
  "enr:-KG4QNFYe_ASIxDXpZXtzyZcndMr1QyQnAr0EXXgJq8qj1UaS8TNK_LYyG-B14RkMfDRUEhF3bihIjfeyVNZYGgjL8EDhGV0aDKQf_nhygAAQQX__________4JpZIJ2NIJpcIQDFuG2iXNlY3AyNTZrMaECcnSX6eiDjA01nO4vSzHEiAz5h95HUBL6KqSehXmvUGeDdGNwgiMog3VkcIIjKA",
  // /ip4/3.19.234.148/tcp/9000/p2p/16Uiu2HAm9LZ7zHsZW54jyTfh5Kzhvosw7dumcKYX4sVqHh7cP72D
  "enr:-KG4QPWCj_yDwL5APPetgWzVbkKmhFAVL9iZOI14cpiorPDLIKl1htlOJ4_R8zS1MFcnoJRMmMTxBbHXpjwpc_A3Nn4DhGV0aDKQf_nhygAAQQX__________4JpZIJ2NIJpcIQDE-qUiXNlY3AyNTZrMaECzrP1L8i28thLTEwnCIUgEanpCVQbHZe0Bb3crPc2o36DdGNwgiMog3VkcIIjKA",
];
