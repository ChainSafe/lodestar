import {fromHex as b} from "@lodestar/utils";
import {chainConfig as mainnet} from "../configs/mainnet.js";
import {ChainConfig} from "../types.js";

// Ephemery is a periodically-resetting testnet (EIP-6916):
// https://eips.ethereum.org/EIPS/eip-6916
//
// The values below track the ephemery iteration published in ephemery-genesis
// `values.env`, pinned to iteration 164:
// https://github.com/ephemery-testnet/ephemery-genesis/blob/a4b5a2ee5c1c40e378edc92f2ccd9938cf9207d0/values.env
//   GENESIS_TIMESTAMP=1790276400 -> MIN_GENESIS_TIME
//   CHAIN_ID=39438164            -> DEPOSIT_CHAIN_ID / DEPOSIT_NETWORK_ID
//   GENESIS_DELAY=600
// `cl-config.yaml` maps these to the beacon chain config:
// https://github.com/ephemery-testnet/ephemery-genesis/blob/master/cl-config.yaml
//
// GENESIS_DELAY was raised 300 -> 600 upstream in ephemery-genesis f761969
// ("update genesis generator, new release layout", 2024-06-28):
// https://github.com/ephemery-testnet/ephemery-genesis/commit/f761969dd0c827af58f6b19c4fce0f5298fe8f65
const baseChainConfig: ChainConfig = {
  ...mainnet,

  CONFIG_NAME: "ephemery",

  // Genesis
  // ---------------------------------------------------------------
  MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: 64,
  // GENESIS_TIMESTAMP (Thu Sep 24 2026 19:00:00 GMT+0000)
  MIN_GENESIS_TIME: 1790276400,
  GENESIS_FORK_VERSION: b("0x1000101b"),
  GENESIS_DELAY: 600,

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
  DENEB_FORK_EPOCH: 0,
  // Electra
  ELECTRA_FORK_VERSION: b("0x6000101b"),
  ELECTRA_FORK_EPOCH: 0,
  // Fulu
  FULU_FORK_VERSION: b("0x7000101b"),
  FULU_FORK_EPOCH: 0,
  // Gloas
  GLOAS_FORK_VERSION: b("0x8000101b"),
  GLOAS_FORK_EPOCH: Infinity,

  // Deposit contract
  // ---------------------------------------------------------------
  DEPOSIT_CHAIN_ID: 39438164,
  DEPOSIT_NETWORK_ID: 39438164,

  ETH1_FOLLOW_DISTANCE: 12,

  // Blob Scheduling
  // ---------------------------------------------------------------
  BLOB_SCHEDULE: [
    {
      EPOCH: 2048,
      MAX_BLOBS_PER_BLOCK: 12,
    },
    {
      EPOCH: 4096,
      MAX_BLOBS_PER_BLOCK: 15,
    },
  ],
};

// Ephemery reset interval (28 days) in seconds, from ephemery-genesis `values.env`
// GENESIS_INTERVAL. Raised from 7 days (604800) in ephemery-genesis 131d330
// ("increase reset interval to 28days (2419200 sec)", 2024-06-28):
// https://github.com/ephemery-testnet/ephemery-genesis/commit/131d330aab546ed2564b81be14981776cf8b1e2c
const RESET_INTERVAL_SECONDS = 2419200;

/**
 * Ephemery resets its genesis on a fixed interval; each reset advances
 * `MIN_GENESIS_TIME` by one interval and increments the deposit chain/network id by
 * one. Resolve the iteration active at `nowMs` — the most recent reset at or before
 * `nowMs` — relative to the bundled base. `values.env` stages the upcoming iteration
 * ahead of its activation, so `iterations` is negative while that staged iteration is
 * still in the future and the previous one is live.
 *
 * Every process started within the same iteration derives identical whole-second
 * values, regardless of when in the iteration it starts (the bug in #10160 leaked
 * per-process start time into these values).
 */
export function getEphemeryChainConfig(nowMs: number = Date.now()): ChainConfig {
  const nowSeconds = Math.floor(nowMs / 1000);
  const iterations = Math.floor((nowSeconds - baseChainConfig.MIN_GENESIS_TIME) / RESET_INTERVAL_SECONDS);

  return {
    ...baseChainConfig,
    MIN_GENESIS_TIME: baseChainConfig.MIN_GENESIS_TIME + iterations * RESET_INTERVAL_SECONDS,
    DEPOSIT_CHAIN_ID: baseChainConfig.DEPOSIT_CHAIN_ID + iterations,
    DEPOSIT_NETWORK_ID: baseChainConfig.DEPOSIT_NETWORK_ID + iterations,
  };
}

export const ephemeryChainConfig: ChainConfig = getEphemeryChainConfig();
