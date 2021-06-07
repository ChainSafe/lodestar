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
  GENESIS_FORK_VERSION: "0x00004811",
  GENESIS_DELAY: 1100642,
  SECONDS_PER_SLOT: 12,
  MIN_VALIDATOR_WITHDRAWABILITY_DELAY: 256,
  SHARD_COMMITTEE_PERIOD: 256,

  // altair

  INACTIVITY_SCORE_BIAS: 4,
  INACTIVITY_SCORE_RECOVERY_RATE: 16,
  ALTAIR_FORK_VERSION: "0x01004811",
  ALTAIR_FORK_EPOCH: 10,
};

export const depositContractDeployBlock = 4823811;
export const genesisFileUrl =
  "https://raw.githubusercontent.com/eth2-clients/eth2-networks/master/teku/oonoonba/genesis.ssz";
export const bootnodesFileUrl =
  "https://raw.githubusercontent.com/eth2-clients/eth2-networks/master/teku/oonoonba/boot_enr.yaml";

export const bootEnrs = [
  // /ip4/18.216.199.235/tcp/9000/p2p/16Uiu2HAm5nt57D6THGW2tRTLjCjAizk83DuLNMv6NTabdzEAGj7C
  "enr:-KG4QLXhcaTSEqPF-g5T_t-7NJJ6DQTHy8yCV-vvjJHU7jwOUpGMdIcvlKB4roS9qG1mi-P38Pvq1GkHYblRpOvfi6UDhGV0aDKQk_tI4gEASBEKAAAAAAAAAIJpZIJ2NIJpcIQS2MfriXNlY3AyNTZrMaECmgO9ATicNnBAl0Z1wKtbfvVlxv70aiJ7Obx_bFyhGpeDdGNwgiMog3VkcIIjKA",
  // /ip4/18.222.144.13/tcp/9000/p2p/16Uiu2HAmVVTsqNyKU9kuf71ZCRq3zFkFUpDaukdRaiGwSDGLq5MF
  "enr:-KG4QKHoILkdRrVT253n_S_cWB9K27hKGfQBUjT7Vw_dpTj2Y7BtIcEshnlj4fERg9IDer8CzwLjpCM809ZJ0Qym7dMDhGV0aDKQk_tI4gEASBEKAAAAAAAAAIJpZIJ2NIJpcIQS3pANiXNlY3AyNTZrMaED-iX-fx0c0RglNfwWG7N-K3oI-3JXM2O0Nyd67D5U1raDdGNwgiMog3VkcIIjKA",
];
