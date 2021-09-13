/* eslint-disable @typescript-eslint/naming-convention */
import {fromHexString as b} from "@chainsafe/ssz";
import {IChainConfig} from "..";
import {chainConfig as mainnet} from "../presets/mainnet";

/* eslint-disable max-len */

export const pyrmontChainConfig: IChainConfig = {
  ...mainnet,

  DEPOSIT_CONTRACT_ADDRESS: b("0x8c5fecdC472E27Bc447696F431E425D02dd46a8c"),

  // Ethereum Goerli testnet
  DEPOSIT_CHAIN_ID: 5,
  DEPOSIT_NETWORK_ID: 5,

  MIN_GENESIS_TIME: 1605700800, // Wednesday, November 18, 2020 12:00:00 PM UTC
  GENESIS_DELAY: 432000,
  GENESIS_FORK_VERSION: b("0x00002009"),

  // Altair
  ALTAIR_FORK_VERSION: b("0x01002009"),
  ALTAIR_FORK_EPOCH: 61650,

  // Validator cycle
  INACTIVITY_SCORE_BIAS: 4,
  INACTIVITY_SCORE_RECOVERY_RATE: 16,
  EJECTION_BALANCE: 16000000000,
  MIN_PER_EPOCH_CHURN_LIMIT: 4,
  CHURN_LIMIT_QUOTIENT: 65536,
};
