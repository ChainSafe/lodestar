/* eslint-disable @typescript-eslint/naming-convention */
import {fromHexString as b} from "@chainsafe/ssz";
import {ChainConfig} from "../types.js";
import {chainConfig as mainnet} from "../presets/mainnet.js";

// Ephemery dynamic beacon chain config:
// https://github.com/taxmeifyoucan/ephemeral-testnet/blob/master/specs.md

// Iteration 0, "base"-genesis
const ephemeryBaseChainConfig: ChainConfig = {
  ...mainnet,

  CONFIG_NAME: "ephemery",

  // Genesis
  // ---------------------------------------------------------------
  MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: 64,
  // # Thu Dec 02 2021 19:00:00 GMT+0000
  MIN_GENESIS_TIME: 1638471600,
  GENESIS_FORK_VERSION: b("0x1000101b"),
  GENESIS_DELAY: 300,

  // Forking
  // ---------------------------------------------------------------
  // # Altair
  ALTAIR_FORK_VERSION: b("0x2000101b"),
  ALTAIR_FORK_EPOCH: 0,
  // # Merge
  BELLATRIX_FORK_VERSION: b("0x3000101b"),
  BELLATRIX_FORK_EPOCH: 0,
  TERMINAL_TOTAL_DIFFICULTY: BigInt("0"),
  // Capella
  CAPELLA_FORK_VERSION: b("0x4000101b"),
  CAPELLA_FORK_EPOCH: 0,
  // Deneb
  DENEB_FORK_VERSION: b("0x5000101b"),

  // Deposit contract
  // ---------------------------------------------------------------
  DEPOSIT_CHAIN_ID: 39438000,
  DEPOSIT_NETWORK_ID: 39438000,
  DEPOSIT_CONTRACT_ADDRESS: b("0x4242424242424242424242424242424242424242"),

  // Ephemery settings
  ETH1_FOLLOW_DISTANCE: 12,
};

// Reset interval (2 days)
const ephemeryResetInterval: number = 604800;
const iteration = Math.floor(
  (Math.floor((new Date()).getTime() / 1000) - ephemeryBaseChainConfig.MIN_GENESIS_TIME) / ephemeryResetInterval
);

export const ephemeryChainConfig: ChainConfig = {
  ...ephemeryBaseChainConfig,

  MIN_GENESIS_TIME: ephemeryResetInterval * iteration + ephemeryBaseChainConfig.MIN_GENESIS_TIME,
  DEPOSIT_CHAIN_ID: ephemeryBaseChainConfig.DEPOSIT_CHAIN_ID + iteration,
  DEPOSIT_NETWORK_ID: ephemeryBaseChainConfig.DEPOSIT_NETWORK_ID + iteration,
};
