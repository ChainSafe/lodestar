import {fromHexString} from "@chainsafe/ssz";
import {routes, ServerApi} from "@lodestar/api";
import {SyncPeriod} from "@lodestar/types";
import {MAX_REQUEST_LIGHT_CLIENT_UPDATES, MAX_REQUEST_LIGHT_CLIENT_COMMITTEE_HASHES} from "@lodestar/params";
import {ApiModules} from "../types.js";

// TODO: Import from lightclient/server package

export function getLightclientApi({
  chain,
  config,
}: Pick<ApiModules, "chain" | "config">): ServerApi<routes.lightclient.Api> {
  return {
    async getLightClientUpdatesByRange(startPeriod: SyncPeriod, count: number) {
      const maxAllowedCount = Math.min(MAX_REQUEST_LIGHT_CLIENT_UPDATES, count);
      const periods = Array.from({length: maxAllowedCount}, (_ignored, i) => i + startPeriod);
      const updates = await Promise.all(periods.map((period) => chain.lightClientServer.getUpdate(period)));
      return updates.map((update) => ({
        version: config.getForkName(update.attestedHeader.beacon.slot),
        data: update,
      }));
    },

    async getLightClientOptimisticUpdate() {
      const data = chain.lightClientServer.getOptimisticUpdate();
      if (data === null) {
        throw Error("No optimistic update available");
      }
      return {version: config.getForkName(data.attestedHeader.beacon.slot), data};
    },

    async getLightClientFinalityUpdate() {
      const data = chain.lightClientServer.getFinalityUpdate();
      if (data === null) {
        throw Error("No finality update available");
      }
      return {version: config.getForkName(data.attestedHeader.beacon.slot), data};
    },

    async getLightClientBootstrap(blockRoot) {
      const bootstrapProof = await chain.lightClientServer.getBootstrap(fromHexString(blockRoot));
      return {version: config.getForkName(bootstrapProof.header.beacon.slot), data: bootstrapProof};
    },

    async getLightClientCommitteeRoot(startPeriod: SyncPeriod, count: number) {
      const maxAllowedCount = Math.min(MAX_REQUEST_LIGHT_CLIENT_COMMITTEE_HASHES, count);
      const periods = Array.from({length: maxAllowedCount}, (_ignored, i) => i + startPeriod);
      const committeeHashes = await Promise.all(
        periods.map((period) => chain.lightClientServer.getCommitteeRoot(period))
      );
      return {data: committeeHashes};
    },
  };
}
