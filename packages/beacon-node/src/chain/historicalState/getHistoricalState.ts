import {
  BeaconStateAllForks,
  BeaconStateTransitionMetrics,
  CachedBeaconStateAllForks,
  DataAvailableStatus,
  ExecutionPayloadStatus,
  PubkeyIndexMap,
  createCachedBeaconState,
  stateTransition,
} from "@lodestar/state-transition";
import {SignedBeaconBlock} from "@lodestar/types/allForks";
import {BeaconConfig} from "@lodestar/config";
import {IBeaconDb} from "../../db/index.js";

export function syncPubkeyCache(state: BeaconStateAllForks, pubkey2index: PubkeyIndexMap): void {
  // Get the validators sub tree once for all the loop
  const validators = state.validators;

  const newCount = state.validators.length;
  for (let i = pubkey2index.size; i < newCount; i++) {
    const pubkey = validators.getReadonly(i).pubkey;
    pubkey2index.set(pubkey, i);
  }
}

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

export function getBlocksBetween(from: number, to: number, db: IBeaconDb): AsyncIterable<SignedBeaconBlock> {
  return db.blockArchive.valuesStream({gt: from, lte: to});
}

export async function getHistoricalState(
  slot: number,
  config: BeaconConfig,
  db: IBeaconDb,
  pubkey2index: PubkeyIndexMap,
  metrics?: BeaconStateTransitionMetrics
): Promise<Uint8Array> {
  let state = await getNearestState(slot, config, db, pubkey2index);
  for await (const block of getBlocksBetween(state.slot, slot, db)) {
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
  }
  return state.serialize();
}
