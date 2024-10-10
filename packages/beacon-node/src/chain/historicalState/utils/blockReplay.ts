import {PubkeyIndexMap} from "@chainsafe/pubkey-index-map";
import {BeaconConfig} from "@lodestar/config";
import {
  BeaconStateAllForks,
  CachedBeaconStateAllForks,
  DataAvailableStatus,
  ExecutionPayloadStatus,
  createCachedBeaconState,
  stateTransition,
} from "@lodestar/state-transition";
import {Slot} from "@lodestar/types";
import {IBeaconDb} from "../../../db/index.js";
import {HistoricalStateRegenMetrics, RegenErrorType} from "../types.js";

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
 * Get and regenerate a historical state
 */
export async function replayBlocks(
  {
    toSlot,
    lastFullSlot,
    lastFullStateBytes,
  }: {
    toSlot: Slot;
    lastFullStateBytes: Uint8Array;
    lastFullSlot: Slot;
  },
  {
    config,
    db,
    pubkey2index,
    metrics,
  }: {config: BeaconConfig; db: IBeaconDb; pubkey2index: PubkeyIndexMap; metrics?: HistoricalStateRegenMetrics}
): Promise<Uint8Array> {
  if (lastFullSlot + 1 !== toSlot) {
    throw new Error(`Invalid full state slot to regen historical sate. expected=${toSlot - 1} actual=${lastFullSlot}`);
  }

  const transitionTimer = metrics?.stateTransitionTime.startTimer();

  let state = config.getForkTypes(toSlot).BeaconState.deserializeToViewDU(lastFullStateBytes);
  syncPubkeyCache(state, pubkey2index);
  state = createCachedBeaconState(
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

  let blockCount = 0;

  for await (const block of db.blockArchive.valuesStream({gt: lastFullSlot, lte: toSlot})) {
    try {
      state = stateTransition(
        state as CachedBeaconStateAllForks,
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

  if (state.slot !== toSlot) {
    throw Error(`Failed to generate historical state for slot ${toSlot}`);
  }

  const serializeTimer = metrics?.stateSerializationTime.startTimer();
  const stateBytes = state.serialize();
  serializeTimer?.();

  return stateBytes;
}
