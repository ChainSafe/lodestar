import {PubkeyIndexMap} from "@chainsafe/pubkey-index-map";
import {
  BeaconStateAllForks,
  CachedBeaconStateAllForks,
  DataAvailableStatus,
  ExecutionPayloadStatus,
  createCachedBeaconState,
  stateTransition,
} from "@lodestar/state-transition";
import {BeaconConfig} from "@lodestar/config";
import {IBeaconDb} from "../../db/index.js";
import {HistoricalStateRegenMetrics, RegenErrorType} from "./types.js";

/**
 * Populate a PubkeyIndexMap with any new entries based on a BeaconState
 */
export function syncPubkeyCache(state: BeaconStateAllForks, pubkey2index: PubkeyIndexMap): void {
  // Get the validators sub tree once for all the loop
  const validators = state.validators;

  const newCount = state.validators.length;
  for (let i = pubkey2index.size; i < newCount; i++) {
    const pubkey = validators.getReadonly(i).pubkey;
    pubkey2index.set(pubkey, i);
  }
}

/**
 * Get the nearest BeaconState at or before a slot
 */
export async function getNearestState(
  slot: number,
  config: BeaconConfig,
  db: IBeaconDb,
  pubkey2index: PubkeyIndexMap
): Promise<CachedBeaconStateAllForks> {
  const states = await db.stateArchive.values({limit: 1, lte: slot, reverse: true});
  if (!states.length) {
    throw new Error("No near state found in the database");
  }

  const state = states[0];
  syncPubkeyCache(state, pubkey2index);

  return createCachedBeaconState(
    state,
    {
      config,
      pubkey2index,
      index2pubkey: [],
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
  pubkey2index: PubkeyIndexMap,
  metrics?: HistoricalStateRegenMetrics
): Promise<Uint8Array> {
  const regenTimer = metrics?.regenTime.startTimer();

  const loadStateTimer = metrics?.loadStateTime.startTimer();
  let state = await getNearestState(slot, config, db, pubkey2index).catch((e) => {
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
          dataAvailableStatus: DataAvailableStatus.available,
        },
        metrics
      );
    } catch (e) {
      metrics?.regenErrorCount.inc({reason: RegenErrorType.blockProcessing});
      throw e;
    }
    blockCount++;
    if (Buffer.compare(state.hashTreeRoot(), block.message.stateRoot) !== 0) {
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
