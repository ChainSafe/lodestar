import BN from "bn.js";

import {
  BeaconState,
  Crosslink,
} from "@chainsafe/eth2.0-types";

import {GENESIS_EPOCH, GENESIS_SLOT, GENESIS_START_SHARD, ZERO_HASH} from "../../src/constants";

import {hashTreeRoot} from "@chainsafe/ssz";
import {generateEmptyBlock} from "./block";
import {generateEmptyCrosslink} from "./crosslink";

import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import { BitVector } from "@chainsafe/bit-utils";

/**
 * Copy of BeaconState, but all fields are marked optional to allow for swapping out variables as needed.
 */
type TestBeaconState = Partial<BeaconState>;

/**
 * Generate beaconState, by default it will use the initial state defined when the `ChainStart` log is emitted.
 * NOTE: All fields can be overridden through `opts`.
 * @param {TestBeaconState} opts
 * @returns {BeaconState}
 */
export function generateState(opts?: TestBeaconState): BeaconState {
  const initialCrosslinkRecord: Crosslink = generateEmptyCrosslink();

  return {
    genesisTime: Math.floor(Date.now() / 1000),
    slot: GENESIS_SLOT,
    fork: {
      previousVersion: config.params.GENESIS_FORK_VERSION,
      currentVersion: config.params.GENESIS_FORK_VERSION,
      epoch: GENESIS_EPOCH,
    },
    latestBlockHeader: {
      slot: 0,
      parentRoot: Buffer.alloc(32),
      stateRoot: Buffer.alloc(32),
      bodyRoot: hashTreeRoot(generateEmptyBlock().body, config.types.BeaconBlockBody),
      signature: Buffer.alloc(96),
    },
    blockRoots: Array.from({length: config.params.SLOTS_PER_HISTORICAL_ROOT}, () => ZERO_HASH),
    stateRoots: Array.from({length: config.params.SLOTS_PER_HISTORICAL_ROOT}, () => ZERO_HASH),
    historicalRoots: [],
    eth1Data: {
      depositRoot: Buffer.alloc(32),
      blockHash: Buffer.alloc(32),
      depositCount: 0,
    },
    eth1DataVotes: [],
    eth1DepositIndex: 0,
    validators: [],
    balances: [],
    startShard: GENESIS_START_SHARD,
    randaoMixes: Array.from({length: config.params.EPOCHS_PER_HISTORICAL_VECTOR}, () => ZERO_HASH),
    activeIndexRoots: Array.from({length: config.params.EPOCHS_PER_HISTORICAL_VECTOR}, () => ZERO_HASH),
    compactCommitteesRoots: Array.from({length: config.params.EPOCHS_PER_HISTORICAL_VECTOR}, () => ZERO_HASH),
    slashings: Array.from({length: config.params.EPOCHS_PER_SLASHINGS_VECTOR}, () => new BN(0)),
    previousEpochAttestations: [],
    currentEpochAttestations: [],
    currentCrosslinks: Array.from({length: config.params.SHARD_COUNT}, () => initialCrosslinkRecord),
    previousCrosslinks: Array.from({length: config.params.SHARD_COUNT}, () => initialCrosslinkRecord),
    justificationBits: BitVector.fromBitfield(Buffer.alloc(1), 4),
    previousJustifiedCheckpoint: {
      epoch: GENESIS_EPOCH,
      root: ZERO_HASH,
    },
    currentJustifiedCheckpoint: {
      epoch: GENESIS_EPOCH,
      root: ZERO_HASH,
    },
    finalizedCheckpoint: {
      epoch: GENESIS_EPOCH,
      root: ZERO_HASH,
    },
    ...opts,
  };
}
