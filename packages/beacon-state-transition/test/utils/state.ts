import {List, Vector} from "@chainsafe/ssz";
import {phase0} from "@chainsafe/lodestar-types";

import {GENESIS_EPOCH, GENESIS_SLOT, ZERO_HASH} from "../../src/constants";

import {generateEmptyBlock} from "./block";

import {config} from "@chainsafe/lodestar-config/mainnet";

/**
 * Copy of BeaconState, but all fields are marked optional to allow for swapping out variables as needed.
 */
type TestBeaconState = Partial<phase0.BeaconState>;

/**
 * Generate beaconState, by default it will use the initial state defined when the `ChainStart` log is emitted.
 * NOTE: All fields can be overridden through `opts`.
 * @param {TestBeaconState} opts
 * @returns {BeaconState}
 */
export function generateState(opts?: TestBeaconState): phase0.BeaconState {
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
      bodyRoot: config.types.phase0.BeaconBlockBody.hashTreeRoot(generateEmptyBlock().body),
    },
    blockRoots: Array.from({length: config.params.SLOTS_PER_HISTORICAL_ROOT}, () => ZERO_HASH),
    stateRoots: Array.from({length: config.params.SLOTS_PER_HISTORICAL_ROOT}, () => ZERO_HASH),
    historicalRoots: ([] as Vector<number>[]) as List<Vector<number>>,
    eth1Data: {
      depositRoot: Buffer.alloc(32),
      blockHash: Buffer.alloc(32),
      depositCount: 0,
    },
    eth1DataVotes: ([] as phase0.Eth1Data[]) as List<phase0.Eth1Data>,
    eth1DepositIndex: 0,
    validators: ([] as phase0.Validator[]) as List<phase0.Validator>,
    balances: ([] as bigint[]) as List<bigint>,
    randaoMixes: Array.from({length: config.params.EPOCHS_PER_HISTORICAL_VECTOR}, () => ZERO_HASH),
    slashings: Array.from({length: config.params.EPOCHS_PER_SLASHINGS_VECTOR}, () => BigInt(0)),
    previousEpochAttestations: ([] as phase0.PendingAttestation[]) as List<phase0.PendingAttestation>,
    currentEpochAttestations: ([] as phase0.PendingAttestation[]) as List<phase0.PendingAttestation>,
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
