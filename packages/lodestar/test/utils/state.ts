import {minimalConfig} from "@chainsafe/lodestar-config/minimal";
import {CachedBeaconState, createCachedBeaconState, phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {List, TreeBacked} from "@chainsafe/ssz";
import {allForks, altair, Gwei, Root} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {FAR_FUTURE_EPOCH} from "@chainsafe/lodestar-params";

import {GENESIS_EPOCH, GENESIS_SLOT, ZERO_HASH} from "../../src/constants";
import {generateEmptyBlock} from "./block";
import {generateValidators} from "./validator";

/**
 * Copy of BeaconState, but all fields are marked optional to allow for swapping out variables as needed.
 */
type TestBeaconState = Partial<allForks.BeaconState>;

const phase0States = new Map<IBeaconConfig, TreeBacked<allForks.BeaconState>>();
const altairStates = new Map<IBeaconConfig, TreeBacked<altair.BeaconState>>();

/**
 * Generate beaconState, by default it will generate a mostly empty state with "just enough" to be valid-ish
 * NOTE: All fields can be overridden through `opts`.
 *  should allow 1st test calling generateState more time since TreeBacked<BeaconState>.createValue api is expensive.
 *
 * @param {TestBeaconState} opts
 * @param config
 * @returns {BeaconState}
 */
export function generateState(
  opts: TestBeaconState = {},
  config = minimalConfig,
  isAltair = false
): TreeBacked<allForks.BeaconState> {
  const defaultState: phase0.BeaconState = {
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
    historicalRoots: ([] as Root[]) as List<Root>,
    eth1Data: {
      depositRoot: Buffer.alloc(32),
      blockHash: Buffer.alloc(32),
      depositCount: 0,
    },
    eth1DataVotes: ([] as phase0.Eth1Data[]) as List<phase0.Eth1Data>,
    eth1DepositIndex: 0,
    validators: generateValidators(4, {
      activationEpoch: 0,
      effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE,
      withdrawableEpoch: FAR_FUTURE_EPOCH,
      exitEpoch: FAR_FUTURE_EPOCH,
    }),
    balances: Array.from({length: 4}, () => config.params.MAX_EFFECTIVE_BALANCE) as List<Gwei>,
    randaoMixes: Array.from({length: config.params.EPOCHS_PER_HISTORICAL_VECTOR}, () => ZERO_HASH),
    slashings: Array.from({length: config.params.EPOCHS_PER_SLASHINGS_VECTOR}, () => BigInt(0)),
    previousEpochAttestations: ([] as phase0.PendingAttestation[]) as List<phase0.PendingAttestation>,
    currentEpochAttestations: ([] as phase0.PendingAttestation[]) as List<phase0.PendingAttestation>,
    justificationBits: Array.from({length: 4}, () => false),
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
  };
  if (isAltair) {
    const defaultAltairState: altair.BeaconState = {
      ...config.types.altair.BeaconState.struct_defaultValue(),
      ...defaultState,
    };

    const state =
      altairStates.get(config) ??
      (config.types.altair.BeaconState.createTreeBackedFromStruct(defaultAltairState) as TreeBacked<
        altair.BeaconState
      >);
    altairStates.set(config, state);
  } else {
    const state =
      phase0States.get(config) ??
      (config.types.phase0.BeaconState.createTreeBackedFromStruct(defaultState) as TreeBacked<allForks.BeaconState>);
    phase0States.set(config, state);
  }
  const resultState = (isAltair ? altairStates.get(config)?.clone() : phase0States.get(config)?.clone()) as TreeBacked<
    allForks.BeaconState
  >;

  // const state =
  //   phase0States.get(config) ??
  //   (config.types.phase0.BeaconState.createTreeBackedFromStruct(defaultState) as TreeBacked<allForks.BeaconState>);
  // phase0States.set(config, state);
  // const resultState = state.clone();

  for (const key in opts) {
    const newValue = opts[key as keyof TestBeaconState];
    // eslint-disable-next-line
    resultState[key as keyof TreeBacked<allForks.BeaconState>] = (newValue as unknown) as any;
  }
  return resultState;
}

export function generateCachedState(
  opts: TestBeaconState = {},
  config = minimalConfig,
  isAltair = false
): CachedBeaconState<allForks.BeaconState> {
  return createCachedBeaconState(config, generateState(opts, config, isAltair));
}
