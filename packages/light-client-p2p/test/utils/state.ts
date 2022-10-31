import {config as minimalConfig} from "@lodestar/config/default";
import {
  BeaconStateAllForks,
  CachedBeaconStateAllForks,
  createCachedBeaconState,
  PubkeyIndexMap,
  CachedBeaconStateBellatrix,
  BeaconStateBellatrix,
} from "@lodestar/state-transition";
import {BitArray} from "@chainsafe/ssz";
import {phase0, allForks, altair, ssz} from "@lodestar/types";
import {createIBeaconConfig} from "@lodestar/config";
import {
  EPOCHS_PER_HISTORICAL_VECTOR,
  EPOCHS_PER_SLASHINGS_VECTOR,
  FAR_FUTURE_EPOCH,
  ForkSeq,
  MAX_EFFECTIVE_BALANCE,
  SLOTS_PER_HISTORICAL_ROOT,
  SYNC_COMMITTEE_SIZE,
} from "@lodestar/params";

import bls from "@chainsafe/bls";
import {GENESIS_EPOCH, GENESIS_SLOT, ZERO_HASH} from "../../src/constants/index.js";
import {generateEmptyBlock} from "./block.js";
import {generateValidator, generateValidators} from "./validator.js";

/**
 * Copy of BeaconState, but all fields are marked optional to allow for swapping out variables as needed.
 */
type TestBeaconState = Partial<allForks.BeaconState>;

/**
 * Generate beaconState, by default it will generate a mostly empty state with "just enough" to be valid-ish
 * NOTE: All fields can be overridden through `opts`.
 *  should allow 1st test calling generateState more time since creating a new instance is expensive.
 *
 * @param {TestBeaconState} opts
 * @param config
 * @returns {BeaconState}
 */
export function generateState(
  opts: TestBeaconState = {},
  config = minimalConfig,
  forkSeq: ForkSeq = ForkSeq.phase0,
  withPubkey = false
): BeaconStateAllForks {
  const validatorOpts = {
    activationEpoch: 0,
    effectiveBalance: MAX_EFFECTIVE_BALANCE,
    withdrawableEpoch: FAR_FUTURE_EPOCH,
    exitEpoch: FAR_FUTURE_EPOCH,
  };
  const numValidators = 16;
  const validators = withPubkey
    ? Array.from({length: numValidators}, (_, i) => {
        const sk = bls.SecretKey.fromBytes(Buffer.alloc(32, i + 1));
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
    historicalRoots: [],
    eth1Data: {
      depositRoot: Buffer.alloc(32),
      blockHash: Buffer.alloc(32),
      depositCount: 0,
    },
    eth1DataVotes: [],
    eth1DepositIndex: 0,
    validators: validators,
    balances: Array.from({length: numValidators}, () => MAX_EFFECTIVE_BALANCE),
    randaoMixes: Array.from({length: EPOCHS_PER_HISTORICAL_VECTOR}, () => ZERO_HASH),
    slashings: Array.from({length: EPOCHS_PER_SLASHINGS_VECTOR}, () => BigInt(0)),
    previousEpochAttestations: [],
    currentEpochAttestations: [],
    justificationBits: BitArray.fromBitLen(4),
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

  if (forkSeq === ForkSeq.phase0) {
    return ssz.phase0.BeaconState.toViewDU(defaultState);
  }

  const defaultAltairState: altair.BeaconState = {
    ...ssz.altair.BeaconState.defaultValue(),
    ...defaultState,
    previousEpochParticipation: [...[0xff, 0xff], ...Array.from({length: numValidators - 2}, () => 0)],
    currentEpochParticipation: [...[0xff, 0xff], ...Array.from({length: numValidators - 2}, () => 0)],
    currentSyncCommittee: {
      pubkeys: Array.from({length: SYNC_COMMITTEE_SIZE}, (_, i) => validators[i % validators.length].pubkey),
      aggregatePubkey: ssz.BLSPubkey.defaultValue(),
    },
    nextSyncCommittee: {
      pubkeys: Array.from({length: SYNC_COMMITTEE_SIZE}, (_, i) => validators[i % validators.length].pubkey),
      aggregatePubkey: ssz.BLSPubkey.defaultValue(),
    },
  };

  if (forkSeq === ForkSeq.altair) {
    return ssz.altair.BeaconState.toViewDU(defaultAltairState);
  }

  // Bellatrix upwards
  if (forkSeq === ForkSeq.bellatrix) {
    const payloadHeader = ssz.bellatrix.ExecutionPayloadHeader.defaultValue();
    return ssz.bellatrix.BeaconState.toViewDU({
      ...defaultAltairState,
      latestExecutionPayloadHeader: {...payloadHeader, blockNumber: 2022},
    });
  }
  throw Error("Capella not implemented");
}

/**
 * This generates state with default pubkey
 */
export function generateCachedState(
  opts: TestBeaconState = {},
  config = minimalConfig,
  isAltair = false
): CachedBeaconStateAllForks {
  const state = generateState(opts, config, isAltair ? ForkSeq.altair : ForkSeq.phase0);
  return createCachedBeaconState(state, {
    config: createIBeaconConfig(config, state.genesisValidatorsRoot),
    // This is a performance test, there's no need to have a global shared cache of keys
    pubkey2index: new PubkeyIndexMap(),
    index2pubkey: [],
  });
}

/**
 * This generates state with default pubkey
 */
export function generateCachedAltairState(
  opts: TestBeaconState = {},
  config = minimalConfig
): CachedBeaconStateAllForks {
  const state = generateState(opts, config, ForkSeq.altair);
  return createCachedBeaconState(state, {
    config: createIBeaconConfig(config, state.genesisValidatorsRoot),
    // This is a performance test, there's no need to have a global shared cache of keys
    pubkey2index: new PubkeyIndexMap(),
    index2pubkey: [],
  });
}

/**
 * This generates state with default pubkey
 */
export function generateCachedBellatrixState(
  opts: TestBeaconState = {},
  config = minimalConfig
): CachedBeaconStateBellatrix {
  const state = generateState(opts, config, ForkSeq.bellatrix);
  return createCachedBeaconState(state as BeaconStateBellatrix, {
    config: createIBeaconConfig(config, state.genesisValidatorsRoot),
    // This is a performance test, there's no need to have a global shared cache of keys
    pubkey2index: new PubkeyIndexMap(),
    index2pubkey: [],
  });
}

/**
 * This generates state with real pubkey
 */
export async function generateCachedStateWithPubkeys(
  opts: TestBeaconState = {},
  config = minimalConfig,
  isAltair = false
): Promise<CachedBeaconStateAllForks> {
  return generateCachedState(opts, config, isAltair);
}
