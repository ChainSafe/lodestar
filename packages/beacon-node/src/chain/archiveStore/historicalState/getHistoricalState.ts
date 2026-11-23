import {BeaconConfig} from "@lodestar/config";
import {ZERO_HASH} from "@lodestar/params";
import {
  DataAvailabilityStatus,
  ExecutionPayloadStatus,
  IBeaconStateView,
  createBeaconStateViewForHistoricalRegen,
} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {byteArrayEquals, toRootHex} from "@lodestar/utils";
import {IBeaconDb} from "../../../db/index.js";
import {RegenError, RegenErrorCode} from "../../regen/errors.js";
import {HistoricalStateRegenMetrics} from "./metrics.js";
import {RegenErrorType} from "./types.js";

/**
 * Get the nearest BeaconState at or before a slot
 */
export async function getNearestState(
  slot: number,
  config: BeaconConfig,
  db: IBeaconDb,
  nativeStateTransition: boolean
): Promise<IBeaconStateView | null> {
  const stateBytesArr = await db.stateArchive.binaries({limit: 1, lte: slot, reverse: true});
  if (!stateBytesArr.length) {
    return null;
  }

  const stateBytes = stateBytesArr[0];
  return createBeaconStateViewForHistoricalRegen({nativeStateTransition: nativeStateTransition, config, stateBytes});
}

/**
 * Get and regenerate a historical state
 */
export async function getHistoricalState(
  slot: number,
  config: BeaconConfig,
  db: IBeaconDb,
  nativeStateTransition: boolean,
  metrics?: HistoricalStateRegenMetrics
): Promise<Uint8Array | null> {
  const regenTimer = metrics?.regenTime.startTimer();
  let state: IBeaconStateView | null = null;

  try {
    const loadStateTimer = metrics?.loadStateTime.startTimer();
    try {
      state = await getNearestState(slot, config, db, nativeStateTransition);
    } catch (e) {
      metrics?.regenErrorCount.inc({reason: RegenErrorType.loadState});
      throw e;
    } finally {
      loadStateTimer?.();
    }
    if (state === null) {
      metrics?.regenErrorCount.inc({reason: RegenErrorType.loadState});
      return null;
    }

    const transitionTimer = metrics?.stateTransitionTime.startTimer();
    let blockCount = 0;
    try {
      for await (const block of db.blockArchive.valuesStream({gt: state.slot, lte: slot})) {
        const header = ssz.phase0.BeaconBlockHeader.clone(state.latestBlockHeader);
        if (byteArrayEquals(header.stateRoot, ZERO_HASH)) header.stateRoot = state.hashTreeRoot();
        if (
          !byteArrayEquals(block.message.parentRoot, ssz.phase0.BeaconBlockHeader.hashTreeRoot(header)) &&
          (await db.blockArchive.getByRoot(block.message.parentRoot)) === null
        ) {
          metrics?.regenErrorCount.inc({reason: RegenErrorType.blockProcessing});
          return null;
        }
        const previousState = state;
        try {
          state = state.stateTransition(
            {block},
            {
              verifyProposer: false,
              verifySignatures: false,
              verifyStateRoot: false,
              executionPayloadStatus: ExecutionPayloadStatus.valid,
              dataAvailabilityStatus: DataAvailabilityStatus.Available,
            },
            {metrics}
          );
        } catch (e) {
          metrics?.regenErrorCount.inc({reason: RegenErrorType.blockProcessing});
          throw e;
        }
        previousState.release();
        blockCount++;
        const stateRoot = state.hashTreeRoot();
        if (!byteArrayEquals(stateRoot, block.message.stateRoot)) {
          metrics?.regenErrorCount.inc({reason: RegenErrorType.invalidStateRoot});
          throw new RegenError({
            code: RegenErrorCode.INVALID_STATE_ROOT,
            slot: state.slot,
            expected: toRootHex(block.message.stateRoot),
            actual: toRootHex(stateRoot),
          });
        }
      }
      metrics?.stateTransitionBlocks.observe(blockCount);
    } finally {
      transitionTimer?.();
    }

    if (state.slot !== slot) {
      return null;
    }

    const serializeTimer = metrics?.stateSerializationTime.startTimer();
    try {
      return state.serialize();
    } finally {
      serializeTimer?.();
    }
  } finally {
    state?.release();
    regenTimer?.();
  }
}
