/* eslint-disable @typescript-eslint/naming-convention */
import {IBeaconParamsUnparsed} from "../config/types";

/* eslint-disable max-len */

export const beaconParams: IBeaconParamsUnparsed = {
  // phase0

  MIN_PER_EPOCH_CHURN_LIMIT: 4,
  CHURN_LIMIT_QUOTIENT: 65536,
  MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: 128,
  MIN_GENESIS_TIME: 1621504614,
  ETH1_FOLLOW_DISTANCE: 2048,
  SECONDS_PER_ETH1_BLOCK: 14,
  DEPOSIT_CHAIN_ID: 5,
  DEPOSIT_NETWORK_ID: 5,
  DEPOSIT_CONTRACT_ADDRESS: "0x2cc88381fe23027743c1f85512bffb383acca7c7",
  EJECTION_BALANCE: 16000000000,
  GENESIS_FORK_VERSION: "0x00004151",
  GENESIS_DELAY: 1020129,
  SECONDS_PER_SLOT: 12,
  MIN_VALIDATOR_WITHDRAWABILITY_DELAY: 256,
  SHARD_COMMITTEE_PERIOD: 256,

  // altair

  INACTIVITY_SCORE_BIAS: 4,
  INACTIVITY_SCORE_RECOVERY_RATE: 16,
  ALTAIR_FORK_VERSION: "0x01004151",
  ALTAIR_FORK_EPOCH: 10,
};

export const depositContractDeployBlock = 4823811;
export const genesisFileUrl =
  "https://raw.githubusercontent.com/ajsutton/eth2-networks/4a58c1852e3add6551b5cae3f260087efd6078e4/teku/coorparoo/genesis.ssz";
export const bootnodesFileUrl =
  "https://raw.githubusercontent.com/ajsutton/eth2-networks/4a58c1852e3add6551b5cae3f260087efd6078e4/teku/coorparoo/boot_enr.yaml";

export const bootEnrs = [
  // /ip4/18.216.199.235/tcp/9000/p2p/16Uiu2HAm9e3CaYN8XxvjFEyHFd1aiE3FUTfMpL6Z2vMfnBQieXVs
  "enr:-KG4QGtLfpaTMJKBD8_VTE0ZBf24KoVrnT-Toc5K6IuQwUm2WQShEmmjEwZc1B3J3muXaDoIYt3Qty9xEFCdvKeOq1sDhGV0aDKQFmWbwwAAQVH__________4JpZIJ2NIJpcIQS2MfriXNlY3AyNTZrMaEC0y6UqTmdr_Jw_4L_bi1Tlp9i-WT5T8MKHs0r77RUonqDdGNwgiMog3VkcIIjKA",
  // /ip4/18.222.144.13/tcp/9000/p2p/16Uiu2HAmAt2JM9UjsFMUHkqmN51dE7bHTsmoqbTKcM6QeJceuVm
  "enr:-KG4QOWkRj93eXbzMLc6Jvps6lXzlIq6CFmYQJV93QtkglAUf6C2myzSU8Zzay1iYxvQp0w3FD5XLQnitMtIIEwhJwgDhGV0aDKQFmWbwwAAQVH__________4JpZIJ2NIJpcIQS3pANiXNlY3AyNTZrMaEC5Z9hdyMHa64JhYZFVf40uI9BnzKWd2Y_NNG9sUcs0gWDdGNwgiMog3VkcIIjKA",
];
