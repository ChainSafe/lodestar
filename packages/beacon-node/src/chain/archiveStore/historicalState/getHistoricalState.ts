import {BeaconConfig} from "@lodestar/config";
import {
  BeaconStateAllForks,
  CachedBeaconStateAllForks,
  DataAvailabilityStatus,
  ExecutionPayloadStatus,
  PubkeyCache,
  createCachedBeaconState,
  stateTransition,
} from "@lodestar/state-transition";
import {byteArrayEquals} from "@lodestar/utils";
import {IBeaconDb} from "../../../db/index.js";
import {getStateTypeFromBytes} from "../../../util/multifork.js";
import {HistoricalStateRegenMetrics} from "./metrics.js";
import {RegenErrorType} from "./types.js";

/**
 * Populate a PubkeyCache with any new entries based on a BeaconState
 */
export function syncPubkeyCache(state: BeaconStateAllForks, pubkeyCache: PubkeyCache): void {
  // Get the validators sub tree once for all the loop
  const validators = state.validators;

  const newCount = state.validators.length;
  for (let i = pubkeyCache.size; i < newCount; i++) {
    const pubkey = validators.getReadonly(i).pubkey;
    pubkeyCache.set(i, pubkey);
  }
}

/**
 * Get the nearest BeaconState at or before a slot
 */
export async function getNearestState(
  slot: number,
  config: BeaconConfig,
  db: IBeaconDb,
  pubkeyCache: PubkeyCache
): Promise<CachedBeaconStateAllForks> {
  const stateBytesArr = await db.stateArchive.binaries({limit: 1, lte: slot, reverse: true});
  if (!stateBytesArr.length) {
    throw new Error("No near state found in the database");
  }

  const stateBytes = stateBytesArr[0];
  const state = getStateTypeFromBytes(config, stateBytes).deserializeToViewDU(stateBytes);
  syncPubkeyCache(state, pubkeyCache);

  return createCachedBeaconState(
    state,
    {
      config,
      pubkeyCache,
    },
    {
      skipSyncPubkeys: true,
    }
  );
}

/**
 * Get and regenerate a historical state
 */
export async function getHistoricalState(
  slot: number,
  config: BeaconConfig,
  db: IBeaconDb,
  pubkeyCache: PubkeyCache,
  metrics?: HistoricalStateRegenMetrics
): Promise<Uint8Array> {
  const regenTimer = metrics?.regenTime.startTimer();

  const loadStateTimer = metrics?.loadStateTime.startTimer();
  let state = await getNearestState(slot, config, db, pubkeyCache).catch((e) => {
    metrics?.regenErrorCount.inc({reason: RegenErrorType.loadState});
    throw e;
  });
  loadStateTimer?.();

  const transitionTimer = metrics?.stateTransitionTime.startTimer();
  let blockCount = 0;
  for await (const block of db.blockArchive.valuesStream({gt: state.slot, lte: slot})) {
    try {
      state = stateTransition(
        state,
        block,
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
    blockCount++;
    if (!byteArrayEquals(state.hashTreeRoot(), block.message.stateRoot)) {
      metrics?.regenErrorCount.inc({reason: RegenErrorType.invalidStateRoot});
    }
  }
  metrics?.stateTransitionBlocks.observe(blockCount);
  transitionTimer?.();

  if (state.slot !== slot) {
    throw Error(`Failed to generate historical state for slot ${slot}`);
  }

  const serializeTimer = metrics?.stateSerializationTime.startTimer();
  const stateBytes = state.serialize();
  serializeTimer?.();

  regenTimer?.();
  return stateBytes;
}
