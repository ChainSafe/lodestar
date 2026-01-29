import {ChainForkConfig} from "@lodestar/config";
import {ZERO_HASH} from "@lodestar/params";
import {BeaconStateAllForks, computeEpochAtSlot, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {SignedBeaconBlock, ssz} from "@lodestar/types";
import {Logger, toHex, toRootHex} from "@lodestar/utils";
import {GENESIS_SLOT} from "../constants/index.js";
import {IBeaconDb} from "../db/index.js";
import {Metrics} from "../metrics/index.js";
import {getStateTypeFromBytes} from "../util/multifork.js";

export async function persistAnchorState(
  config: ChainForkConfig,
  db: IBeaconDb,
  anchorState: BeaconStateAllForks,
  anchorStateBytes: Uint8Array
): Promise<void> {
  if (anchorState.slot === GENESIS_SLOT) {
    const genesisBlock = createGenesisBlock(config, anchorState);
    const blockRoot = config.getForkTypes(GENESIS_SLOT).BeaconBlock.hashTreeRoot(genesisBlock.message);

    const latestBlockHeader = ssz.phase0.BeaconBlockHeader.clone(anchorState.latestBlockHeader);

    if (ssz.Root.equals(latestBlockHeader.stateRoot, ZERO_HASH)) {
      latestBlockHeader.stateRoot = anchorState.hashTreeRoot();
    }

    const latestBlockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(latestBlockHeader);

    if (Buffer.compare(blockRoot, latestBlockRoot) !== 0) {
      throw Error(
        `Genesis block root ${toRootHex(blockRoot)} does not match genesis state latest block root ${toRootHex(latestBlockRoot)}`
      );
    }

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
 * Restore the latest beacon state from db
 */
export async function initStateFromDb(
  config: ChainForkConfig,
  db: IBeaconDb,
  logger: Logger
): Promise<BeaconStateAllForks> {
  const stateBytes = await db.stateArchive.lastBinary();
  if (stateBytes == null) {
    throw new Error("No state exists in database");
  }
  const state = getStateTypeFromBytes(config, stateBytes).deserializeToViewDU(stateBytes);

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
