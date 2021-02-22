/**
 * @module chain
 */

import {AbortSignal} from "abort-controller";
import {blockToHeader, computeEpochAtSlot, phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";
import {toHexString, TreeBacked} from "@chainsafe/ssz";
import {GENESIS_SLOT, ZERO_HASH} from "../constants";
import {IBeaconDb} from "../db";
import {Eth1Provider} from "../eth1";
import {IBeaconMetrics} from "../metrics";
import {GenesisBuilder} from "./genesis/genesis";
import {IGenesisResult} from "./genesis/interface";
import {CheckpointStateCache, StateContextCache} from "./stateCache";

export async function persistGenesisResult(
  db: IBeaconDb,
  genesisResult: IGenesisResult,
  genesisBlock: phase0.SignedBeaconBlock
): Promise<void> {
  await Promise.all([
    db.stateArchive.add(genesisResult.state),
    db.blockArchive.add(genesisBlock),
    db.depositDataRoot.putList(genesisResult.depositTree),
    db.eth1Data.put(genesisResult.block.timestamp, {
      ...genesisResult.block,
      depositCount: genesisResult.depositTree.length,
      depositRoot: genesisResult.depositTree.hashTreeRoot(),
    }),
  ]);
}

export async function persistAnchorState(
  config: IBeaconConfig,
  db: IBeaconDb,
  anchorState: TreeBacked<phase0.BeaconState>
): Promise<void> {
  if (anchorState.slot === GENESIS_SLOT) {
    const genesisBlock = createGenesisBlock(config, anchorState);
    await Promise.all([db.blockArchive.add(genesisBlock), db.stateArchive.add(anchorState)]);
  } else {
    await db.stateArchive.add(anchorState);
  }
}

export function createGenesisBlock(config: IBeaconConfig, genesisState: phase0.BeaconState): phase0.SignedBeaconBlock {
  const genesisBlock = config.types.phase0.SignedBeaconBlock.defaultValue();
  const stateRoot = config.types.phase0.BeaconState.hashTreeRoot(genesisState);
  genesisBlock.message.stateRoot = stateRoot;
  return genesisBlock;
}

/**
 * Initialize and persist a genesis state and related data
 */
export async function initStateFromEth1(
  config: IBeaconConfig,
  db: IBeaconDb,
  logger: ILogger,
  eth1Provider: Eth1Provider,
  signal: AbortSignal
): Promise<TreeBacked<phase0.BeaconState>> {
  logger.info("Listening to eth1 for genesis state");

  const builder = new GenesisBuilder(config, {eth1Provider, logger, signal});

  const genesisResult = await builder.waitForGenesis();
  const genesisBlock = createGenesisBlock(config, genesisResult.state);
  const stateRoot = config.types.phase0.BeaconState.hashTreeRoot(genesisResult.state);
  const blockRoot = config.types.phase0.BeaconBlock.hashTreeRoot(genesisBlock.message);

  logger.info("Initializing genesis state", {
    stateRoot: toHexString(stateRoot),
    blockRoot: toHexString(blockRoot),
    validatorCount: genesisResult.state.validators.length,
  });

  await persistGenesisResult(db, genesisResult, genesisBlock);
  return genesisResult.state;
}

/**
 * Restore the latest beacon state from db
 */
export async function initStateFromDb(
  config: IBeaconConfig,
  db: IBeaconDb,
  logger: ILogger
): Promise<TreeBacked<phase0.BeaconState>> {
  const state = await db.stateArchive.lastValue();
  if (!state) {
    throw new Error("No state exists in database");
  }

  logger.info("Initializing beacon state from db", {
    slot: state.slot,
    epoch: computeEpochAtSlot(config, state.slot),
    stateRoot: toHexString(config.types.phase0.BeaconState.hashTreeRoot(state)),
  });

  return state;
}

/**
 * Initialize and persist an anchor state (either weak subjectivity or genesis)
 */
export async function initStateFromAnchorState(
  config: IBeaconConfig,
  db: IBeaconDb,
  logger: ILogger,
  anchorState: TreeBacked<phase0.BeaconState>
): Promise<TreeBacked<phase0.BeaconState>> {
  logger.info("Initializing beacon state", {
    slot: anchorState.slot,
    epoch: computeEpochAtSlot(config, anchorState.slot),
    stateRoot: toHexString(config.types.phase0.BeaconState.hashTreeRoot(anchorState)),
  });

  await persistAnchorState(config, db, anchorState);

  return anchorState;
}

/**
 * Restore a beacon state to the state cache.
 */
export function restoreStateCaches(
  config: IBeaconConfig,
  stateCache: StateContextCache,
  checkpointStateCache: CheckpointStateCache,
  state: TreeBacked<phase0.BeaconState>
): void {
  const {checkpoint} = computeAnchorCheckpoint(config, state);
  const epochCtx = new phase0.fast.EpochContext(config);
  epochCtx.loadState(state);

  const stateCtx = {state: phase0.fast.createCachedValidatorsBeaconState(state), epochCtx};

  // store state in state caches
  void stateCache.add(stateCtx);
  checkpointStateCache.add(checkpoint, stateCtx);
}

export function initBeaconMetrics(metrics: IBeaconMetrics, state: TreeBacked<phase0.BeaconState>): void {
  metrics.headSlot.set(state.slot);
  metrics.previousJustifiedEpoch.set(state.previousJustifiedCheckpoint.epoch);
  metrics.currentJustifiedEpoch.set(state.currentJustifiedCheckpoint.epoch);
  metrics.finalizedEpoch.set(state.finalizedCheckpoint.epoch);
}

export function computeAnchorCheckpoint(
  config: IBeaconConfig,
  anchorState: phase0.BeaconState
): {checkpoint: phase0.Checkpoint; blockHeader: phase0.BeaconBlockHeader} {
  let blockHeader;
  let root;
  if (anchorState.latestBlockHeader.slot === GENESIS_SLOT) {
    const block = config.types.phase0.BeaconBlock.defaultValue();
    block.stateRoot = config.types.phase0.BeaconState.hashTreeRoot(anchorState);
    blockHeader = blockToHeader(config, block);
    root = config.types.phase0.BeaconBlockHeader.hashTreeRoot(blockHeader);
  } else {
    blockHeader = config.types.phase0.BeaconBlockHeader.clone(anchorState.latestBlockHeader);
    if (config.types.Root.equals(blockHeader.stateRoot, ZERO_HASH)) {
      blockHeader.stateRoot = config.types.phase0.BeaconState.hashTreeRoot(anchorState);
    }
    root = config.types.phase0.BeaconBlockHeader.hashTreeRoot(blockHeader);
  }

  return {
    checkpoint: {
      root,
      epoch: computeEpochAtSlot(config, anchorState.slot),
    },
    blockHeader,
  };
}
