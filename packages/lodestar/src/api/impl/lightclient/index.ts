import {altair, ssz, SyncPeriod} from "@chainsafe/lodestar-types";
import {ApiModules} from "../types";
import {resolveStateId} from "../beacon/state/utils";
import {routes} from "@chainsafe/lodestar-api";
import {ApiError} from "../errors";

// TODO: Import from lightclient/server package
interface ILightClientUpdater {
  getBestUpdates(from: SyncPeriod, to: SyncPeriod): Promise<altair.LightClientUpdate[]>;
  getLatestUpdateFinalized(): Promise<altair.LightClientUpdate | null>;
  getLatestUpdateNonFinalized(): Promise<altair.LightClientUpdate | null>;
}

export function getLightclientApi({
  chain,
  config,
  db,
}: Pick<ApiModules, "chain" | "config" | "db">): routes.lightclient.Api {
  // TODO:
  const lightClientUpdater = {} as ILightClientUpdater;

  return {
    // Proofs API

    async getStateProof(stateId, paths) {
      const state = await resolveStateId(config, chain, db, stateId);
      const stateTreeBacked = ssz.altair.BeaconState.createTreeBackedFromStruct(state as altair.BeaconState);
      return {data: stateTreeBacked.createProof(paths)};
    },

    // Sync API

    async getBestUpdates(from, to) {
      return {data: await lightClientUpdater.getBestUpdates(from, to)};
    },

    async getLatestUpdateFinalized() {
      const update = await lightClientUpdater.getLatestUpdateFinalized();
      if (!update) throw new ApiError(404, "No update available");
      return {data: update};
    },

    async getLatestUpdateNonFinalized() {
      const update = await lightClientUpdater.getLatestUpdateNonFinalized();
      if (!update) throw new ApiError(404, "No update available");
      return {data: update};
    },
  };
}
