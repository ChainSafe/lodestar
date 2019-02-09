import {SHARD_COUNT, GENESIS_EPOCH, ZERO_HASH, GENESIS_SLOT, GENESIS_FORK_VERSION, GENESIS_START_SHARD, LATEST_RANDAO_MIXES_LENGTH, LATEST_BLOCK_ROOTS_LENGTH, LATEST_INDEX_ROOTS_LENGTH, LATEST_PENALIZED_EXIT_LENGTH} from "../../constants";
import {BeaconState, Crosslink, Eth1Data, Fork, PendingAttestation, uint64, Validator} from "../../types";
import {Eth1DataVote, bytes32} from "../../types";
import {generateValidators} from "./validator";

/**
 * Copy of BeaconState, but all fields are marked optional to allow for swapping out variables as needed.
 */
interface TestBeaconState {
  // Misc
  slot?: uint64;
  genesisTime?: uint64;
  fork?: Fork; // For versioning hard forks

  // Validator registry
  validatorRegistry?: Validator[];
  validatorBalances?: uint64[];
  validatorRegistryUpdateEpoch?: uint64;

  // Randomness and committees
  latestRandaoMixes?: bytes32[];
  previousEpochStartShard?: uint64;
  currentEpochStartShard?: uint64;
  previousCalculationEpoch?: uint64;
  currentCalculationEpoch?: uint64;
  previousEpochSeed?: bytes32;
  currentEpochSeed?: bytes32;

