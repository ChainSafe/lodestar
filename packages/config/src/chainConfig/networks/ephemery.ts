import {fromHex as b} from "@lodestar/utils";
import {ChainConfig} from "../types.js";
import {chainConfig as mainnet} from "../configs/mainnet.js";

// Ephemery dynamic beacon chain config:
// https://github.com/ephemery-testnet/ephemery-genesis/blob/master/cl-config.yaml

// Ephemery specification:
// https://eips.ethereum.org/EIPS/eip-6916

// iteration 0, "base"-genesis
const baseChainConfig: ChainConfig = {
  ...mainnet,

  CONFIG_NAME: "ephemery",

  // Genesis
  // ---------------------------------------------------------------
  MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: 64,
  // Thu Dec 02 2021 19:00:00 GMT+0000
  MIN_GENESIS_TIME: 1638471600,
  GENESIS_FORK_VERSION: b("0x1000101b"),
  GENESIS_DELAY: 300,

  // Forking
  // ---------------------------------------------------------------
  // Altair
  ALTAIR_FORK_VERSION: b("0x2000101b"),
  ALTAIR_FORK_EPOCH: 0,
  // Merge
  BELLATRIX_FORK_VERSION: b("0x3000101b"),
  BELLATRIX_FORK_EPOCH: 0,
  TERMINAL_TOTAL_DIFFICULTY: BigInt("0"),
  // Capella
  CAPELLA_FORK_VERSION: b("0x4000101b"),
  CAPELLA_FORK_EPOCH: 0,
  // Deneb
  DENEB_FORK_VERSION: b("0x5000101b"),
  DENEB_FORK_EPOCH: 5,

  // Deposit contract
  // ---------------------------------------------------------------
  DEPOSIT_CHAIN_ID: 39438000,
  DEPOSIT_NETWORK_ID: 39438000,
  DEPOSIT_CONTRACT_ADDRESS: b("0x4242424242424242424242424242424242424242"),

  ETH1_FOLLOW_DISTANCE: 12,
};

// Reset interval (7 days) in milliseconds, based on ephemery-genesis values.env:
// https://github.com/ephemery-testnet/ephemery-genesis/blob/9a28fbef950c8547d78785f8a0ea49a95ce19a48/values.env#L5
const RESET_INTERVAL_MS = 604800000;
const iteration = Math.floor(Date.now() - baseChainConfig.MIN_GENESIS_TIME) / RESET_INTERVAL_MS;

export const ephemeryChainConfig: ChainConfig = {
  ...baseChainConfig,

  MIN_GENESIS_TIME: RESET_INTERVAL_MS * iteration + baseChainConfig.MIN_GENESIS_TIME,
  DEPOSIT_CHAIN_ID: baseChainConfig.DEPOSIT_CHAIN_ID + iteration,
  DEPOSIT_NETWORK_ID: baseChainConfig.DEPOSIT_NETWORK_ID + iteration,
};
