/* eslint-disable @typescript-eslint/naming-convention */
import {fromHexString as b} from "@chainsafe/ssz";
import {mainnetChainConfig} from "@chainsafe/lodestar-config/presets";
import {IChainConfig} from "@chainsafe/lodestar-config";

/* eslint-disable max-len */

// https://github.com/eth2-clients/eth2-networks/blob/master/shared/altair-devnet-3/config.yaml
export const chainConfig: IChainConfig = {
  ...mainnetChainConfig,

  // Genesis
  MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: 50000,
  MIN_GENESIS_TIME: 1628604000,
  GENESIS_FORK_VERSION: b("0x19504702"),
  GENESIS_DELAY: 86400,

  // Altair
  ALTAIR_FORK_VERSION: b("0x01000003"),
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
  DEPOSIT_CONTRACT_ADDRESS: b("0x0C862A922512A5416713421DD95ccE5a07AA80ff"),
};

export const depositContractDeployBlock = 5288493;
export const genesisFileUrl =
  "https://github.com/eth2-clients/eth2-networks/raw/master/shared/altair-devnet-3/genesis.ssz";
export const bootnodesFileUrl =
  "https://raw.githubusercontent.com/eth2-clients/eth2-networks/master/shared/altair-devnet-3/bootstrap_nodes.txt";

export const bootEnrs = [
  // EF bootnode
  "enr:-Ku4QPeL6hPO1kx7zTO-lwv557APsMDLcLkDBYiPdnZxMiJHaeGs6wbJwW_PxVCmum0HemFQFFEmEwBbMlNwyKY560EBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpB2hCWsGVBHAv__________gmlkgnY0gmlwhANBGnSJc2VjcDI1NmsxoQLdRlI8aCa_ELwTJhVN8k7km7IDc3pYu-FMYBs5_FiigIN1ZHCCIyg",
];
