import {List, Vector} from "@chainsafe/ssz";
import {BeaconState, PendingAttestation, Eth1Data, Validator} from "@chainsafe/lodestar-types";

import {GENESIS_EPOCH, GENESIS_SLOT, ZERO_HASH} from "../../src/constants";

import {generateEmptyBlock} from "./block";

import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";

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
  return {
    genesisTime: Math.floor(Date.now() / 1000),
    genesisValidatorsRoot: ZERO_HASH,
    slot: GENESIS_SLOT,
    fork: {
      previousVersion: config.params.GENESIS_FORK_VERSION,
      currentVersion: config.params.GENESIS_FORK_VERSION,
      epoch: GENESIS_EPOCH,
    },
    latestBlockHeader: {
      slot: 0,
      proposerIndex: 0,
      parentRoot: Buffer.alloc(32),
      stateRoot: Buffer.alloc(32),
      bodyRoot: config.types.BeaconBlockBody.hashTreeRoot(generateEmptyBlock().body),
    },
    blockRoots: Array.from({length: config.params.SLOTS_PER_HISTORICAL_ROOT}, () => ZERO_HASH),
    stateRoots: Array.from({length: config.params.SLOTS_PER_HISTORICAL_ROOT}, () => ZERO_HASH),
    historicalRoots: [] as Vector<number>[] as List<Vector<number>>,
    eth1Data: {
      depositRoot: Buffer.alloc(32),
      blockHash: Buffer.alloc(32),
      depositCount: 0,
    },
    eth1DataVotes: [] as Eth1Data[] as List<Eth1Data>,
    eth1DepositIndex: 0,
    validators: [] as Validator[] as List<Validator>,
    balances: [] as bigint[] as List<bigint>,
    randaoMixes: Array.from({length: config.params.EPOCHS_PER_HISTORICAL_VECTOR}, () => ZERO_HASH),
    slashings: Array.from({length: config.params.EPOCHS_PER_SLASHINGS_VECTOR}, () => 0n),
    previousEpochAttestations: [] as PendingAttestation[] as List<PendingAttestation>,
    currentEpochAttestations: [] as PendingAttestation[] as List<PendingAttestation>,
    justificationBits: [false, false, false, false],
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
