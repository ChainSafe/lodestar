import BN from "bn.js";

import {GENESIS_EPOCH, GENESIS_FORK_VERSION, GENESIS_SLOT, GENESIS_START_SHARD, LATEST_ACTIVE_INDEX_ROOTS_LENGTH,
  LATEST_BLOCK_ROOTS_LENGTH, LATEST_RANDAO_MIXES_LENGTH, LATEST_SLASHED_EXIT_LENGTH, SHARD_COUNT, ZERO_HASH} from "../../src/constants";
import {BeaconState, Crosslink, Eth1Data, Fork, PendingAttestation, uint64, Validator, Slot, number64, Epoch, Shard} from "../../src/types";
import {bytes32, Eth1DataVote} from "../../src/types";
import {randBetween, randBetweenBN} from "./misc";
import {generateValidators} from "./validator";

/**
 * Copy of BeaconState, but all fields are marked optional to allow for swapping out variables as needed.
 */
interface TestBeaconState {
  // Misc
  slot?: Slot;
  genesisTime?: number64;
  fork?: Fork; // For versioning hard forks

  // Validator registry
  validatorRegistry?: Validator[];
  validatorBalances?: uint64[];
  validatorRegistryUpdateEpoch?: Epoch;

  // Randomness and committees
  latestRandaoMixes?: bytes32[];
  previousEpochStartShard?: Shard;
  currentEpochStartShard?: Shard;
  previousCalculationEpoch?: Epoch;
  currentCalculationEpoch?: Epoch;
  previousEpochSeed?: bytes32;
  currentEpochSeed?: bytes32;

  // Finality
  previousJustifiedEpoch?: Epoch;
  justifiedEpoch?: Epoch;
  justificationBitfield?: uint64;
  finalizedEpoch?: Epoch;

  // Recent state
  latestCrosslinks?: Crosslink[];
  latestBlockRoots?: bytes32[];
  latestIndexRoots?: bytes32[];
  latestPenalizedBalances?: uint64[]; // Balances penalized at every withdrawal period
  latestAttestations?: PendingAttestation[];
  batchedBlockRoots?: bytes32[];

  // Ethereum 1.0 deposit root
  latestEth1Data?: Eth1Data;
  eth1DataVotes?: Eth1DataVote[];
}

/**
 * Generate beaconState, by default it will use the initial state defined when the `ChainStart` log is emitted.
 * NOTE: All fields can be overridden through `opts`.
 * @param {TestBeaconState} opts
 * @returns {BeaconState}
 */
export function generateState(opts?: TestBeaconState): BeaconState {
  const initialCrosslinkRecord: Crosslink = {
    epoch: GENESIS_EPOCH,
    shardBlockRoot: ZERO_HASH,
  };

  return {
    // MISC
    slot: GENESIS_SLOT,
    genesisTime: Math.floor(Date.now() / 1000),
    fork: {
      previousVersion: GENESIS_FORK_VERSION,
      currentVersion: GENESIS_FORK_VERSION,
      epoch: GENESIS_EPOCH,
    },
    // Validator registry
    validatorRegistry: [],
    validatorBalances: [],
    validatorRegistryUpdateEpoch: GENESIS_EPOCH,

    // Randomness and committees
    latestRandaoMixes: Array.from({length: LATEST_RANDAO_MIXES_LENGTH}, () => ZERO_HASH),
    previousShufflingStartShard: GENESIS_START_SHARD,
    currentShufflingStartShard: GENESIS_START_SHARD,
    previousShufflingEpoch: GENESIS_EPOCH,
    currentShufflingEpoch: GENESIS_EPOCH,
    previousShufflingSeed: ZERO_HASH,
    currentShufflingSeed: ZERO_HASH,

    // Finality
    previousJustifiedEpoch: GENESIS_EPOCH,
    justifiedEpoch: GENESIS_EPOCH,
    justificationBitfield: new BN(0),
    finalizedEpoch: GENESIS_EPOCH,

    // Recent state
    latestCrosslinks: Array.from({length: SHARD_COUNT}, () => initialCrosslinkRecord),
    latestBlockRoots: Array.from({length: LATEST_BLOCK_ROOTS_LENGTH}, () => ZERO_HASH),
    latestActiveIndexRoots: Array.from({length: LATEST_ACTIVE_INDEX_ROOTS_LENGTH}, () => ZERO_HASH),
    latestSlashedBalances: Array.from({length: LATEST_SLASHED_EXIT_LENGTH}, () => new BN(0)),
    latestAttestations: [],
    batchedBlockRoots: [],

    // PoW receipt root
    latestEth1Data: {
      depositRoot: Buffer.alloc(32),
      blockHash: Buffer.alloc(32),
    },
    eth1DataVotes: [],
    depositIndex: 0,
    ...opts,
  };
}

/**
 * Generates a random beacon state, with the option to override on or more parameters.
 * TODO: Should check to make sure that if a field is changed the appropriate conditions are met, BeaconState should be valid.
 * @param {TestBeaconState} opts
 * @returns {BeaconState}
 */
export function generateRandomState(opts?: TestBeaconState): BeaconState {
  const initialCrosslinkRecord: Crosslink = {
    epoch: randBetween(0, 1000),
    shardBlockRoot: Buffer.alloc(32),
  };

  const validatorNum: number = randBetween(0, 1000);

  return {
    // MISC
    slot: randBetween(0, 1000),
    genesisTime: Math.floor(Date.now() / 1000),
    fork: {
      previousVersion: randBetweenBN(0, 1000),
      currentVersion: randBetweenBN(0, 1000),
      epoch: randBetween(0, 1000),
    },
    // Validator registry
    validatorRegistry: generateValidators(validatorNum),
    validatorBalances: Array.from({length: validatorNum}, () => randBetweenBN(0, 1000)),
    validatorRegistryUpdateEpoch: randBetween(0, 1000),

    // Randomness and committees
    latestRandaoMixes: Array.from({length: randBetween(0, 1000)}, () => Buffer.alloc(32)),
    previousShufflingStartShard: randBetween(0, 1000),
    currentShufflingStartShard: randBetween(0, 1000),
    previousShufflingEpoch: randBetween(0, 1000),
    currentShufflingEpoch: randBetween(0, 1000),
    previousShufflingSeed: Buffer.alloc(32),
    currentShufflingSeed: Buffer.alloc(32),

    // Finality
    previousJustifiedEpoch: randBetween(0, 1000),
    justifiedEpoch: randBetween(0, 1000),
    justificationBitfield: randBetweenBN(0, 1000),
    finalizedEpoch: randBetween(0, 1000),

    latestCrosslinks: Array.from({length: randBetween(0, 1000)}, () => initialCrosslinkRecord),
    latestBlockRoots: Array.from({length: randBetween(0, 1000)}, () => Buffer.alloc(32)),
    latestActiveIndexRoots: Array.from({length: randBetween(0, 1000)}, () => Buffer.alloc(32)),
    latestSlashedBalances: Array.from({length: randBetween(0, 1000)}, () => randBetweenBN(0, 1000)),
    latestAttestations: [],
    batchedBlockRoots: Array.from({length: randBetween(0, 1000)}, () => Buffer.alloc(32)),

    // PoW receipt root
    latestEth1Data: {
      depositRoot: Buffer.alloc(32),
      blockHash: Buffer.alloc(32),
    },
    eth1DataVotes: [],
    depositIndex: 0,
    ...opts,
  };
}
