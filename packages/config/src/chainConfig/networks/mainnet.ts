/* eslint-disable @typescript-eslint/naming-convention */
import {fromHexString as b} from "@chainsafe/ssz";
import {IChainConfig} from "../types.js";
import {chainConfig as mainnet} from "../presets/mainnet.js";

/* eslint-disable max-len */

export const mainnetChainConfig: IChainConfig = {
  ...mainnet,

  CONFIG_NAME: "mainnet",

  DEPOSIT_CONTRACT_ADDRESS: b("0x00000000219ab540356cBB839Cbe05303d7705Fa"),

  DEPOSIT_CHAIN_ID: 1,
  DEPOSIT_NETWORK_ID: 1,

  MIN_GENESIS_TIME: 1606824000, // Tuesday, December 1, 2020 12:00:00 PM UTC
  GENESIS_DELAY: 604800,
  // MUST NOT use `GENESIS_FORK_VERSION` here so for `minimal` networks the preset value of 0x00000001 take prevalence
  // GENESIS_FORK_VERSION: "0x00000000",

  // Transition
  // ---------------------------------------------------------------
  // Estimated: Sept 15, 2022
  TERMINAL_TOTAL_DIFFICULTY: BigInt("58750000000000000000000"),
  TERMINAL_BLOCK_HASH: b("0x0000000000000000000000000000000000000000000000000000000000000000"),
  TERMINAL_BLOCK_HASH_ACTIVATION_EPOCH: Infinity,

  // Forking
  // ---------------------------------------------------------------
  // Altair
  ALTAIR_FORK_VERSION: b("0x01000000"),
  ALTAIR_FORK_EPOCH: 74240, // Oct 27, 2021, 10:56:23am UTC
  // Bellatrix
  BELLATRIX_FORK_VERSION: b("0x02000000"),
  BELLATRIX_FORK_EPOCH: 144896, // Sept 6, 2022, 11:34:47am UTC

  // Capella
  CAPELLA_FORK_VERSION: b("0x03000000"),
  CAPELLA_FORK_EPOCH: Infinity,

  // EIP4844
  EIP4844_FORK_VERSION: b("0x04000000"),
  EIP4844_FORK_EPOCH: Infinity,
};
