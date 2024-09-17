import {
  blockToHeader,
  computeEpochAtSlot,
  BeaconStateAllForks,
  CachedBeaconStateAllForks,
  computeCheckpointEpochAtStateSlot,
  computeStartSlotAtEpoch,
} from "@lodestar/state-transition";
import {SignedBeaconBlock, phase0, ssz} from "@lodestar/types";
import {ChainForkConfig} from "@lodestar/config";
import {Logger, toHex, toRootHex} from "@lodestar/utils";
import {GENESIS_SLOT, ZERO_HASH} from "../constants/index.js";
import {IBeaconDb} from "../db/index.js";
import {Eth1Provider} from "../eth1/index.js";
import {Metrics} from "../metrics/index.js";
import {Eth1Options} from "../eth1/options.js";
import {GenesisBuilder} from "./genesis/genesis.js";
import {GenesisResult} from "./genesis/interface.js";

export async function persistGenesisResult(
  db: IBeaconDb,
  genesisResult: GenesisResult,
  genesisBlock: SignedBeaconBlock
): Promise<void> {
  await Promise.all([
    db.stateArchive.add(genesisResult.state),
    db.blockArchive.add(genesisBlock),
    db.depositDataRoot.putList(genesisResult.depositTree.getAllReadonlyValues()),
    db.eth1Data.put(genesisResult.block.timestamp, {
      ...genesisResult.block,
      depositCount: genesisResult.depositTree.length,
      depositRoot: genesisResult.depositTree.hashTreeRoot(),
    }),
  ]);
}

export async function persistAnchorState(
  config: ChainForkConfig,
  db: IBeaconDb,
  anchorState: BeaconStateAllForks,
  anchorStateBytes: Uint8Array
): Promise<void> {
  if (anchorState.slot === GENESIS_SLOT) {
    const genesisBlock = createGenesisBlock(config, anchorState);
    await Promise.all([
      db.blockArchive.add(genesisBlock),
      db.block.add(genesisBlock),
      db.stateArchive.putBinary(anchorState.slot, anchorStateBytes),
    ]);
  } else {
    await db.stateArchive.putBinary(anchorState.slot, anchorStateBytes);
  }
}

export function createGenesisBlock(config: ChainForkConfig, genesisState: BeaconStateAllForks): SignedBeaconBlock {
  const types = config.getForkTypes(GENESIS_SLOT);
  const genesisBlock = types.SignedBeaconBlock.defaultValue();
  const stateRoot = genesisState.hashTreeRoot();
  genesisBlock.message.stateRoot = stateRoot;
  return genesisBlock;
}

/**
 * Initialize and persist a genesis state and related data
 */
export async function initStateFromEth1({
  config,
  db,
  logger,
  opts,
  signal,
}: {
  config: ChainForkConfig;
  db: IBeaconDb;
  logger: Logger;
  opts: Eth1Options;
  signal: AbortSignal;
}): Promise<CachedBeaconStateAllForks> {
  logger.info("Listening to eth1 for genesis state");

  const statePreGenesis = await db.preGenesisState.get();
  const depositTree = await db.depositDataRoot.getDepositRootTree();
  const lastProcessedBlockNumber = await db.preGenesisStateLastProcessedBlock.get();

  const builder = new GenesisBuilder({
    config,
    eth1Provider: new Eth1Provider(config, {...opts, logger}, signal),
    logger,
    signal,
    pendingStatus:
      statePreGenesis && depositTree !== undefined && lastProcessedBlockNumber != null
        ? {state: statePreGenesis, depositTree, lastProcessedBlockNumber}
        : undefined,
  });

  try {
    const genesisResult = await builder.waitForGenesis();

    // Note: .hashTreeRoot() automatically commits()
    const genesisBlock = createGenesisBlock(config, genesisResult.state);
    const types = config.getForkTypes(GENESIS_SLOT);
    const stateRoot = genesisResult.state.hashTreeRoot();
    const blockRoot = types.BeaconBlock.hashTreeRoot(genesisBlock.message);

    logger.info("Initializing genesis state", {
      stateRoot: toRootHex(stateRoot),
      blockRoot: toRootHex(blockRoot),
      validatorCount: genesisResult.state.validators.length,
    });

    await persistGenesisResult(db, genesisResult, genesisBlock);

    logger.verbose("Clearing pending genesis state if any");
    await db.preGenesisState.delete();
    await db.preGenesisStateLastProcessedBlock.delete();

    return genesisResult.state;
  } catch (e) {
    if (builder.lastProcessedBlockNumber != null) {
      logger.info("Persisting genesis state", {block: builder.lastProcessedBlockNumber});

      // Commit changed before serializing
      builder.state.commit();

      await db.preGenesisState.put(builder.state);
      await db.depositDataRoot.putList(builder.depositTree.getAllReadonlyValues());
      await db.preGenesisStateLastProcessedBlock.put(builder.lastProcessedBlockNumber);
    }
    throw e;
  }
}

