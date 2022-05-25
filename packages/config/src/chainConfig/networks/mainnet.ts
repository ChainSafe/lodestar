/* eslint-disable @typescript-eslint/naming-convention */
import {fromHexString as b} from "@chainsafe/ssz";
import {IChainConfig} from "../types.js";
import {chainConfig as mainnet} from "../presets/mainnet.js";

/* eslint-disable max-len */

export const mainnetChainConfig: IChainConfig = {
  ...mainnet,

  DEPOSIT_CONTRACT_ADDRESS: b("0x00000000219ab540356cBB839Cbe05303d7705Fa"),

  DEPOSIT_CHAIN_ID: 1,
  DEPOSIT_NETWORK_ID: 1,

  MIN_GENESIS_TIME: 1606824000, // Tuesday, December 1, 2020 12:00:00 PM UTC
  GENESIS_DELAY: 604800,
  // MUST NOT use `GENESIS_FORK_VERSION` here so for `minimal` networks the preset value of 0x00000001 take prevalence
  // GENESIS_FORK_VERSION: "0x00000000",
};
