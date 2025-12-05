import {PubkeyIndexMap} from "@chainsafe/pubkey-index-map";
import {BeaconConfig} from "@lodestar/config";
import {
  CachedBeaconStateAllForks,
  DataAvailabilityStatus,
  ExecutionPayloadStatus,
  createCachedBeaconState,
  stateTransition,
} from "@lodestar/state-transition";
import {Slot} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {IBeaconDb} from "../../../db/index.js";
import {syncPubkeyCache} from "../historicalState/getHistoricalState.js";

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
    fromSlot,
    stateBytes,
  }: {
    toSlot: Slot;
    stateBytes: Uint8Array;
    fromSlot: Slot;
  }
): Promise<Uint8Array> {
  const {config, db, pubkey2index} = modules;

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

  // biome-ignore lint/correctness/noUnusedVariables: Will use this for metrics
  let blockCount = 0;

  for await (const block of db.blockArchive.valuesStream({gt: fromSlot, lte: toSlot})) {
    try {
      state = stateTransition(state as CachedBeaconStateAllForks, block, {
        verifyProposer: false,
        verifySignatures: false,
        verifyStateRoot: false,
        executionPayloadStatus: ExecutionPayloadStatus.valid,
        dataAvailabilityStatus: DataAvailabilityStatus.Available,
      });
    } catch (e) {
      // biome-ignore lint/complexity/noUselessCatch: Add metrics for error
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
