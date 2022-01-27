/* eslint-disable @typescript-eslint/naming-convention */
import {fromHexString as b} from "@chainsafe/ssz";
import {IChainConfig} from "../types";
import {chainConfig as mainnet} from "../presets/mainnet";

/* eslint-disable max-len */

export const kintsugiChainConfig: IChainConfig = {
  ...mainnet,

  MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: 72100,
  // Dec 16th, 2021, 13:00 UTC
  MIN_GENESIS_TIME: 1639659600,
  // Gensis fork
  GENESIS_FORK_VERSION: b("0x60000069"),
  // 300 seconds (5 min)
  GENESIS_DELAY: 300,

  // Forking
  ALTAIR_FORK_VERSION: b("0x61000070"),
  ALTAIR_FORK_EPOCH: 10,
  // Bellatrix
  BELLATRIX_FORK_VERSION: b("0x62000071"),
  BELLATRIX_FORK_EPOCH: 20,
  TERMINAL_TOTAL_DIFFICULTY: BigInt(5000000000),
  // Sharding
  SHARDING_FORK_VERSION: b("0x03000000"),
  SHARDING_FORK_EPOCH: Infinity,

  // Time parameters
  // ---------------------------------------------------------------
  // 16 blocks is ~190s
  ETH1_FOLLOW_DISTANCE: 16,

  // Deposit contract
  // ---------------------------------------------------------------
  // Custom Ethereum testnet
  DEPOSIT_CHAIN_ID: 1337702,
  DEPOSIT_NETWORK_ID: 1337702,
  DEPOSIT_CONTRACT_ADDRESS: b("0x4242424242424242424242424242424242424242"),
};
