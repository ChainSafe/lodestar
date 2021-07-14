/* eslint-disable @typescript-eslint/naming-convention */
import {IBeaconParamsUnparsed} from "../config/types";

/* eslint-disable max-len */

// https://github.com/eth2-clients/eth2-networks/blob/master/shared/altair-devnet-0/config.yaml
export const beaconParams: IBeaconParamsUnparsed = {
  // Genesis
  MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: 10000,
  MIN_GENESIS_TIME: 1625659200,
  GENESIS_FORK_VERSION: "0x19504699",
  GENESIS_DELAY: 86400,

  // Altair
  ALTAIR_FORK_VERSION: "0x01000000",
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
  DEPOSIT_CONTRACT_ADDRESS: "0x3fe221a147E62eC697723fBfB4dd9505F4F966c7",
};

export const depositContractDeployBlock = 5088851;
export const genesisFileUrl =
  "https://raw.githubusercontent.com/eth2-clients/eth2-networks/master/shared/altair-devnet-0/genesis.ssz";
export const bootnodesFileUrl =
  "https://raw.githubusercontent.com/eth2-clients/eth2-networks/master/shared/altair-devnet-0/bootstrap_nodes.txt";

export const bootEnrs = [
  //
  "enr:-Ku4QOcLld1mPvi9bXxN468zT5ZAX6zHFABOgm6-G76AFaC8C7yOAocpOBgRUKvuxLp-EBt3IqpOLUBZcTiou6VYmtoBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpBY9DG-GVBGmf______gmlkgnY0gmlwhAN9m_qJc2VjcDI1NmsxoQK_TT5hHmoWJpZ4aSv1bdoD5noop1fWU54qz4Tj53t_1oN1ZHCCIyg",
  // EF teku
  "enr:-KG4QJWdj4th2_oC7rMgH7nNybdi7P9Gnzfqv6ENpedZrXq9Gn1RRP-LdcVhlomknr3P5CTfx0KQtLnhKU-JOs8XSXcDhGV0aDKQkXh32wEAAAAKAAAAAAAAAIJpZIJ2NIJpcIQ2XbFniXNlY3AyNTZrMaED7ZfK5hmooNzNLz5NHOTu2oTS3cnoKs3MSOjOPnEN8W-DdGNwgiMog3VkcIIjKA",
  // EF lighthouse
  "enr:-Ly4QNMlT70UQgDEyLL4BvxlISnPVaU93tHUHaldxbnHUw8bdjCj3761O-2kC5Hi6r6jG_fj_NXR6IcLkeHSKVYNNKQBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpCReHfbAQAAAAoAAAAAAAAAgmlkgnY0gmlwhAN5uYSJc2VjcDI1NmsxoQO_K-H4t8YSeK2gKKREnbsYRisMAt9jRepsIn6N7FaD8IhzeW5jbmV0cwCDdGNwgiMog3VkcIIjKA",
];
