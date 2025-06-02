import {PubkeyIndexMap} from "@chainsafe/pubkey-index-map";
import {BeaconConfig} from "@lodestar/config";
import {
  BeaconStateAllForks,
  CachedBeaconStateAllForks,
  DataAvailabilityStatus,
  ExecutionPayloadStatus,
  createCachedBeaconState,
  stateTransition,
} from "@lodestar/state-transition";
import {Slot} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {IBeaconDb} from "../../../db/index.js";

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
  modules: {
    config: BeaconConfig;
    db: IBeaconDb;
    pubkey2index: PubkeyIndexMap;
  },
  {
    toSlot,
    slot,
    stateBytes,
  }: {
    toSlot: Slot;
    stateBytes: Uint8Array;
    slot: Slot;
  }
): Promise<Uint8Array> {
  const {config, db, pubkey2index} = modules;

  if (slot + 1 !== toSlot) {
    throw new Error(`Invalid full state slot to regen historical sate. expected=${toSlot - 1} actual=${slot}`);
  }

  let state = config.getForkTypes(toSlot).BeaconState.deserializeToViewDU(stateBytes);
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

  // Will use this for metrics
  // biome-ignore lint/correctness/noUnusedVariables: <explanation>
  let blockCount = 0;

  for await (const block of db.blockArchive.valuesStream({gt: slot, lte: toSlot})) {
    try {
      state = stateTransition(state as CachedBeaconStateAllForks, block, {
        verifyProposer: false,
        verifySignatures: false,
        verifyStateRoot: false,
        executionPayloadStatus: ExecutionPayloadStatus.valid,
        dataAvailabilityStatus: DataAvailabilityStatus.Available,
      });
    } catch (e) {
      // Add metrics for error
      // biome-ignore lint/complexity/noUselessCatch: <explanation>
      throw e;
    }
    blockCount++;
    if (Buffer.compare(state.hashTreeRoot(), block.message.stateRoot) !== 0) {
      throw new Error(
        `State-root mismatch at slot ${block.message.slot}: block=${toHex(block.message.stateRoot)} state=${toHex(state.hashTreeRoot())}`
      );
    }
  }

  if (state.slot !== toSlot) {
    throw Error(`Failed to generate historical state for slot ${toSlot}`);
  }

  const finalizedStateBytes = state.serialize();

  return finalizedStateBytes;
}