/**
 * Restore the latest beacon state from db
 */
export async function initStateFromDb(
  config: ChainForkConfig,
  db: IBeaconDb,
  logger: Logger
): Promise<BeaconStateAllForks> {
  const state = await db.stateArchive.lastValue();
  if (!state) {
    throw new Error("No state exists in database");
  }

  logger.info("Initializing beacon state from db", {
    slot: state.slot,
    epoch: computeEpochAtSlot(state.slot),
    stateRoot: toRootHex(state.hashTreeRoot()),
  });

  return state;
}

/**
 * Initialize and persist an anchor state (either weak subjectivity or genesis)
 */
export async function checkAndPersistAnchorState(
  config: ChainForkConfig,
  db: IBeaconDb,
  logger: Logger,
  anchorState: BeaconStateAllForks,
  anchorStateBytes: Uint8Array,
  {
    isWithinWeakSubjectivityPeriod,
    isCheckpointState,
  }: {isWithinWeakSubjectivityPeriod: boolean; isCheckpointState: boolean}
): Promise<void> {
  const expectedFork = config.getForkInfo(computeStartSlotAtEpoch(anchorState.fork.epoch));
  const expectedForkVersion = toHex(expectedFork.version);
  const stateFork = toHex(anchorState.fork.currentVersion);
  if (stateFork !== expectedForkVersion) {
    throw Error(
      `State current fork version ${stateFork} not equal to current config ${expectedForkVersion}. Maybe caused by importing a state from a different network`
    );
  }

  const stateInfo = isCheckpointState ? "checkpoint" : "db";
  if (isWithinWeakSubjectivityPeriod) {
    logger.info(`Initializing beacon from a valid ${stateInfo} state`, {
      slot: anchorState.slot,
      epoch: computeEpochAtSlot(anchorState.slot),
      stateRoot: toRootHex(anchorState.hashTreeRoot()),
      isWithinWeakSubjectivityPeriod,
    });
  } else {
    logger.warn(`Initializing from a stale ${stateInfo} state vulnerable to long range attacks`, {
      slot: anchorState.slot,
      epoch: computeEpochAtSlot(anchorState.slot),
      stateRoot: toRootHex(anchorState.hashTreeRoot()),
      isWithinWeakSubjectivityPeriod,
    });
    logger.warn("Checkpoint sync recommended, please use --help to see checkpoint sync options");
  }

  if (isCheckpointState || anchorState.slot === GENESIS_SLOT) {
    await persistAnchorState(config, db, anchorState, anchorStateBytes);
  }
}

export function initBeaconMetrics(metrics: Metrics, state: BeaconStateAllForks): void {
  metrics.headSlot.set(state.slot);
  metrics.previousJustifiedEpoch.set(state.previousJustifiedCheckpoint.epoch);
  metrics.currentJustifiedEpoch.set(state.currentJustifiedCheckpoint.epoch);
  metrics.finalizedEpoch.set(state.finalizedCheckpoint.epoch);
}

export function computeAnchorCheckpoint(
  config: ChainForkConfig,
  anchorState: BeaconStateAllForks
): {checkpoint: phase0.Checkpoint; blockHeader: phase0.BeaconBlockHeader} {
  let blockHeader;
  let root;
  const blockTypes = config.getForkTypes(anchorState.latestBlockHeader.slot);

  if (anchorState.latestBlockHeader.slot === GENESIS_SLOT) {
    const block = blockTypes.BeaconBlock.defaultValue();
    block.stateRoot = anchorState.hashTreeRoot();
    blockHeader = blockToHeader(config, block);
    root = ssz.phase0.BeaconBlockHeader.hashTreeRoot(blockHeader);
  } else {
    blockHeader = ssz.phase0.BeaconBlockHeader.clone(anchorState.latestBlockHeader);
    if (ssz.Root.equals(blockHeader.stateRoot, ZERO_HASH)) {
      blockHeader.stateRoot = anchorState.hashTreeRoot();
    }
    root = ssz.phase0.BeaconBlockHeader.hashTreeRoot(blockHeader);
  }

  return {
    checkpoint: {
      root,
      // the checkpoint epoch = computeEpochAtSlot(anchorState.slot) + 1 if slot is not at epoch boundary
      // this is similar to a process_slots() call
      epoch: computeCheckpointEpochAtStateSlot(anchorState.slot),
    },
    blockHeader,
  };
}
