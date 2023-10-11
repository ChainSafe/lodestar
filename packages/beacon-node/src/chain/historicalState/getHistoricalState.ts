import {
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

export async function getClosestState(
  slot: number,
  config: BeaconConfig,
  db: IBeaconDb
): Promise<CachedBeaconStateAllForks> {
  const states = await db.stateArchive.values({limit: 1, lte: slot, reverse: true});
  if (!states.length) {
    throw new Error("No close state found in the database");
  }
  return createCachedBeaconState(states[0], {
    config,
    pubkey2index: new PubkeyIndexMap(),
    index2pubkey: [],
  });
}

export function getBlocksBetween(from: number, to: number, db: IBeaconDb): AsyncIterable<SignedBeaconBlock> {
  return db.blockArchive.valuesStream({gt: from, lte: to});
}

export async function getHistoricalState(
  slot: number,
  config: BeaconConfig,
  db: IBeaconDb,
  metrics?: BeaconStateTransitionMetrics
): Promise<Uint8Array> {
  let state = await getClosestState(slot, config, db);
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