  // Finality
  previousJustifiedEpoch?: uint64;
  justifiedEpoch?: uint64;
  justificationBitfield?: uint64;
  finalizedEpoch?: uint64;

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
 * NOTE: All fields can be ovverriden through `opts`.
 * @param {TestBeaconState} opts
 * @returns {BeaconState}
 */
export function generateState(opts?: TestBeaconState): BeaconState {

  const initialCrosslinkRecord: Crosslink = {
    epoch: GENESIS_EPOCH,
    shardBlockRoot: ZERO_HASH
  };

  return {
    // MISC
    slot: opts.slot || GENESIS_SLOT,
    genesisTime: opts.genesisTime || new Date().getTime(),
    fork: opts.fork || {
      previousVersion: GENESIS_FORK_VERSION,
      currentVersion: GENESIS_FORK_VERSION,
      epoch: GENESIS_EPOCH
    },
    // Validator registry
    validatorRegistry: opts.validatorRegistry || [],
    validatorBalances: opts.validatorBalances || [],
    validatorRegistryUpdateEpoch: opts.validatorRegistryUpdateEpoch || GENESIS_EPOCH,

    // Randomness and committees
    latestRandaoMixes: opts.latestRandaoMixes || Array.from({length: LATEST_RANDAO_MIXES_LENGTH}, () => ZERO_HASH),
    previousEpochStartShard: opts.previousEpochStartShard || GENESIS_START_SHARD,
    currentEpochStartShard: opts.currentEpochStartShard || GENESIS_START_SHARD,
    previousCalculationEpoch: opts.previousCalculationEpoch || GENESIS_EPOCH,
    currentCalculationEpoch: opts.currentCalculationEpoch || GENESIS_EPOCH,
    previousEpochSeed: opts.previousEpochSeed || ZERO_HASH,
    currentEpochSeed: opts.currentEpochSeed || ZERO_HASH,

    // Finality
    previousJustifiedEpoch: opts.previousJustifiedEpoch || GENESIS_EPOCH,
    justifiedEpoch: opts.justifiedEpoch || GENESIS_EPOCH,
    justificationBitfield: opts.justificationBitfield || 0,
    finalizedEpoch: opts.finalizedEpoch || GENESIS_EPOCH,

    // Recent state
    latestCrosslinks: opts.latestCrosslinks || Array.from({length: SHARD_COUNT}, () => initialCrosslinkRecord),
    latestBlockRoots: opts.latestBlockRoots || Array.from({length: LATEST_BLOCK_ROOTS_LENGTH}, () => ZERO_HASH),
    latestIndexRoots: opts.latestIndexRoots || Array.from({length: LATEST_INDEX_ROOTS_LENGTH}, () => ZERO_HASH),
    latestPenalizedBalances: opts.latestPenalizedBalances || Array.from({length: LATEST_PENALIZED_EXIT_LENGTH}, () => 0),
    latestAttestations: opts.latestAttestations || [],
    batchedBlockRoots: opts.batchedBlockRoots || [],

    // PoW receipt root
    latestEth1Data: opts.latestEth1Data || {
      depositRoot: new Uint8Array(32),
      blockHash: new Uint8Array(32)
    },
    eth1DataVotes: opts.eth1DataVotes || [],
  };
}

const randNum = () =>  Math.floor(Math.random() * Math.floor(4));

export function generateRandomState(opts?: TestBeaconState): BeaconState {
  const initialCrosslinkRecord: Crosslink = {
    epoch: randNum(),
    shardBlockRoot: new Uint8Array()
  };

  const defaultEth1Data: Eth1Data = {
    depositRoot: new Uint8Array(32),
    blockHash: new Uint8Array(32)
  };

  const validatorNum: number = randNum();

  return {
    // MISC
    slot: opts.slot || randNum(),
    genesisTime: opts.genesisTime || new Date().getTime(),
    fork: opts.fork || {
      previousVersion: randNum(),
      currentVersion: randNum(),
      epoch: randNum()
    },
    // Validator registry
    validatorRegistry: opts.validatorRegistry || generateValidators(validatorNum),
    validatorBalances: opts.validatorBalances || Array.from({length: validatorNum}, () => randNum()),
    validatorRegistryUpdateEpoch: opts.validatorRegistryUpdateEpoch || randNum(),

    // Randomness and committees
    latestRandaoMixes: opts.latestRandaoMixes || Array.from({length: randNum()}, () => new Uint8Array(32)),
    previousEpochStartShard: opts.previousEpochStartShard || randNum(),
    currentEpochStartShard: opts.currentEpochStartShard || randNum(),
    previousCalculationEpoch: opts.previousCalculationEpoch || randNum(),
    currentCalculationEpoch: opts.currentCalculationEpoch || randNum(),
    previousEpochSeed: opts.previousEpochSeed|| new Uint8Array(32),
    currentEpochSeed: opts.currentEpochSeed || new Uint8Array(32),

    // Finality
    previousJustifiedEpoch: opts.previousJustifiedEpoch || randNum(),
    justifiedEpoch: opts.justifiedEpoch || randNum(),
    justificationBitfield: opts.justificationBitfield || randNum(),
    finalizedEpoch: opts.finalizedEpoch || randNum(),

    latestCrosslinks: opts.latestCrosslinks || Array.from({length: randNum()}, () => initialCrosslinkRecord),
    latestBlockRoots: opts.latestBlockRoots || Array.from({length: randNum()}, () => new Uint8Array()),
    latestIndexRoots: opts.latestIndexRoots || Array.from({length: randNum()}, () => new Uint8Array()),
    latestPenalizedBalances: opts.latestPenalizedBalances || Array.from({length: randNum()}, () => randNum()),
    latestAttestations: opts.latestAttestations || [],
    batchedBlockRoots: opts.batchedBlockRoots || Array.from({length: randNum()}, () => new Uint8Array()),

    // PoW receipt root
    latestEth1Data: opts.latestEth1Data || {
      depositRoot: new Uint8Array(32),
      blockHash: new Uint8Array(32)
    },
    eth1DataVotes: opts.eth1DataVotes || [],
  };
}

// Automated approach
// export function generateRandomState(): BeaconState {
//   let state = {};
//
//   // Field represents an individual field in BeaconState
//   for (let field in BeaconState.fields) {
//     const name = field[0];
//     const type = field[1];
//
//     if (type.includes("uint")) {
//       state[name] = randNum();
//     } else if (type.includes("bytes")) {
//       state[name] = new Uint8Array(randNum());
//
//     // Check if the type is array
//     } else if (Array.isArray(type)) {
//       const arrType = type[0];
//
//       if (arrType.includes("CrossLink")) {
//       } else if (arrType.includes("Validator")) {
//         state[name] = generateValidators(randNum());
//       } else if (arrType.includes("PendingAttestation")) {
//       } else if (arrType.includes("bytes")) {
//         state[name] = Array.from({length: randNum()}, () => new Uint8Array(randNum()));
//       } else if (arrType.includes("uint")) {
//         state[name] = Array.from({length: randNum()}, () => ZERO_HASH)
//       } else if (arrType.includes("Eth1DataVote")) {
//       } else if (arrType.includes("Eth1Data")) {
//
//       }
//     }
//   }
//   return state;
// }
