import {altair, ssz} from "@chainsafe/lodestar-types";
import {ApiModules} from "../types";
import {resolveStateId} from "../beacon/state/utils";
import {routes} from "@chainsafe/lodestar-api";
import {ApiError} from "../errors";
import {linspace} from "../../../util/numpy";

// TODO: Import from lightclient/server package

export function getLightclientApi({
  chain,
  config,
  db,
}: Pick<ApiModules, "chain" | "config" | "db">): routes.lightclient.Api {
  return {
    // Proofs API

    async getStateProof(stateId, paths) {
      const state = await resolveStateId(config, chain, db, stateId);
      const stateTreeBacked = ssz.altair.BeaconState.createTreeBackedFromStruct(state as altair.BeaconState);
      return {data: stateTreeBacked.createProof(paths)};
    },

    // Sync API

    async getBestUpdates(from, to) {
      const periods = linspace(from, to);
      return {data: await chain.lightclientUpdater.getBestUpdates(periods)};
    },

    async getLatestUpdateFinalized() {
      const update = await chain.lightclientUpdater.getLatestUpdateFinalized();
      if (!update) throw new ApiError(404, "No update available");
      return {data: update};
    },

    async getLatestUpdateNonFinalized() {
      const update = await chain.lightclientUpdater.getLatestUpdateNonFinalized();
      if (!update) throw new ApiError(404, "No update available");
      return {data: update};
    },
  };
}
