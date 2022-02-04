import {config as minimalConfig} from "@chainsafe/lodestar-config/default";
import {CachedBeaconStateAllForks, createCachedBeaconState, phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {List, TreeBacked} from "@chainsafe/ssz";
import {allForks, altair, Root, ssz} from "@chainsafe/lodestar-types";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {
  EPOCHS_PER_HISTORICAL_VECTOR,
  EPOCHS_PER_SLASHINGS_VECTOR,
  FAR_FUTURE_EPOCH,
  MAX_EFFECTIVE_BALANCE,
  SLOTS_PER_HISTORICAL_ROOT,
  SYNC_COMMITTEE_SIZE,
} from "@chainsafe/lodestar-params";

import {GENESIS_EPOCH, GENESIS_SLOT, ZERO_HASH} from "../../src/constants";
import {generateEmptyBlock} from "./block";
import {generateValidator, generateValidators} from "./validator";
import {SecretKey} from "@chainsafe/bls";
import {initBLS} from "@chainsafe/lodestar-cli/src/util";

/**
 * Copy of BeaconState, but all fields are marked optional to allow for swapping out variables as needed.
 */
type TestBeaconState = Partial<allForks.BeaconState>;

const phase0States = new Map<IChainForkConfig, TreeBacked<allForks.BeaconState>>();
const altairStates = new Map<IChainForkConfig, TreeBacked<altair.BeaconState>>();

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
  isAltair = false,
  withPubkey = false
): TreeBacked<allForks.BeaconState> {
  const validatorOpts = {
    activationEpoch: 0,
    effectiveBalance: MAX_EFFECTIVE_BALANCE,
    withdrawableEpoch: FAR_FUTURE_EPOCH,
    exitEpoch: FAR_FUTURE_EPOCH,
  };
  const numValidators = 16;
  const validators = withPubkey
    ? Array.from({length: numValidators}, (_, i) => {
        const sk = SecretKey.fromBytes(Buffer.alloc(32, i + 1));
        return generateValidator({
          ...validatorOpts,
          pubkey: sk.toPublicKey().toBytes(),
        });
      })
    : generateValidators(numValidators, validatorOpts);
  const defaultState: phase0.BeaconState = {
    genesisTime: Math.floor(Date.now() / 1000),
    genesisValidatorsRoot: ZERO_HASH,
    slot: GENESIS_SLOT,
    fork: {
      previousVersion: config.GENESIS_FORK_VERSION,
      currentVersion: config.GENESIS_FORK_VERSION,
      epoch: GENESIS_EPOCH,
    },
    latestBlockHeader: {
      slot: 0,
      proposerIndex: 0,
      parentRoot: Buffer.alloc(32),
      stateRoot: Buffer.alloc(32),
      bodyRoot: ssz.phase0.BeaconBlockBody.hashTreeRoot(generateEmptyBlock().body),
    },
    blockRoots: Array.from({length: SLOTS_PER_HISTORICAL_ROOT}, () => ZERO_HASH),
    stateRoots: Array.from({length: SLOTS_PER_HISTORICAL_ROOT}, () => ZERO_HASH),
    historicalRoots: ([] as Root[]) as List<Root>,
    eth1Data: {
      depositRoot: Buffer.alloc(32),
      blockHash: Buffer.alloc(32),
      depositCount: 0,
    },
    eth1DataVotes: ([] as phase0.Eth1Data[]) as List<phase0.Eth1Data>,
    eth1DepositIndex: 0,
    validators: validators as List<phase0.Validator>,
    balances: Array.from({length: numValidators}, () => MAX_EFFECTIVE_BALANCE) as List<number>,
    randaoMixes: Array.from({length: EPOCHS_PER_HISTORICAL_VECTOR}, () => ZERO_HASH),
    slashings: Array.from({length: EPOCHS_PER_SLASHINGS_VECTOR}, () => BigInt(0)),
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
      ...ssz.altair.BeaconState.struct_defaultValue(),
      ...defaultState,
      previousEpochParticipation: [
        ...[0xff, 0xff],
        ...Array.from({length: numValidators - 2}, () => 0),
      ] as List<number>,
      currentEpochParticipation: [...[0xff, 0xff], ...Array.from({length: numValidators - 2}, () => 0)] as List<number>,
      currentSyncCommittee: {
        pubkeys: Array.from({length: SYNC_COMMITTEE_SIZE}, (_, i) => validators[i % validators.length].pubkey),
        aggregatePubkey: ssz.BLSPubkey.defaultValue(),
      },
      nextSyncCommittee: {
        pubkeys: Array.from({length: SYNC_COMMITTEE_SIZE}, (_, i) => validators[i % validators.length].pubkey),
        aggregatePubkey: ssz.BLSPubkey.defaultValue(),
      },
    };

    const state =
      altairStates.get(config) ??
      (ssz.altair.BeaconState.createTreeBackedFromStruct(defaultAltairState) as TreeBacked<altair.BeaconState>);
    altairStates.set(config, state);
  } else {
    const state =
      phase0States.get(config) ??
      (ssz.phase0.BeaconState.createTreeBackedFromStruct(defaultState) as TreeBacked<allForks.BeaconState>);
    phase0States.set(config, state);
  }
  const resultState = (isAltair
    ? altairStates.get(config)?.clone()
    : phase0States.get(config)?.clone()) as TreeBacked<allForks.BeaconState>;

  for (const key in opts) {
    const newValue = opts[key as keyof TestBeaconState];
    // eslint-disable-next-line
    resultState[key as keyof TestBeaconState] = (newValue as unknown) as any;
  }
  return resultState;
}

/**
 * This generates state with default pubkey
 */
export function generateCachedState(
  opts: TestBeaconState = {},
  config = minimalConfig,
  isAltair = false
): CachedBeaconStateAllForks {
  const state = generateState(opts, config, isAltair);
  return createCachedBeaconState(config, state);
}

/**
 * This generates state with real pubkey
 */
export async function generateCachedStateWithPubkeys(
  opts: TestBeaconState = {},
  config = minimalConfig,
  isAltair = false
): Promise<CachedBeaconStateAllForks> {
  // somehow this is called in the test but BLS isn't init
  await initBLS();
  const state = generateState(opts, config, isAltair, true);
  return createCachedBeaconState(config, state);
}
