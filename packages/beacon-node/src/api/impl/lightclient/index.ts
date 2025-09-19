import {routes} from "@lodestar/api";
import {ApplicationMethods} from "@lodestar/api/server";
import {MAX_REQUEST_LIGHT_CLIENT_COMMITTEE_HASHES, MAX_REQUEST_LIGHT_CLIENT_UPDATES} from "@lodestar/params";
import {fromHex} from "@lodestar/utils";
import {assertLightClientServer} from "../../../node/utils/lightclient.js";
import {ApiModules} from "../types.js";
// TODO: Import from lightclient/server package

export function getLightclientApi({
  chain,
  config,
}: Pick<ApiModules, "chain" | "config">): ApplicationMethods<routes.lightclient.Endpoints> {
  return {
    async getLightClientUpdatesByRange({startPeriod, count}) {
      const lightClientServer = chain.lightClientServer;
      assertLightClientServer(lightClientServer);

      const maxAllowedCount = Math.min(MAX_REQUEST_LIGHT_CLIENT_UPDATES, count);
      const periods = Array.from({length: maxAllowedCount}, (_ignored, i) => i + startPeriod);
      const updates = await Promise.all(periods.map((period) => lightClientServer.getUpdate(period)));
      return {
        data: updates,
        meta: {versions: updates.map((update) => config.getForkName(update.attestedHeader.beacon.slot))},
      };
    },

    async getLightClientOptimisticUpdate() {
      assertLightClientServer(chain.lightClientServer);

      const update = chain.lightClientServer.getOptimisticUpdate();
      if (update === null) {
        throw Error("No optimistic update available");
      }
      return {data: update, meta: {version: config.getForkName(update.attestedHeader.beacon.slot)}};
    },

    async getLightClientFinalityUpdate() {
      assertLightClientServer(chain.lightClientServer);

      const update = chain.lightClientServer.getFinalityUpdate();
      if (update === null) {
        throw Error("No finality update available");
      }
      return {data: update, meta: {version: config.getForkName(update.attestedHeader.beacon.slot)}};
    },

    async getLightClientBootstrap({blockRoot}) {
      assertLightClientServer(chain.lightClientServer);

      const bootstrapProof = await chain.lightClientServer.getBootstrap(fromHex(blockRoot));
      return {data: bootstrapProof, meta: {version: config.getForkName(bootstrapProof.header.beacon.slot)}};
    },

    async getLightClientCommitteeRoot({startPeriod, count}) {
      const lightClientServer = chain.lightClientServer;
      assertLightClientServer(lightClientServer);

      const maxAllowedCount = Math.min(MAX_REQUEST_LIGHT_CLIENT_COMMITTEE_HASHES, count);
      const periods = Array.from({length: maxAllowedCount}, (_ignored, i) => i + startPeriod);
      const committeeHashes = await Promise.all(periods.map((period) => lightClientServer.getCommitteeRoot(period)));
      return {data: committeeHashes};
    },
  };
}
